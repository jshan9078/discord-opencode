/**
 * Resolves or creates OpenCode session for the active provider/model profile.
 * Handles session reuse across prompts in the same thread.
 */
import type { RuntimeClientAdapter } from "./prompt-orchestrator.js"
import type { ThreadRuntimeStore } from "./thread-runtime-store.js"

export async function resolveSessionForActiveProfile(
  client: RuntimeClientAdapter,
  runtimeStore: ThreadRuntimeStore,
  threadId: string,
  providerId: string,
  modelId: string,
): Promise<string> {
  const existing = await runtimeStore.getSessionForProfile(threadId, providerId, modelId)
  if (existing) {
    try {
      await client.session.get({ path: { id: existing } })
      return existing
    } catch {
      // Recreate if the session is no longer available.
    }
  }

  const created = await client.session.create({
    body: { title: `discord-${threadId}` },
  })
  const sessionId = created.id

  await runtimeStore.setSessionForProfile(threadId, providerId, modelId, sessionId)

  return sessionId
}
