/**
 * Bootstraps provider credentials into OpenCode session.
 * Checks stored credentials, syncs to runtime, returns auth status.
 */
import type { RuntimeClientAdapter } from "./prompt-orchestrator"
import type { CredentialStore } from "./credential-store"
import type { ProviderRegistry } from "./provider-registry"
import { ChannelStateStore } from "./channel-state-store"

export type AuthResult =
  | { type: "ok" }
  | { type: "needs_local_oauth" }
  | { type: "needs_local_api_key" }

export async function ensureProviderAuth(
  client: RuntimeClientAdapter,
  registry: ProviderRegistry,
  credentials: CredentialStore,
  providerId: string,
): Promise<AuthResult> {
  const provider = registry.getProvider(providerId)
  if (!provider) {
    return { type: "needs_local_oauth" }
  }

  const stored = credentials.getProviderAuth(providerId)
  if (stored) {
    try {
      await client.auth.set({ path: { id: providerId }, body: stored })
      return { type: "ok" }
    } catch {
      // Continue to try auth methods
    }
  }

  const methods = provider.methods
  const hasOAuth = methods.some((m) => m.kind === "oauth")
  const hasApiKey = methods.some((m) => m.kind === "api-key")

  if (hasOAuth && !stored) {
    return { type: "needs_local_oauth" }
  }
  if (hasApiKey && !stored) {
    return { type: "needs_local_api_key" }
  }

  return { type: "ok" }
}

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