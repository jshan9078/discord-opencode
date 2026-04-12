/**
 * Resolves or creates OpenCode session for the active provider/model profile.
 * Handles session reuse across prompts in the same channel.
 */
import type { RuntimeClientAdapter } from "./prompt-orchestrator"
import { ChannelStateStore } from "./channel-state-store"

export async function resolveSessionForActiveProfile(
  client: RuntimeClientAdapter,
  stateStore: ChannelStateStore,
  channelId: string,
): Promise<string> {
  const state = stateStore.get(channelId)
  const key = state.activeProviderId && state.activeModelId
    ? `${state.activeProviderId}:${state.activeModelId}`
    : null

  if (key && state.sessionByProfile?.[key]) {
    return state.sessionByProfile[key]
  }

  const created = await client.session.create({
    body: { title: `discord-${channelId}` },
  })
  const sessionId = created.data.id

  if (key) {
    const newState = stateStore.get(channelId)
    newState.sessionByProfile ||= {}
    newState.sessionByProfile[key] = sessionId
    stateStore.set(newState)
  }

  return sessionId
}