# Discord Bridge

A serverless Discord↔OpenCode bridge that lets you code from Discord using AI agents running in Vercel Sandboxes.

## What It Does

```
You (Discord)          →    /ask add a login feature
                            ↓
Vercel Functions       →    Verifies request, routes command
                            ↓
OpenCode Server        →    Runs in isolated sandbox
(sandbox)              →    Executes your coding task
                            ↓
You (Discord)          ←    Streams results back
```

- **Slash commands** for all interactions (`/ask`, `/project`, `/providers`, etc.)
- **Per-channel sandboxes** - each Discord channel gets its own persistent sandbox
- **Real-time streaming** - watch the agent work as events arrive
- **No always-on host** - fully serverless on Vercel

## Quick Start

### 1. Create a Discord Application

1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. Create a new application
3. Get your **Public Key** and **Application ID**
4. Enable Message Content Intent
5. Generate OAuth2 URL with `bot` scope and `Send Messages` permission
6. Invite the bot to your server

### 2. Deploy to Vercel

```bash
# Clone and setup
git clone <this-repo>
cd discord-bridge
pnpm install

# Link to Vercel
vercel link
vercel env pull

# Deploy
vercel deploy --prod
```

### 3. Configure Environment Variables

In Vercel dashboard, set:

| Variable | Description |
|----------|-------------|
| `DISCORD_APPLICATION_ID` | Your Discord app ID |
| `DISCORD_PUBLIC_KEY` | Your Discord public key (hex) |
| `GITHUB_TOKEN` | GitHub personal access token |
| `BRIDGE_SECRET` | Random string (16+ chars) for encrypting credentials |
| `OPENCODE_BASE_URL` | Your OpenCode server URL |
| `OPENCODE_SERVER_PASSWORD` | Your OpenCode server password |

### 4. Register Slash Commands

```bash
DISCORD_APPLICATION_ID=xxx DISCORD_BOT_TOKEN=xxx pnpm exec bun scripts/register-commands.ts
```

### 5. Set Up Auth (Host-Local)

Credentials never go through Discord. Run on your machine:

```bash
# Check auth status
pnpm exec bun scripts/auth.ts status

# Connect OAuth provider
pnpm exec bun scripts/auth.ts connect openai

# Or set API key
printf %s "$ANTHROPIC_API_KEY" | pnpm exec bun scripts/auth.ts set-key anthropic --stdin

# GitHub token
printf %s "$GITHUB_TOKEN" | pnpm exec bun scripts/auth.ts github --stdin
```

## Commands

| Command | Description |
|---------|-------------|
| `/ask <prompt>` | Send a coding request |
| `/project select` | Pick a repo/branch via menu |
| `/project set <url> [branch]` | Set project directly |
| `/project show` | View current project |
| `/project clear` | Clear project |
| `/providers` | List available providers |
| `/models` | List available models |
| `/use-provider <id>` | Switch provider |
| `/use-model <id>` | Switch model |

## Pricing

| Task | Cost |
|------|------|
| Quick fix (~2 min) | ~$0.01 |
| Feature work (~5 min) | ~$0.03 |
| Build & test (~30 min) | ~$0.34 |
| Idle | $0 |

**Vercel Pro**: $20/mo credit (~156 CPU-hours)

## Documentation

- [Setup Guide](./SETUP.md) - Detailed setup instructions
- [Architecture](./docs/architecture/overview.md) - How it works
- [Slash Commands](./docs/commands/slash-commands.md) - Command reference
- [Auth Overview](./docs/auth/overview.md) - Credential management
- [Source Files](./docs/components/source-files.md) - Code reference

## License

MIT