/**
 * HTTP client for OpenCode server (create session, prompt, stream events).
 * Bridges the Discord endpoint to the OpenCode API.
 */
import {
  classifyAuthMethod,
  type ProviderRecord,
  type ProviderRegistry,
} from "./provider-registry"

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
    const response = await this.request<{ data?: Record<string, Array<{ label: string }>> }>("/provider/auth")
    return response.data || {}
  }

  async fetchModelIds(): Promise<string[]> {
    try {
      const response = await this.request<{ data?: Array<{ id: string }> }>("/model")
      return (response.data || []).map((item) => item.id)
    } catch {
      return []
    }
  }

  async syncRegistry(registry: ProviderRegistry): Promise<void> {
    const methodsByProvider = await this.fetchProviderAuthMethods()
    const modelIds = await this.fetchModelIds()

    const modelsByProvider = new Map<string, Array<{ id: string; label?: string }>>()
    for (const modelId of modelIds) {
      const [providerId] = modelId.split("/")
      if (!providerId) {
        continue
      }
      if (!modelsByProvider.has(providerId)) {
        modelsByProvider.set(providerId, [])
      }
      modelsByProvider.get(providerId)!.push({ id: modelId })
    }

    const providers: ProviderRecord[] = Object.entries(methodsByProvider).map(([id, methods]) => ({
      id,
      methods: methods.map((method) => ({
        label: method.label,
        kind: classifyAuthMethod(method.label),
      })),
      models: modelsByProvider.get(id) || [],
    }))

    registry.setProviders(providers)
  }

  async setProviderAuth(providerId: string, payload: Record<string, unknown>): Promise<void> {
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
    const response = await this.request<{ data: { id: string } }>("/session", {
      method: "POST",
      body: { title },
    })
    return response.data.id
  }

  async promptAsync(sessionId: string, text: string): Promise<void> {
    await this.request(`/session/${sessionId}/prompt_async`, {
      method: "POST",
      body: {
        parts: [{ type: "text", text } satisfies PromptPart],
      },
    })
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
