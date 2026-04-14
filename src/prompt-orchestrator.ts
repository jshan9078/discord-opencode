/**
 * Orchestrates the full prompt flow: auth, session, execution, event streaming.
 * The main entry point for processing /ask commands.
 */
import type { CredentialStore } from "./credential-store.js"
import { ensureProviderAuth } from "./auth-bootstrap.js"
import { resolveSessionForActiveProfile } from "./session-manager.js"
import { relaySessionEvents, type EventRelaySink } from "./event-relay.js"
import type { ProviderRegistry } from "./provider-registry.js"
import { syncProviderRegistry, type OpencodeClient } from "./opencode-client.js"
import type { ThreadRuntimeStore } from "./thread-runtime-store.js"

export type RuntimeClientAdapter = Pick<OpencodeClient, "auth" | "provider" | "session" | "event">

export async function executePromptForChannel(
  client: OpencodeClient,
  registry: ProviderRegistry,
  credentials: CredentialStore,
  runtimeStore: ThreadRuntimeStore,
  threadId: string,
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
    runtimeContext?: string
  } = {},
): Promise<
  | {
      ok: true
      hadError?: boolean
      filesEdited?: string[]
      lastAssistantMessageId?: string
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
  const { providerId, modelId } = selection

  try {
    await syncProviderRegistry(client, registry)
  } catch {
    // Do not block prompt execution if provider registry sync fails.
    // Selection validation is already done upstream.
  }

  let authPrimed = false
  if (options.providerAuth) {
    try {
      await client.auth.set({ path: { id: providerId }, body: options.providerAuth })
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
    const created = await client.session.create({
      body: { title: `discord-${threadId}-${profileKey}` },
    })
    sessionId = created.id
    await runtimeStore.setSessionForProfile(threadId, providerId, modelId, sessionId)
  } else {
    sessionId = await resolveSessionForActiveProfile(client, runtimeStore, threadId, providerId, modelId)
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
        ...(options.runtimeContext ? [options.runtimeContext, ""] : []),
        "Current user request:",
        prompt,
      ].join("\n")
    : options.runtimeContext
      ? [options.runtimeContext, "", prompt].join("\n")
      : prompt

  await client.session.promptAsync({
    path: { id: sessionId },
    body: {
      model: {
        providerID: providerId,
        modelID: modelId,
      },
      parts: [{ type: "text", text: finalPrompt }],
    },
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

  let filesEdited = relayResult.filesEdited || []
  if (filesEdited.length === 0 && relayResult.lastAssistantMessageId) {
    try {
      const fetched = await client.session.diff({
        path: { id: sessionId },
        query: { messageID: relayResult.lastAssistantMessageId },
      })
      if (fetched.length > 0) {
        filesEdited = fetched
          .map((item) => item.file || "")
          .filter(Boolean)
      }
    } catch {
      // Ignore diff fetch failures.
    }
  }

  return {
    ok: true,
    hadError: relayResult.hadError,
    filesEdited,
    lastAssistantMessageId: relayResult.lastAssistantMessageId,
    usage: relayResult.usage,
  }
}
