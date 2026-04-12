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

### 3. Create Vercel Blob Store

In the Vercel dashboard, add Blob to this project.

That will provision Blob storage and inject:

```text
BLOB_READ_WRITE_TOKEN
```

The bridge uses Blob to store the durable provider registry snapshot for `/providers`, `/models`, and `/ask`.

### 4. Configure Environment Variables

Set these in your Vercel project first. You can do that either in the Vercel dashboard or with `vercel env add`.

These values live in Vercel and are used by the deployed app:

| Variable | Description |
|----------|-------------|
| `DISCORD_APPLICATION_ID` | Your Discord app ID |
| `DISCORD_PUBLIC_KEY` | Your Discord public key (hex) |
| `DISCORD_BOT_TOKEN` | Your Discord bot token (needed for thread creation) |
| `GITHUB_TOKEN` | GitHub personal access token (needs `repo`, `read:user`, `gist` scopes) |
| `BLOB_READ_WRITE_TOKEN` | Vercel Blob token for provider registry storage |
| `SESSION_BASE_DIR` | Optional session/config storage path. Recommended for serverless: `/tmp/opencode-chat-bridge` |

**Provider API keys** (optional):
- `OPENAI_API_KEY`
- `ANTHROPIC_API_KEY`
- etc.

**User config** (optional - your personal OpenCode settings like aliases, templates):
- `OPENCODE_GIST_URL` = URL of a private GitHub gist with your `opencode.jsonc`
- To create: run `pnpm tsx scripts/bundle-config.ts` (bundles your local OpenCode config into a gist)

`BLOB_READ_WRITE_TOKEN` is used to store the durable provider registry snapshot that powers `/providers`, `/models`, and `/ask`.

**Serverless storage** (recommended on Vercel):
- `SESSION_BASE_DIR=/tmp/opencode-chat-bridge`
- This avoids sandbox/home-directory write issues for channel state, credentials, and recovery data

After the env vars are set in Vercel, pull a local copy for scripts like `register-commands`:

```bash
# Link this folder to your Vercel project
vercel link

# Download Vercel env vars into .env.local for local scripts
vercel env pull

# Deploy the current code
vercel deploy --prod
```

Notes:
- Vercel env vars are the source of truth for the deployed app
- `.env.local` is just a local copy used by scripts in this repo
- `vercel env pull` does not set remote env vars, it only downloads them locally

### 5. Register Slash Commands

```bash
pnpm tsx scripts/register-commands.ts
# (uses .env.local values - run `vercel env pull` first to get them)
```

### 6. Set Discord Interactions URL

In the Discord Developer Portal for your application, set:

```text
https://your-vercel-domain.vercel.app/api/discord/interactions
```

Example:

```text
https://discord-bridge-sigma.vercel.app/api/discord/interactions
```

Discord will verify this URL immediately, so make sure:
- your latest code is deployed to Vercel
- `DISCORD_PUBLIC_KEY` in Vercel matches the same Discord application
- the URL uses HTTPS and points to `/api/discord/interactions`

### 7. Initialize Provider Registry

Run this once in Discord after the interactions URL is working:

```text
/update
```

This creates or refreshes the stored provider registry snapshot from `models.dev`.
Run `/update` again any time you want the latest provider/model list.

This requires Vercel Blob to be configured for the project.

### 8. Set Default Provider And Model

In any normal Discord channel, set your default provider and model:

```text
/use-provider openai
/use-model gpt-5
```

Those defaults are stored in Blob per user.

When you run commands inside a bridge thread, the thread starts from your global defaults and can override them independently.
If you have not set global defaults yet, the thread will tell you to do that first.

### 9. Set Provider Credentials

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
| `/health-check` | Fast bridge health check |
| `/update` | Refresh provider registry snapshot |
| `/providers` | List available providers |
| `/models [provider]` | List available models (provider autocomplete) |
| `/use-provider <id>` | Set default provider, or override provider inside a thread |
| `/use-model <id>` | Set default model, or override model inside a thread |
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
