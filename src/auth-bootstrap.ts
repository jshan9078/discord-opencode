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

  if (providerId === "opencode-go") {
    candidates.push("OPENCODE_API_KEY")
  }

  return candidates
}

function getProviderApiKeyFromEnv(providerId: string): string | undefined {
  for (const key of providerEnvCandidates(providerId)) {
    const value = process.env[key]
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim()
    }
  }
  return undefined
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

  // First, try stored credentials
  const stored = credentials.getProviderAuth(providerId)
  if (stored) {
    try {
      await client.auth.set({ path: { id: providerId }, body: stored })
      return { type: "ok" }
    } catch {
      // Continue to try other auth methods
    }
  }

  // Then, try API key from environment variables
  // This works for providers that use separate API endpoints (like opencode-go)
  // where the sandbox server doesn't know about the provider's auth methods
  const envApiKey = getProviderApiKeyFromEnv(providerId)
  if (envApiKey) {
    try {
      await client.auth.set({ path: { id: providerId }, body: { type: "api", key: envApiKey } })
      return { type: "ok" }
    } catch {
      // Continue to try other auth methods
    }
  }

  // If no env var API key, check provider's declared auth methods
  const provider = registry.getProvider(providerId)
  if (!provider) {
    return { type: "needs_local_oauth" }
  }

  const methods = provider.methods
  const hasOAuth = methods.some((m) => m.kind === "oauth")
  const hasApiKey = methods.some((m) => m.kind === "api-key")

  if (hasApiKey) {
    return { type: "needs_local_api_key" }
  }
  if (hasOAuth) {
    return { type: "needs_local_oauth" }
  }

  return { type: "ok" }
}
