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

function withOptionalAuth(password?: string): ((input: RequestInfo | URL, init?: RequestInit) => Promise<Response>) | undefined {
  if (!password) {
    return undefined
  }

  const auth = `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}`
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const headers = new Headers(init?.headers)
    headers.set("Authorization", auth)
    return await fetch(input, {
      ...init,
      headers,
    })
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
    create(input: { body: { title: string } }): Promise<{ id: string }>
    get(input: { path: { id: string } }): Promise<unknown>
    promptAsync(input: {
      path: { id: string }
      body: {
        model: { providerID: string; modelID: string }
        parts: Array<{ type: "text"; text: string }>
      }
    }): Promise<void>
    diff(input: { path: { id: string }; query?: { messageID?: string } }): Promise<Array<{ file?: string }>>
  }
  event: {
    subscribe(input?: { signal?: AbortSignal }): Promise<{ stream: AsyncIterable<RuntimeEvent> }>
  }
}

function createRuntimeClient(sdk: SdkClient): OpencodeClient {
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
      promptAsync: async (input) => {
        await sdk.session.promptAsync(input as never)
      },
      diff: async (input) => extractData<Array<{ file?: string }>>(await sdk.session.diff(input as never)),
    },
    event: {
      subscribe: async (input) => {
        const events = await sdk.event.subscribe(input as never)
        return { stream: events.stream as AsyncIterable<RuntimeEvent> }
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
  return createRuntimeClient(sdkClient)
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
