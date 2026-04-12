/**
 * Orchestrates the full prompt flow: auth, session, execution, event streaming.
 * The main entry point for processing /ask commands.
 */
import type { ChannelStateStore } from "./channel-state-store.js"
import type { CredentialStore } from "./credential-store.js"
import { ensureProviderAuth } from "./auth-bootstrap.js"
import { resolveSessionForActiveProfile } from "./session-manager.js"
import { relaySessionEvents, type EventRelaySink } from "./event-relay.js"
import type { ProviderRegistry } from "./provider-registry.js"
import type { OpencodeRuntime } from "./opencode-runtime.js"
import { ChannelStateStore as ChannelStoreClass } from "./channel-state-store.js"

export interface RuntimeClientAdapter {
  auth: {
    set(input: { path: { id: string }; body: Record<string, unknown> }): Promise<unknown>
  }
  provider: {
    auth(): Promise<{ data: Record<string, Array<{ label: string }>> }>
    oauth: {
      authorize(input: { path: { id: string }; body: { method: number } }): Promise<{ data: Record<string, unknown> }>
      callback(input: { path: { id: string }; body: { method: number } }): Promise<{ data: Record<string, unknown> }>
    }
  }
  session: {
    create(input: { body: { title: string } }): Promise<{ data: { id: string } }>
  }
  event: {
    subscribe(input?: { signal?: AbortSignal }): {
      stream: AsyncIterable<{ type: string; sessionID?: string; properties?: Record<string, unknown> }>
    }
  }
}

function toClient(runtime: OpencodeRuntime): RuntimeClientAdapter {
  return {
    auth: {
      set: ({ path, body }) => runtime.setProviderAuth(path.id, body),
    },
    provider: {
      auth: async () => ({ data: await runtime.fetchProviderAuthMethods() }),
      oauth: {
        authorize: async () => ({ data: {} }),
        callback: async () => ({ data: {} }),
      },
    },
    session: {
      create: async ({ body }) => ({ data: { id: await runtime.createSession(body.title) } }),
    },
    event: {
      subscribe: (input) => ({ stream: runtime.subscribeEvents(input?.signal) }),
    },
  }
}

export async function executePromptForChannel(
  runtime: OpencodeRuntime,
  registry: ProviderRegistry,
  credentials: CredentialStore,
  stateStore: ChannelStateStore,
  channelId: string,
  selection: {
    providerId: string
    modelId: string
  },
  prompt: string,
  sink: EventRelaySink,
  options: {
    forceNewSession?: boolean
    recoveryContext?: string
    providerAuth?: Record<string, unknown>
  } = {},
): Promise<
  | {
      ok: true
      hadError?: boolean
      usage?: {
        providerId: string
        modelId: string
        cost: number
        tokens: {
          total?: number
          input: number
          output: number
          reasoning: number
          cache: {
            read: number
            write: number
          }
        }
      }
    }
  | { ok: false; message: string }
> {
  const state = stateStore.get(channelId)
  const { providerId, modelId } = selection

  await runtime.syncRegistry(registry)

  const client = toClient(runtime)
  let authPrimed = false
  if (options.providerAuth) {
    try {
      await runtime.setProviderAuth(providerId, options.providerAuth)
      authPrimed = true
    } catch {
      // Fall through to normal auth bootstrap path
    }
  }

  if (!authPrimed) {
    const authResult = await ensureProviderAuth(client, registry, credentials, providerId)
    if (authResult.type === "needs_local_oauth") {
      return {
        ok: false,
        message:
          `Provider '${providerId}' needs OAuth setup. ` +
          `Run /auth-connect ${providerId} in Discord, complete the login flow, then run the same command again to finish callback.`,
      }
    }
    if (authResult.type === "needs_local_api_key") {
      return {
        ok: false,
        message: `Provider '${providerId}' needs an API key. Set ${providerId.toUpperCase().replace(/[^A-Z0-9]/g, "_")}_API_KEY in Vercel project env vars.`,
      }
    }
  }

  let sessionId: string
  if (options.forceNewSession) {
    const profileKey = `${providerId}:${modelId}`
    sessionId = await runtime.createSession(`discord-${channelId}-${profileKey}`)
    stateStore.setSessionForProfile(channelId, providerId, modelId, sessionId)
  } else {
    sessionId = await resolveSessionForActiveProfile(client, stateStore, channelId, providerId, modelId)
  }

  const relayPromise = relaySessionEvents(client, sink, sessionId, {
    maxIdleMs: 45_000,
    maxTotalMs: 10 * 60_000,
  })
  const finalPrompt = options.recoveryContext
    ? [
        "Context recovery note: Use the following Discord channel history summary to reconstruct prior intent. Treat it as approximate context and continue naturally.",
        "",
        options.recoveryContext,
        "",
        "Current user request:",
        prompt,
      ].join("\n")
    : prompt

  await runtime.promptAsync(sessionId, finalPrompt, {
    providerId,
    modelId,
  })
  const relayResult = await relayPromise

  if (!relayResult.completed && relayResult.timedOut) {
    return {
      ok: false,
      message:
        relayResult.reason === "idle_timeout"
          ? "Session timed out waiting for events."
          : "Session timed out before completion.",
    }
  }

  return {
    ok: true,
    hadError: relayResult.hadError,
    usage: relayResult.usage,
  }
}
