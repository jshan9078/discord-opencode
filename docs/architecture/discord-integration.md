# Discord Integration

The bridge uses Discord Interactions (slash commands) for a fully serverless architecture. This document explains how Discord interactions flow through the system.

## Why Interactions?

Traditional Discord bots use the Gateway websocket (always-on). With slash commands:

- **No persistent connection** - Each request is independent
- **Serverless** - Deploy to Vercel Functions
- **Signature verification** - Ed25519 ensures request authenticity
- **Rich UI** - Select menus, buttons, modals

## Interaction Types

| Type | Description | Handler |
|------|-------------|---------|
| `1` (Ping) | Discord health check | Return `{ type: 1 }` |
| `2` (ApplicationCommand) | Slash command invocation | Main handler |
| `3` (MessageComponent) | Button/select menu clicks | Tool buttons, project select |

## Request Flow

```
1. User types /ask add a login feature
2. Discord sends POST to https://your-app.vercel.app/api/discord/interactions
3. Headers contain:
   - x-signature-ed25519
   - x-signature-timestamp
4. Verify signature using nacl.sign.detached.verify()
5. Parse interaction payload
6. Map to command via interaction-command-mapper.ts
7. Execute and respond
```

## Signature Verification

Discord signs requests using Ed25519. The verification happens in `api/discord/interactions.ts`:

```typescript
function verifyDiscordRequest(
  body: string,
  signature: string,
  timestamp: string,
  publicKey: string,
): boolean {
  const msg = Buffer.from(timestamp + body)
  const sig = Buffer.from(signature, "hex")
  const key = Buffer.from(publicKey, "hex")
  return nacl.sign.detached.verify(msg, sig, key)
}
```

Required env vars:
- `DISCORD_PUBLIC_KEY` - Your app's public key (hex)
- `DISCORD_APPLICATION_ID` - Your app's ID

## Command Mapping

The `interaction-command-mapper.ts` transforms Discord's payload format into text commands:

```
/ask prompt="add login"      → { type: "prompt", text: "add login" }
/opencode owner/repo         → { type: "command", text: "opencode owner/repo" }
/use-provider openai         → { type: "command", text: "use provider openai" }
```

This allows reuse of the existing `command-parser.ts` which handles text commands.

## Slash Commands Available

| Command | Options | Description |
|--------|---------|-------------|
| `/ask` | `prompt: string` | Send coding request |
| `/opencode` | `project?: string` | Start session, optionally with repo |
| `/checkpoint` | - | Save current session as checkpoint |
| `/delete` | - | Remove session without checkpoint |
| `/providers` | - | List available providers |
| `/models` | `provider?: string` | List models |
| `/use-provider` | `provider: string` | Set active provider |
| `/use-model` | `model: string` | Set active model |
| `/auth-connect` | `provider, method?` | Show auth instructions |
| `/auth-set-key` | `provider` | Show key setup instructions |
| `/auth-disconnect` | `provider` | Clear provider auth |

## Interactive Components

### Project Selection (Select Menus)

```
/opencode (with autocomplete for owner/repo)
  └─ User picks "owner/repo" or types directly
        └─ Thread session created with project cloned
```

The GitHub API calls happen in `github-client.ts`:
- `listRepos()` - Fetches user's repos
- `listBranches(owner, repo)` - Fetches repo branches

### Tool Buttons (Expandable Details)

After tool execution, three buttons appear per tool:
- **Request** - Show the tool call request
- **Result** - Show the tool call result  
- **JSON** - Show raw JSON

Data is encoded in the `custom_id`:
```typescript
function encodeToolPayload(kind: string, toolName: string, data: string): string {
  const payload = JSON.stringify({ k: kind, t: toolName, d: data })
  return Buffer.from(payload).toString("base64url").slice(0, 100)
}
```

## Response Types

Discord expects specific response types:

| Type | Value | Use |
|------|-------|-----|
| Pong | `{ type: 1 }` | Health check |
| Ack | `{ type: 5 }` | Deferred (async) |
| ChannelMessage | `{ type: 4, data: { content, components } }` | Immediate reply |

The bridge uses:
- Type 5 (ACK) for `/ask` - processing happens async via `waitUntil()`
- Type 4 for everything else - immediate responses

## Registration

Commands are registered via `scripts/register-commands.ts`:

```typescript
// Guild scope (fast updates during dev)
DISCORD_GUILD_ID=... node scripts/register-commands.ts

// Global scope (slow, for production)
node scripts/register-commands.ts
```

Set the Interactions URL in Discord Developer Portal:
```
https://your-app.vercel.app/api/discord/interactions
```

## Related Files

- `api/discord/interactions.ts` - Main handler
- `src/interaction-command-mapper.ts` - Payload to text
- `src/command-parser.ts` - Text to structured command
- `src/discord-application-commands.ts` - Command definitions
- `src/github-client.ts` - Repo/branch listing
- `scripts/register-commands.ts` - Registration script