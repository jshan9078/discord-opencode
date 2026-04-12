/**
 * Resolves or creates OpenCode session for the active provider/model profile.
 * Handles session reuse across prompts in the same channel.
 */
import type { RuntimeClientAdapter } from "./prompt-orchestrator.js"
import { ChannelStateStore } from "./channel-state-store.js"

export async function resolveSessionForActiveProfile(
  client: RuntimeClientAdapter,
  stateStore: ChannelStateStore,
  channelId: string,
  providerId: string,
  modelId: string,
): Promise<string> {
  const existing = stateStore.getSessionForProfile(channelId, providerId, modelId)
  if (existing) {
    return existing
  }

  const created = await client.session.create({
    body: { title: `discord-${channelId}` },
  })
  const sessionId = created.data.id

  stateStore.setSessionForProfile(channelId, providerId, modelId, sessionId)

  return sessionId
}
