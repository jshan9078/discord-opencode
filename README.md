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
4. Go to "OAuth2 > URL Generator", select `bot` scope, add `Send Messages` permission
5. Copy the generated URL and invite the bot to your server

### 2. Deploy to Vercel

```bash
# Clone and setup
git clone <this-repo>
cd discord-bridge
pnpm install
```

### 3. Configure Environment Variables

**First**, set these in Vercel dashboard (not locally):

| Variable | Description |
|----------|-------------|
| `DISCORD_APPLICATION_ID` | Your Discord app ID |
| `DISCORD_PUBLIC_KEY` | Your Discord public key (hex) |
| `DISCORD_BOT_TOKEN` | Your Discord bot token (needed for thread creation) |
| `GITHUB_TOKEN` | GitHub personal access token (needs `repo`, `read:user`, `gist` scopes) |

**Provider API keys** (optional):
- `OPENAI_API_KEY`
- `ANTHROPIC_API_KEY`
- etc.

**User config** (optional):
- `OPENCODE_GIST_URL` = URL of a private GitHub gist with your `opencode.jsonc`
- To create: run `bun scripts/bundle-config.ts` (will prompt for GitHub token or use `GITHUB_TOKEN` env var)

Now pull env vars locally and deploy:

```bash
# Link to Vercel and pull env vars (must be set in dashboard first!)
vercel link
vercel env pull

# Deploy
vercel deploy --prod
```

### 4. Register Slash Commands

```bash
DISCORD_APPLICATION_ID=xxx pnpm exec bun scripts/register-commands.ts
```

### 5. Set Provider Credentials

**Option 1: API Keys (env vars)**
```bash
OPENAI_API_KEY=sk-...      # OpenAI
ANTHROPIC_API_KEY=sk-ant-... # Anthropic
# Format: {PROVIDER}_API_KEY (uppercase)
```

**Option 2: OAuth (e.g., ChatGPT Pro/Plus)**
```bash
/auth-connect chatgpt
# Follow the URL/code displayed in Discord
# Run /auth-connect chatgpt again after completing
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
| `/auth-connect <provider>` | OAuth flow for providers (e.g., chatgpt) |

## Pricing
Everything is free out of the box if you use the Vercel hobby tier.
It relies on whatever subscription / providers you have on OpenCode.

**Hobby**: Free (5 CPU-hours/month, non-commercial)
**Pro**: $20/mo + usage (commercial)

## Documentation

- [Docs Index](./docs/index.md) - All documentation
- [Architecture](./docs/architecture/overview.md) - How it works
- [Slash Commands](./docs/commands/slash-commands.md) - Command reference
- [Auth Overview](./docs/auth/overview.md) - Credential management

## License

MIT
