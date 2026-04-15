# Discord Messaging

Located in `api/discord/interactions.ts`.

## `sendFollowup()` (lines 175-255)

Primary function for sending Discord messages.

- Uses Discord webhooks: `POST /webhooks/{applicationId}/{token}`
- Supports sending to threads via `thread_id` parameter
- Has rate limiting built-in

### Signature

```typescript
sendFollowup(
  applicationId: string,
  token: string,
  content: string,
  components?: unknown[],
  threadId?: string,
  embeds?: unknown[],
): Promise<string | undefined>
```

## `sendChunkedInteractionResponse()` (lines 303-314)

Splits long messages into chunks (1800 char limit). Sends initial response immediately, followups via `waitUntil()`.

## `editThreadMessage()` (lines 257-277)

Edits existing Discord messages (for streaming updates).

## Rate Limiting

`discord-rate-limited-fetch.ts` (89 lines):
- Rate limiter: 2 requests per 5-second window
- Handles 429 responses with retry-after
