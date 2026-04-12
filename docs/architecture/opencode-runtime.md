# OpenCode Runtime

The OpenCode runtime bridges the serverless Discord endpoint to the OpenCode server running inside a Vercel Sandbox. This document covers the HTTP client and how it interacts with OpenCode.

## Overview

The `opencode-runtime.ts` provides a TypeScript client for OpenCode's REST API:

```typescript
const runtime = new OpencodeRuntime(baseUrl, password)
await runtime.health()
const sessionId = await runtime.createSession("my-session")
await runtime.promptAsync(sessionId, "hello")
```

## API Endpoints Used

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/global/health` | Health check |
| GET | `/provider/auth` | List available providers/methods |
| GET | `/model` | List available models |
| POST | `/session` | Create new session |
| GET | `/session/:id` | Get session info |
| POST | `/session/:id/prompt_async` | Send prompt (async) |
| GET | `/event` | SSE event stream |
| PUT | `/auth/:id` | Set provider auth |
| POST | `/provider/:id/oauth/authorize` | Start OAuth flow |
| POST | `/provider/:id/oauth/callback` | Complete OAuth flow |

## Creating a Session

```typescript
async createSession(title: string): Promise<string> {
  const response = await this.request<{ data: { id: string } }>("/session", {
    method: "POST",
    body: { title },
  })
  return response.data.id
}
```

Sessions are keyed by ID and persist their conversation history inside the sandbox.

## Sending Prompts

```typescript
async promptAsync(sessionId: string, prompt: string): Promise<void> {
  await this.request(`/session/${sessionId}/prompt_async`, {
    method: "POST",
    body: {
      parts: [{ type: "text", text: prompt }],
    },
  })
}
```

The `prompt_async` endpoint triggers processing but returns immediately - events stream separately via SSE.

## Event Subscription

```typescript
async subscribeEvents(signal?: AbortSignal): AsyncIterable<RuntimeEvent> {
  const response = await fetch(`${this.baseUrl}/event`, {
    headers: this.headers,
    signal,
  })
  
  const body = response.body!
  const reader = body.getReader()
  const decoder = new TextDecoder()
  
  // Yields events as they arrive
}
```

Events are Server-Sent Events (SSE) with format:
```
event: message.part.delta
data: {"type":"message.part.delta","sessionID":"abc","properties":{"content":"Hello"}}
```

## Syncing Provider Registry

At runtime, the bridge syncs available providers from OpenCode:

```typescript
async syncRegistry(registry: ProviderRegistry): Promise<void> {
  // Fetch auth methods per provider
  const methodsByProvider = await this.fetchProviderAuthMethods()
  
  // Fetch available models
  const modelIds = await this.fetchModelIds()
  
  // Build registry entries
  const providers: ProviderRecord[] = Object.entries(methodsByProvider).map(...)
  
  registry.setProviders(providers)
}
```

This keeps the in-memory `ProviderRegistry` in sync with what OpenCode actually supports.

## Setting Provider Auth

For API key auth:

```typescript
async setProviderAuth(providerId: string, payload: Record<string, unknown>): Promise<void> {
  await this.request(`/auth/${providerId}`, {
    method: "PUT",
    body: payload,
  })
}
```

The payload format varies by provider but typically includes `api_key` or `access_token`.

## Authentication

The runtime uses Basic Auth:

```typescript
constructor(baseUrl: string, password?: string) {
  if (password) {
    this.headers.Authorization = `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}`
  }
}
```

The password is set when starting OpenCode:
```bash
OPENCODE_SERVER_PASSWORD=secret opencode serve --port 4096
```

## Usage in the Bridge

The runtime is used by `prompt-orchestrator.ts`:

1. **Create client** via `toClient()` adapter
2. **Sync registry** to know available providers
3. **Ensure auth** - bootstrap credentials via `auth-bootstrap.ts`
4. **Resolve session** - get or create via `session-manager.ts`
5. **Subscribe events** - relay to Discord
6. **Send prompt** - kick off processing

```typescript
const runtime = new OpencodeRuntime(baseUrl, password)
const client = toClient(runtime)
await runtime.syncRegistry(registry)
// ... auth, session, events ...
await runtime.promptAsync(sessionId, prompt)
```

## Related Files

- `src/opencode-runtime.ts` - HTTP client implementation
- `src/prompt-orchestrator.ts` - Main orchestration
- `src/auth-bootstrap.ts` - Auth bootstrapping
- `src/session-manager.ts` - Session management
- `src/event-relay.ts` - SSE handling