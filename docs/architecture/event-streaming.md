# Event Streaming

The bridge subscribes to OpenCode's SSE (Server-Sent Events) stream to get real-time updates as the agent works. This document explains the event flow and how events map to Discord messages.

## Event Types

OpenCode sends various event types during prompt processing:

| Event | Description | Discord Action |
|-------|-------------|----------------|
| `message.part.delta` | Text chunk from assistant | Stream to user |
| `message.part.updated` | Message content changed | Update display |
| `tool.started` | Tool execution began | Show "⏳ Tool: X" |
| `tool.completed` | Tool execution finished | Show "✅ Tool: X" |
| `question.asked` | Agent needs user input | Send question |
| `permission.asked` | Agent needs approval | Send permission request |
| `session.error` | Error occurred | Show error message |
| `session.completed` | Prompt finished | Post final response |
| `server.connected` | Client connected | (ignored) |
| `server.heartbeat` | Keepalive | (ignored) |

## Event Relay Architecture

```
OpenCode Server (SSE)
        │
        ▼
event-relay.ts
   │
   ├───► sink.onTextDelta()
   ├───► sink.onToolActivity()  
   ├───► sink.onToolRequest()
   ├───► sink.onToolResult()
   ├───► sink.onQuestion()
   ├───► sink.onPermission()
   └───► sink.onError()
        │
        ▼
 Discord followup messages
```

## Sink Interface

The `event-relay.ts` defines a sink interface:

```typescript
export interface EventRelaySink {
  onTextDelta(text: string): Promise<void>
  onToolActivity(message: string): Promise<void>
  onToolRequest?(payload: { toolCallId?: string; toolName: string; requestSummary?: string }): Promise<void>
  onToolResult?(payload: { toolCallId?: string; toolName: string; resultSummary?: string }): Promise<void>
  onQuestion(message: string): Promise<void>
  onPermission(message: string): Promise<void>
  onError(message: string): Promise<void>
}
```

## Implementation in interactions.ts

The Discord endpoint implements this sink:

```typescript
const sink = {
  onTextDelta: async (text) => { responseBuffer += text },
  onToolActivity: async (msg) => { 
    await sendFollowup(appId, token, `> ${msg}`) 
  },
  onToolRequest: async (payload) => {
    await sendFollowup(appId, token, `> ⏳ Tool: ${payload.toolName}`, buildToolButtons(...))
  },
  onToolResult: async (payload) => {
    await sendFollowup(appId, token, `> ✅ Tool: ${payload.toolName}`, buildToolButtons(...))
  },
  onQuestion: async (msg) => { 
    await sendFollowup(appId, token, `> ${msg}`) 
  },
  onPermission: async (msg) => { 
    await sendFollowup(appId, token, `> ${msg}`) 
  },
  onError: async (msg) => { 
    await sendFollowup(appId, token, `> Error: ${msg}`) 
  },
}
```

## Event Parsing

The `event-relay.ts` parses raw SSE data:

```typescript
function parseEvent(line: string): { type: string; data: unknown } | null {
  if (!line.startsWith("data: ")) return null
  const json = line.slice(6)
  return JSON.parse(json)
}
```

Each event has:
- `type` - Event name (e.g., "message.part.delta")
- `sessionID` - Which session it belongs to
- `properties` - Event-specific data

## Terminal Events

The relay knows when to stop waiting:

```typescript
export function isTerminalSessionEvent(event: EventEnvelope): boolean {
  if (event.type === "session.completed" || event.type === "session.idle") return true
  if (event.type === "response.completed" || event.type === "prompt.completed") return true
  // Also consider message.updated with status "complete"
}
```

## Timeout Handling

The relay has configurable timeouts:

```typescript
const relayResult = await relaySessionEvents(client, sink, sessionId, {
  maxIdleMs: 45_000,    // No events for 45s = timeout
  maxTotalMs: 10 * 60_000,  // Total 10 minutes max
})
```

If it times out, the bridge returns an error but preserves the session for retry.

## Tool Buttons (Expandable Details)

For each tool, three buttons are rendered:

- **Request** - Shows what was sent to the tool
- **Result** - Shows what the tool returned
- **JSON** - Shows raw JSON

```typescript
function buildToolButtons(toolName: string, requestData: string, resultData: string): unknown[] {
  return [{
    type: 1,
    components: [
      { type: 2, custom_id: `tool:req:${encoded}`, label: "Request", style: 2 },
      { type: 2, custom_id: `tool:res:${encoded}`, label: "Result", style: 2 },
      { type: 2, custom_id: `tool:json:${encoded}`, label: "JSON", style: 2 },
    ],
  }]
}
```

Data is base64url-encoded in the custom_id for serverless button handling.

## Related Files

- `src/event-relay.ts` - Event subscription and parsing
- `api/discord/interactions.ts` - Sink implementation
- `src/prompt-orchestrator.ts` - Orchestrates the relay