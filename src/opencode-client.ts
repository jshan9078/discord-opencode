import { createOpencodeClient as createSdkClient, type OpencodeClient as SdkClient } from "@opencode-ai/sdk"
import { classifyAuthMethod, type ProviderRecord, type ProviderRegistry } from "./provider-registry.js"

type RuntimeEvent = {
  type: string
  sessionID?: string
  properties?: Record<string, unknown>
}

type ProviderAuthMethod = { label: string }

type ProviderListModel = {
  id?: string
  name?: string
  limit?: { context?: number }
}

type ProviderListProvider = {
  id: string
  models: Record<string, ProviderListModel>
}

function createSseStream(
  baseUrl: string,
  password: string | undefined,
  signal?: AbortSignal,
): AsyncIterable<RuntimeEvent> {
  const url = new URL("/event", baseUrl).toString()
  const auth = password ? `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}` : undefined

  return {
    async *[Symbol.asyncIterator](): AsyncIterator<RuntimeEvent> {
      const headers = new Headers()
      if (auth) {
        headers.set("Authorization", auth)
      }

      const response = await fetch(url, { headers, signal })
      if (!response.ok) {
        throw new Error(`Event subscribe failed: ${response.status} ${response.statusText}`)
      }
      if (!response.body) {
        throw new Error("Event subscribe returned no body")
      }

      const reader = response.body.pipeThrough(new TextDecoderStream()).getReader()
      let buffer = ""
      const isAbortError = (error: unknown): boolean => {
        return (error instanceof Error && (error.name === "AbortError" || error.message === "This operation was aborted"))
          || (typeof DOMException !== "undefined" && error instanceof DOMException && error.name === "AbortError")
      }

      try {
        while (true) {
          let done = false
          let value: string | undefined
          try {
            const next = await reader.read()
            done = next.done
            value = next.value
          } catch (error) {
            if (signal?.aborted && isAbortError(error)) {
              break
            }
            throw error
          }
          if (done) {
            break
          }

          buffer += value ?? ""
          const chunks = buffer.split("\n\n")
          buffer = chunks.pop() ?? ""

          for (const chunk of chunks) {
            const dataLines = chunk
              .split("\n")
              .filter((line) => line.startsWith("data:"))
              .map((line) => line.replace(/^data:\s*/, ""))

            if (dataLines.length === 0) {
              continue
            }

            const raw = dataLines.join("\n")
            const parsed = JSON.parse(raw) as RuntimeEvent
            yield parsed
          }
        }
      } finally {
        try {
          await reader.cancel()
        } catch {
          // Ignore cancellation errors during normal shutdown.
        }
        reader.releaseLock()
      }
    },
  }
}

function withOptionalAuth(password?: string): ((input: RequestInfo | URL, init?: RequestInit) => Promise<Response>) | undefined {
  if (!password) {
    return undefined
  }

  const auth = `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}`
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const requestHeaders = input instanceof Request ? input.headers : undefined
    const headers = new Headers(requestHeaders)
    if (init?.headers) {
      const initHeaders = new Headers(init.headers)
      for (const [key, value] of initHeaders.entries()) {
        headers.set(key, value)
      }
    }
    headers.set("Authorization", auth)

    if (input instanceof Request) {
      return await fetch(new Request(input, { ...init, headers }))
    }

    return await fetch(input, { ...init, headers })
  }
}

function extractData<T>(value: unknown): T {
  if (value && typeof value === "object" && "data" in value) {
    return (value as { data: T }).data
  }
  return value as T
}

