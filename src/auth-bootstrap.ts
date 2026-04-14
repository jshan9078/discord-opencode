/**
 * Bootstraps provider credentials into OpenCode session.
 * Checks stored credentials, syncs to runtime, returns auth status.
 */
import type { RuntimeClientAdapter } from "./prompt-orchestrator.js"
import type { CredentialStore } from "./credential-store.js"
import type { ProviderRegistry } from "./provider-registry.js"

export type AuthResult =
  | { type: "ok" }
  | { type: "needs_local_oauth" }
  | { type: "needs_local_api_key" }

function providerEnvCandidates(providerId: string): string[] {
  const normalized = providerId.toUpperCase().replace(/[^A-Z0-9]/g, "_")
  const candidates = [
    `${normalized}_API_KEY`,
  ]

  if (providerId === "google") {
    candidates.push("GOOGLE_GENERATIVEAI_API_KEY")
  }

  return candidates
}

function hasProviderApiKeyInEnv(providerId: string): boolean {
  return providerEnvCandidates(providerId).some((key) => {
    const value = process.env[key]
    return typeof value === "string" && value.trim().length > 0
  })
}

export async function ensureProviderAuth(
  client: RuntimeClientAdapter,
  registry: ProviderRegistry,
  credentials: CredentialStore,
  providerId: string,
): Promise<AuthResult> {
  if (providerId === "opencode") {
    return { type: "ok" }
  }

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
  const hasEnvApiKey = hasProviderApiKeyInEnv(providerId)

  if (hasEnvApiKey) {
    return { type: "ok" }
  }

  if (hasApiKey && !stored) {
    return { type: "needs_local_api_key" }
  }
  if (hasOAuth && !stored) {
    return { type: "needs_local_oauth" }
  }

  return { type: "ok" }
}
