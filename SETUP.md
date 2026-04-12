# Discord AI Coding Agent - Quick Setup Guide

This guide gets you from nothing to working Discord bot in ~15 minutes.

---

## TL;DR

```
You need:
  1. Discord bot token     (5 min)
  2. Vercel account        (2 min)
  3. Run setup            (3 min)

Done. Start coding from Discord.
```

---

## Before You Start

You'll need accounts at:
- [Discord Developer Portal](https://discord.com/developers/applications)
- [Vercel](https://vercel.com) (Pro plan recommended for persistent sandboxes)

---

## Step 1: Get Discord Bot Token (5 min)

1. Go to https://discord.com/developers/applications
2. Click **New Application** → name it (e.g., "Coding Bot")
3. Go to **Bot** → click **Reset Token** → copy it
4. Under **Privileged Gateway Intents** → enable **Message Content Intent**
5. Go to **OAuth2 → URL Generator**
6. Select scopes: `bot`
7. Select permissions: `Send Messages`, `Read Message History`, `Attach Files`
8. Copy the generated URL → open in browser → select your Discord server

**Token:** Save it for later.

---

## Step 2: Set Up Vercel (2 min)

1. Go to https://vercel.com → Sign up/Login
2. Create a new project (empty is fine - just needs to exist)
3. Run locally:
   ```bash
   vercel link
   vercel env pull
   ```
4. This creates `.env.local` with `VERCEL_OIDC_TOKEN`

---

## Step 3: Deploy the Serverless Bridge

```bash
# Deploy to Vercel
pnpm run deploy  # or `vercel deploy --prod`

# Set these environment variables in Vercel:
export DISCORD_BOT_TOKEN=your_discord_token
export DISCORD_PUBLIC_KEY=... # Discord app public key
export DISCORD_APPLICATION_ID=...
export VERCEL_OIDC_TOKEN=...  # From `vercel env pull`
export BRIDGE_SECRET=...      # >= 16 chars, used for encrypted auth store
export GITHUB_TOKEN=...       # For repo/branch selection
export OPENCODE_BASE_URL=...  # Your OpenCode server URL
export OPENCODE_SERVER_PASSWORD=...
```

### Register Discord Commands

Set the Interactions endpoint URL in Discord Developer Portal to:
- `https://<your-vercel-project>.vercel.app/api/discord/interactions`

Then register commands:

```bash
# Guild scope (fast updates, recommended while iterating)
DISCORD_APPLICATION_ID=... DISCORD_BOT_TOKEN=... DISCORD_GUILD_ID=... pnpm exec bun scripts/register-commands.ts

# Global scope
DISCORD_APPLICATION_ID=... DISCORD_BOT_TOKEN=... pnpm exec bun scripts/register-commands.ts
```

---

## Step 3.1: Configure Auth Locally (no secrets in Discord)

All secrets are entered on the bridge host, never in Discord messages or DMs.

```bash
# Check auth status
pnpm exec bun scripts/auth.ts status

# OAuth/device/browser providers (OpenAI and others)
pnpm exec bun scripts/auth.ts connect openai

# API key providers (read from stdin)
printf %s "$ANTHROPIC_API_KEY" | pnpm exec bun scripts/auth.ts set-key anthropic --stdin

# GitHub token (read from stdin)
printf %s "$GITHUB_TOKEN" | pnpm exec bun scripts/auth.ts github --stdin
```

---

## Step 4: Set a Project

In Discord, run:

```
/project select
```

This opens an interactive menu to select a GitHub repository and branch.

---

## Step 5: Start Coding

Now just send prompts:

```
/ask add a login feature
/ask fix the bug in auth.ts
/ask write tests for user.ts

# Provider/model controls
/providers
/models
/use-provider openai
/use-model openai/gpt-5.1-mini
```

---

## How It Works

```
Discord → Bridge → Vercel Sandbox
                    ↓
              Per channel sandbox
              (persistent, auto-save)
                    ↓
              OpenCode CLI
```

Each Discord channel gets its own persistent sandbox:
- Name: `discord-channel-{channelId}`
- Auto-saves on stop
- Resumes automatically on next message

---

## Common Issues

### Slash commands not responding

- Verify the Interactions endpoint URL is set in Discord Developer Portal
- Check Vercel function logs for errors

### "Provider needs auth"

- Run host-local auth commands from Step 3.1
- Do not paste API keys into Discord

### "GitHub not configured"

- Set `GITHUB_TOKEN` in Vercel environment variables

---

## Cost

| Item | Cost |
|------|------|
| Vercel Pro | $20/mo credit (~156 CPU-hours) |
| Per task | ~$0.03 typical |
| Idle | $0 |

Pro plan credit covers ~5,000 typical tasks/month.
