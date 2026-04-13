/**
 * HTTP client for OpenCode server (create session, prompt, stream events).
 * Bridges the Discord endpoint to the OpenCode API.
 */
import {
  classifyAuthMethod,
  type ProviderRecord,
  type ProviderRegistry,
} from "./provider-registry.js"

interface RequestOptions {
  method?: "GET" | "POST" | "PUT"
  body?: Record<string, unknown>
}

export interface PromptPart {
  type: "text"
  text: string
}

export interface RuntimeEvent {
  type: string
  sessionID?: string
  properties?: Record<string, unknown>
}

export class OpencodeRuntime {
  private readonly headers: Record<string, string>

  constructor(
    private readonly baseUrl: string,
    password?: string,
  ) {
    this.headers = {
      "Content-Type": "application/json",
    }

    if (password) {
      this.headers.Authorization = `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}`
    }
  }

  private async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: options.method || "GET",
      headers: this.headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
    })

    if (!response.ok) {
      const text = await response.text()
      throw new Error(`OpenCode request failed: ${response.status} ${text}`)
    }

    if (response.status === 204) {
      return {} as T
    }

    return (await response.json()) as T
  }

  async health(): Promise<void> {
    await this.request("/global/health")
  }

  async fetchProviderAuthMethods(): Promise<Record<string, Array<{ label: string }>>> {
    const response = await this.request<{
      data?: Record<string, Array<{ label: string }>>
      [key: string]: unknown
    }>("/provider/auth")

    if (response.data && typeof response.data === "object") {
      return response.data
    }

    const methods: Record<string, Array<{ label: string }>> = {}
    for (const [key, value] of Object.entries(response)) {
      if (key === "data") {
        continue
      }
      if (Array.isArray(value)) {
        methods[key] = value.filter((item): item is { label: string } => {
          return Boolean(item && typeof item === "object" && "label" in item)
        })
      }
    }
    return methods
  }

  async fetchProviderCatalog(): Promise<Array<{ id: string; models: Array<{ id: string; label?: string }> }>> {
    try {
      const response = await this.request<{
        all?: Array<{
          id?: string
          models?: Record<string, { id?: string; name?: string }>
        }>
        data?: {
          all?: Array<{
            id?: string
            models?: Record<string, { id?: string; name?: string }>
          }>
        }
      }>("/provider")

      const all = response.data?.all || response.all || []
      return all
        .filter((provider): provider is { id: string; models?: Record<string, { id?: string; name?: string }> } =>
          typeof provider?.id === "string",
        )
        .map((provider) => ({
          id: provider.id,
          models: Object.entries(provider.models || {}).map(([modelId, model]) => ({
            id: model.id || modelId,
            label: model.name,
          })),
        }))
    } catch {
      return []
    }
  }

  async syncRegistry(registry: ProviderRegistry): Promise<void> {
    const methodsByProvider = await this.fetchProviderAuthMethods()
    const catalog = await this.fetchProviderCatalog()
    const modelsByProvider = new Map<string, Array<{ id: string; label?: string }>>(
      catalog.map((provider) => [provider.id, provider.models]),
    )

    const providerIds = new Set<string>([
      ...Object.keys(methodsByProvider),
      ...catalog.map((provider) => provider.id),
    ])

    const providers: ProviderRecord[] = [...providerIds].map((id) => {
      const methods = methodsByProvider[id] || []
      return {
        id,
        methods: methods.map((method) => ({
          label: method.label,
          kind: classifyAuthMethod(method.label),
        })),
        models: modelsByProvider.get(id) || [],
      }
    })

    registry.setProviders(providers)
  }

  async setProviderAuth(providerId: string, payload: Record<string, unknown>): Promise<void> {
    // Format: { type: "api", key: "..." } or { type: "oauth", refresh: "...", access: "...", expires: ... }
    await this.request(`/auth/${providerId}`, {
      method: "PUT",
      body: payload,
    })
  }

  async authorizeProviderOAuth(
    providerId: string,
    method: number,
  ): Promise<Record<string, unknown>> {
    const response = await this.request<{ data?: Record<string, unknown> }>(
      `/provider/${providerId}/oauth/authorize`,
      {
        method: "POST",
        body: { method },
      },
    )
    return response.data || {}
  }

  async completeProviderOAuth(
    providerId: string,
    method: number,
  ): Promise<Record<string, unknown>> {
    const response = await this.request<{ data?: Record<string, unknown> }>(
      `/provider/${providerId}/oauth/callback`,
      {
        method: "POST",
        body: { method },
      },
    )
    return response.data || {}
  }

  async createSession(title: string): Promise<string> {
    const response = await this.request<{
      data?: { id?: string }
      id?: string
      sessionID?: string
    }>("/session", {
      method: "POST",
      body: { title },
    })

    const id = response.data?.id || response.id || response.sessionID
    if (!id) {
      throw new Error(`Session create returned no id: ${JSON.stringify(response)}`)
    }
    return id
  }

  async promptAsync(
    sessionId: string,
    text: string,
    model?: { providerId: string; modelId: string },
  ): Promise<void> {
    await this.request(`/session/${sessionId}/prompt_async`, {
      method: "POST",
      body: {
        ...(model
          ? {
              model: {
                providerID: model.providerId,
                modelID: model.modelId,
              },
            }
          : {}),
        parts: [{ type: "text", text } satisfies PromptPart],
      },
    })
  }

  async fetchSessionDiff(sessionId: string, messageId: string): Promise<string[]> {
    try {
      const response = await this.request<Array<{ file?: string }>>(
        `/session/${sessionId}/diff?messageID=${encodeURIComponent(messageId)}`,
      )
      return response
        .map((item) => (typeof item.file === "string" ? item.file : ""))
        .filter(Boolean)
    } catch {
      return []
    }
  }

  async *subscribeEvents(signal?: AbortSignal): AsyncGenerator<RuntimeEvent> {
    let response: Response
    try {
      response = await fetch(`${this.baseUrl}/event`, {
        method: "GET",
        headers: this.headers,
        signal,
      })
    } catch (error) {
      if (signal?.aborted) {
        return
      }
      throw error
    }

    if (!response.ok || !response.body) {
      throw new Error(`Failed to subscribe to events: ${response.status}`)
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ""

    while (true) {
      let chunk: ReadableStreamReadResult<Uint8Array>
      try {
        chunk = await reader.read()
      } catch (error) {
        if (signal?.aborted) {
          return
        }
        throw error
      }

      const { value, done } = chunk
      if (done) {
        break
      }

      buffer += decoder.decode(value, { stream: true })

      let boundary = buffer.indexOf("\n\n")
      while (boundary >= 0) {
        const rawEvent = buffer.slice(0, boundary)
        buffer = buffer.slice(boundary + 2)
        boundary = buffer.indexOf("\n\n")

        const dataLines = rawEvent
          .split("\n")
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trim())

        if (dataLines.length === 0) {
          continue
        }

        const data = dataLines.join("\n")
        try {
          yield JSON.parse(data) as RuntimeEvent
        } catch {
          // ignore malformed events
        }
      }
    }
  }
}
