/**
 * Loads provider registry from PROVIDER_REGISTRY_JSON env var.
 * Fallback when not synced from OpenCode server.
 */
import {
  ProviderRegistry,
  classifyAuthMethod,
  type ProviderRecord,
} from "./provider-registry"

export function loadProviderRegistryFromEnv(raw = process.env.PROVIDER_REGISTRY_JSON): ProviderRegistry {
  const registry = new ProviderRegistry()
  if (!raw) {
    return registry
  }

  try {
    const parsed = JSON.parse(raw) as Record<
      string,
      {
        methods?: Array<{ label: string }>
        models?: Array<{ id: string; label?: string }>
      }
    >

    const providers: ProviderRecord[] = Object.entries(parsed).map(([id, value]) => ({
      id,
      methods: (value.methods || []).map((method) => ({
        label: method.label,
        kind: classifyAuthMethod(method.label),
      })),
      models: (value.models || []).map((model) => ({ id: model.id, label: model.label })),
    }))

    registry.setProviders(providers)
  } catch (error) {
    console.error("Invalid PROVIDER_REGISTRY_JSON:", error)
  }

  return registry
}
