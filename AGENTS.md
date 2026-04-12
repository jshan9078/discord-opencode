# Discord Bridge Agent Instructions

This repository contains documentation for a Discord↔AI coding agent system using Vercel Sandbox.

## Key Decisions (Do NOT change without user confirmation)

| Decision | Value | Reason |
|----------|-------|--------|
| Compute | Vercel Sandbox | Pay per use, fast startup, auto-save |
| Discord trigger | `/ask` slash command | Serverless-friendly, no Gateway needed |
| MCPs | None by default | OpenCode + gh CLI is sufficient |
| Sessions | Per-channel | Each Discord channel = persistent sandbox |
| Session persistence | Auto | Via persistent sandboxes (auto-save on stop) |
| Package manager | pnpm | npm has known supply chain vulnerabilities |

## Documents

| Document | Purpose |
|----------|---------|
| `docs/architecture/overview.md` | Architecture overview |
| `docs/index.md` | Main docs index |
| `docs/vercel-sandbox/` | Vercel Sandbox reference docs |

## How to Use This System

### Vercel Sandbox (Default)
1. Link to Vercel project: `vercel link`
2. Pull env: `vercel env pull`
3. Configure: Set `DISCORD_APPLICATION_ID`, `DISCORD_PUBLIC_KEY`, `GITHUB_TOKEN`
4. Deploy: `vercel deploy --prod`
5. Register commands: `pnpm exec bun scripts/register-commands.ts`
6. In Discord: Use `/ask add feature` (slash command)

Each Discord channel maps to a persistent sandbox named `discord-channel-{channelId}`.

## Pricing

- **Pro plan**: $20/mo credit (~156 CPU-hours)
- **Pay per use**: ~$0.03 per typical task
- **Idle**: $0 (no cost when not running)

## When Changing Core Decisions

1. Note all affected files (grep for the term)
2. Update config AND all examples/documents
3. Verify with full grep before concluding

## Important Constraints

- Always use `/ask` in examples
- Default to minimal MCPs - add only if user requests
- Document scaling: Pro plan handles most use cases
