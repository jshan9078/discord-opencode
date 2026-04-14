/**
 * Resolves or creates the single OpenCode session bound to a Discord thread.
 */
import type { RuntimeClientAdapter } from "./prompt-orchestrator.js"
import type { ThreadRuntimeStore } from "./thread-runtime-store.js"

export async function resolveThreadSession(
  client: RuntimeClientAdapter,
  runtimeStore: ThreadRuntimeStore,
  threadId: string,
): Promise<string> {
  const existing = await runtimeStore.getSession(threadId)
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

  await runtimeStore.setSession(threadId, sessionId)

  return sessionId
}