export interface OpencodeClient {
  auth: {
    set(input: { path: { id: string }; body: Record<string, unknown> }): Promise<void>
  }
  provider: {
    auth(): Promise<Record<string, ProviderAuthMethod[]>>
    list(): Promise<{ all: ProviderListProvider[] }>
    oauth: {
      authorize(input: { path: { id: string }; body: { method: number } }): Promise<Record<string, unknown>>
      callback(input: { path: { id: string }; body: { method: number } }): Promise<Record<string, unknown>>
    }
  }
  session: {
    create(input: { body: { title: string; cwd?: string } }): Promise<{ id: string }>
    get(input: { path: { id: string } }): Promise<unknown>
    messages(input: { path: { id: string } }): Promise<Array<{ info?: Record<string, unknown>; parts?: unknown[] }>>
    promptAsync(input: {
      path: { id: string }
      body: {
        model: { providerID: string; modelID: string }
        system?: string
        parts: Array<{ type: "text"; text: string } | { type: "image"; path: string }>
      }
    }): Promise<void>
    diff(input: { path: { id: string }; query?: { messageID?: string } }): Promise<Array<{ file?: string }>>
  }
  event: {
    subscribe(input?: { signal?: AbortSignal }): Promise<{ stream: AsyncIterable<RuntimeEvent> }>
  }
}

function createRuntimeClient(sdk: SdkClient, baseUrl: string, password?: string): OpencodeClient {
  return {
    auth: {
      set: async (input) => {
        await sdk.auth.set(input as never)
      },
    },
    provider: {
      auth: async () => extractData<Record<string, ProviderAuthMethod[]>>(await sdk.provider.auth()),
      list: async () => extractData<{ all: ProviderListProvider[] }>(await sdk.provider.list()),
      oauth: {
        authorize: async (input) => extractData<Record<string, unknown>>(await sdk.provider.oauth.authorize(input as never)),
        callback: async (input) => extractData<Record<string, unknown>>(await sdk.provider.oauth.callback(input as never)),
      },
    },
    session: {
      create: async (input) => extractData<{ id: string }>(await sdk.session.create(input as never)),
      get: async (input) => await sdk.session.get(input as never),
      messages: async (input) => extractData<Array<{ info?: Record<string, unknown>; parts?: unknown[] }>>(await sdk.session.messages(input as never)),
      promptAsync: async (input) => {
        const parts = input.body?.parts ?? []
        const textParts: string[] = []

        for (const part of parts) {
          if (part.type === "text") {
            textParts.push(part.text)
          } else if (part.type === "image") {
            textParts.push(`[Image: ${part.path}]`)
          }
        }

        const finalText = textParts.join("\n\n")

        const result = await sdk.session.promptAsync({
          path: { id: input.path.id },
          body: {
            ...input.body,
            parts: [{ type: "text" as const, text: finalText }],
          },
        } as never)

        const normalized = extractData<unknown>(result)
        if (normalized && typeof normalized === "object" && "success" in normalized) {
          const maybe = normalized as { success?: boolean; error?: unknown }
          if (maybe.success === false) {
            const details = typeof maybe.error === "string" ? maybe.error : JSON.stringify(maybe.error)
            throw new Error(`prompt_async rejected: ${details}`)
          }
        }
      },
      diff: async (input) => extractData<Array<{ file?: string }>>(await sdk.session.diff(input as never)),
    },
    event: {
      subscribe: async (input) => {
        return { stream: createSseStream(baseUrl, password, input?.signal) }
      },
    },
  }
}

export function createSandboxOpencodeClient(baseUrl: string, password?: string): OpencodeClient {
  const fetchImpl = withOptionalAuth(password)
  const sdkClient = createSdkClient({
    baseUrl,
    fetch: fetchImpl,
    throwOnError: true,
    responseStyle: "data",
  })
  return createRuntimeClient(sdkClient, baseUrl, password)
}

export async function syncProviderRegistry(client: OpencodeClient, registry: ProviderRegistry): Promise<void> {
  const authMethodsByProvider = await client.provider.auth()
  const providerList = await client.provider.list()

  const providers: ProviderRecord[] = (providerList.all || []).map((provider) => ({
    id: provider.id,
    methods: (authMethodsByProvider[provider.id] || []).map((method) => ({
      label: method.label,
      kind: classifyAuthMethod(method.label),
    })),
    models: Object.entries(provider.models || {}).map(([modelId, model]) => ({
      id: model.id || modelId,
      label: model.name,
      contextWindow: model.limit?.context,
    })),
  }))

  registry.setProviders(providers)
}
