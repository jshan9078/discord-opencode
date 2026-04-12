/**
 * In-memory registry of available providers, auth methods, and models.
 * Synced from OpenCode server at runtime.
 */
export interface ProviderAuthMethod {
  label: string
  kind: "oauth" | "api-key" | "none" | "unknown"
}

export interface ProviderModel {
  id: string
  label?: string
}

export interface ProviderRecord {
  id: string
  methods: ProviderAuthMethod[]
  models: ProviderModel[]
}

export interface ProviderStatusView {
  id: string
  methods: ProviderAuthMethod[]
  isConfigured: boolean
}

export class ProviderRegistry {
  private readonly providers = new Map<string, ProviderRecord>()

  upsertProvider(provider: ProviderRecord): void {
    this.providers.set(provider.id, {
      id: provider.id,
      methods: [...provider.methods],
      models: [...provider.models],
    })
  }

  setProviders(providers: ProviderRecord[]): void {
    this.providers.clear()
    for (const provider of providers) {
      this.upsertProvider(provider)
    }
  }

  listProviders(): ProviderRecord[] {
    return [...this.providers.values()].sort((a, b) => a.id.localeCompare(b.id))
  }

  getProvider(providerId: string): ProviderRecord | undefined {
    return this.providers.get(providerId)
  }

  getModels(providerId: string): ProviderModel[] {
    return this.providers.get(providerId)?.models ?? []
  }

  hasProvider(providerId: string): boolean {
    return this.providers.has(providerId)
  }

  hasModel(providerId: string, modelId: string): boolean {
    return this.getModels(providerId).some((model) => model.id === modelId)
  }

  toStatusView(configuredProviders: string[]): ProviderStatusView[] {
    const configured = new Set(configuredProviders)
    return this.listProviders().map((provider) => ({
      id: provider.id,
      methods: provider.methods,
      isConfigured: configured.has(provider.id),
    }))
  }
}

export function classifyAuthMethod(label: string): ProviderAuthMethod["kind"] {
  const lower = label.toLowerCase()
  if (lower.includes("oauth") || lower.includes("browser") || lower.includes("headless") || lower.includes("device")) {
    return "oauth"
  }
  if (lower.includes("api key") || lower.includes("token")) {
    return "api-key"
  }
  if (lower.includes("none") || lower.includes("no auth") || lower.includes("free")) {
    return "none"
  }
  return "unknown"
}

export function pickBestOAuthMethod(methods: ProviderAuthMethod[], methodHint?: string): number {
  if (methods.length === 0) {
    return -1
  }

  if (methodHint) {
    const hint = methodHint.toLowerCase()
    const hintedIndex = methods.findIndex((method) => method.label.toLowerCase().includes(hint))
    if (hintedIndex >= 0) {
      return hintedIndex
    }
  }

  const priority = ["headless", "device", "browser", "oauth"]
  for (const token of priority) {
    const index = methods.findIndex(
      (method) => method.kind === "oauth" && method.label.toLowerCase().includes(token),
    )
    if (index >= 0) {
      return index
    }
  }

  return methods.findIndex((method) => method.kind === "oauth")
}
