# Discord Bridge Documentation

A serverless Discord↔OpenCode bridge using Vercel Sandbox. Send coding requests from Discord, get AI assistance running in isolated sandboxes.

## Quick Links

- [Architecture Overview](./architecture/overview.md) - System design
- [Slash Commands](./commands/slash-commands.md) - Available commands
- [Auth Overview](./auth/overview.md) - Credential management

## Architecture

### How It Works

```
Discord User → Slash Command → Vercel Functions → OpenCode Runtime → Vercel Sandbox → OpenCode Server
```

1. User sends `/ask add a login feature`
2. Vercel Function receives Discord Interaction
3. Verifies signature, maps to command
4. Connects to OpenCode server (in sandbox)
5. Streams events back to Discord

### Key Components

| Component | Purpose |
|-----------|---------|
| [Discord Integration](./architecture/discord-integration.md) | Slash commands, signature verification |
| [OpenCode Runtime](./architecture/opencode-runtime.md) | HTTP client for OpenCode |
| [Session Management](./architecture/session-management.md) | Conversation persistence |
| [Event Streaming](./architecture/event-streaming.md) | Real-time SSE relay |

## Usage

### Commands

| Command | Description |
|---------|-------------|
| `/ask` | Send coding request |
| `/opencode [owner/repo]` | Start session, optionally with repo |
| `/providers` | List available providers |
| `/models [provider]` | List models |
| `/use-provider <id>` | Switch provider |
| `/use-model <id>` | Switch model |
| `/checkpoint` | Save session as checkpoint |
| `/delete` | Remove session without checkpoint |

See [Slash Commands](./commands/slash-commands.md) for details.

### Authentication

Credentials are set via environment variables:

**API Keys:**
```bash
OPENAI_API_KEY=sk-...      # OpenAI
ANTHROPIC_API_KEY=sk-ant-... # Anthropic
```

Format: `{PROVIDER}_API_KEY` (uppercase)

**OAuth:**
```bash
/auth-connect openai
# Follow the URL/code in Discord
# Run again after completing
```

See [Auth Overview](./auth/overview.md) for details.

## Source Code

### File Reference

| File | Purpose |
|------|---------|
| `api/discord/interactions.ts` | Main handler |
| `src/prompt-orchestrator.ts` | Prompt execution flow |
| `src/channel-state-store.ts` | Per-channel state |
| `src/credential-store.ts` | Encrypted credentials |
| `src/event-relay.ts` | SSE streaming |
| `src/github-client.ts` | Repo/branch listing |

See [Source Files](./components/source-files.md) for complete reference.

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DISCORD_APPLICATION_ID` | Yes | Discord app ID |
| `DISCORD_PUBLIC_KEY` | Yes | Signature verification key |
| `DISCORD_BOT_TOKEN` | Yes | Discord bot token (for thread creation) |
| `GITHUB_TOKEN` | Yes | For repo/branch selection |
| `BLOB_READ_WRITE_TOKEN` | Yes | Vercel Blob storage token |
| `OPENCODE_CONFIG_BLOB_PATH` | No | Blob path for bundled `~/.config/opencode` (default: `opencode-config/config-bundle.json`) |

No external OpenCode server needed - the bridge creates Vercel Sandboxes and runs OpenCode inside them.

## Pricing

| Scenario | Cost |
|----------|------|
| Quick test (~2 min) | ~$0.01 |
| Feature work (~5 min) | ~$0.03 |
| Build & test (~30 min) | ~$0.34 |
| Idle | $0 |

**Hobby plan**: Free (4 CPU-hours/month, non-commercial)
**Pro plan**: $20/mo + usage (commercial use)

## Related Docs

- [Vercel Sandbox Docs](../vercel-sandbox/) - Sandbox reference
