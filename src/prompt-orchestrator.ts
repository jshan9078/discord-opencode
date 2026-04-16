/**
 * Orchestrates the full prompt flow: auth, session, execution, event streaming.
 * The main entry point for processing /ask commands.
 */
import type { CredentialStore } from "./credential-store.js"
import { ensureProviderAuth } from "./auth-bootstrap.js"
import { resolveThreadSession } from "./session-manager.js"
import { relaySessionEvents, type EventRelaySink } from "./event-relay.js"
import type { ProviderRegistry } from "./provider-registry.js"
import { syncProviderRegistry, type OpencodeClient } from "./opencode-client.js"
import type { ThreadRuntimeStore } from "./thread-runtime-store.js"

export type RuntimeClientAdapter = Pick<OpencodeClient, "auth" | "provider" | "session" | "event">

function logPromptStage(stage: string, details: Record<string, unknown>): void {
  console.info("prompt.stage", { stage, ...details })
}

async function withTimeout<T>(work: Promise<T>, ms: number, label: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
  })

  try {
    return await Promise.race([work, timeout])
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId)
    }
  }
}

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
    cwd?: string
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
  const startedAt = Date.now()
  logPromptStage("start", { threadId, providerId, modelId, forceNewSession: Boolean(options.forceNewSession) })

  try {
    logPromptStage("provider_sync_start", { threadId, providerId, modelId })
    await withTimeout(syncProviderRegistry(client, registry), 5_000, "provider registry sync")
    logPromptStage("provider_sync_done", { threadId, providerId, modelId })
  } catch {
    logPromptStage("provider_sync_skipped", { threadId, providerId, modelId })
    // Do not block prompt execution if provider registry sync fails.
    // Selection validation is already done upstream.
  }

  let authPrimed = false
  if (options.providerAuth) {
    try {
      logPromptStage("auth_set_start", { threadId, providerId })
      await client.auth.set({ path: { id: providerId }, body: options.providerAuth })
      authPrimed = true
      logPromptStage("auth_set_done", { threadId, providerId })
    } catch {
      logPromptStage("auth_set_failed", { threadId, providerId })
      // Fall through to normal auth bootstrap path
    }
  }

  if (!authPrimed) {
    logPromptStage("auth_bootstrap_start", { threadId, providerId })
    const authResult = await ensureProviderAuth(client, registry, credentials, providerId)
    logPromptStage("auth_bootstrap_done", { threadId, providerId, result: authResult.type })
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
    logPromptStage("session_create_start", { threadId, providerId, modelId })
    const created = await client.session.create({
      body: { title: `discord-${threadId}`, cwd: options.cwd },
    })
    sessionId = created.id
    await runtimeStore.setSession(threadId, sessionId)
    logPromptStage("session_create_done", { threadId, sessionId })
  } else {
    logPromptStage("session_resolve_start", { threadId, providerId, modelId })
    sessionId = await resolveThreadSession(client, runtimeStore, threadId, options.cwd)
    logPromptStage("session_resolve_done", { threadId, sessionId })
  }

  logPromptStage("relay_subscribe_start", { threadId, sessionId })
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

  logPromptStage("prompt_async_start", { threadId, sessionId, providerId, modelId })
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
  logPromptStage("prompt_async_done", { threadId, sessionId })
  const relayResult = await relayPromise
  logPromptStage("relay_done", {
    threadId,
    sessionId,
    completed: relayResult.completed,
    timedOut: relayResult.timedOut,
    reason: relayResult.reason,
    elapsedMs: Date.now() - startedAt,
  })

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
