# Discord Bridge Documentation

A serverless Discord↔OpenCode bridge using Vercel Sandbox. Send coding requests from Discord, get AI assistance running in isolated sandboxes.

## Quick Links

- [Setup Guide](../../SETUP.md) - Get running in 15 minutes
- [Architecture Overview](./architecture/overview.md) - System design
- [Slash Commands](./commands/slash-commands.md) - Available commands
- [API Reference](./api/reference.md) - OpenCode API endpoints

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
| `/project select` | Pick repo/branch via menu |
| `/project set <url> [branch]` | Set project directly |
| `/project show` | View current project |
| `/providers` | List available providers |
| `/models [provider]` | List models |
| `/use-provider <id>` | Switch provider |
| `/use-model <id>` | Switch model |

See [Slash Commands](./commands/slash-commands.md) for details.

### Authentication

Credentials are entered on the host machine, never in Discord:

```bash
# Connect OAuth provider
pnpm exec bun scripts/auth.ts connect openai

# Set API key
printf %s "$ANTHROPIC_API_KEY" | pnpm exec bun scripts/auth.ts set-key anthropic --stdin

# GitHub token
printf %s "$GITHUB_TOKEN" | pnpm exec bun scripts/auth.ts github --stdin
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
| `BRIDGE_SECRET` | Yes | Credential encryption key |
| `GITHUB_TOKEN` | Yes | For repo/branch selection |
| `OPENCODE_BASE_URL` | Yes | OpenCode server URL |
| `OPENCODE_SERVER_PASSWORD` | Yes | OpenCode server password |

## Pricing

| Scenario | Cost |
|----------|------|
| Quick test (~2 min) | ~$0.01 |
| Feature work (~5 min) | ~$0.03 |
| Build & test (~30 min) | ~$0.34 |
| Idle | $0 |

Pro plan: $20/mo credit (~156 CPU-hours)

## Related Docs

- [Vercel Sandbox Docs](../vercel-sandbox/) - Sandbox reference
- [SETUP.md](../../SETUP.md) - Installation guide
- [AGENTS.md](../../AGENTS.md) - Agent instructions