# Agent Documentation

This codebase is a Discord bot that handles `/opencode` commands and orchestrates sandboxed AI coding sessions.

## Architecture Docs

When working on this codebase, refer to the architecture documentation:

| Document | Purpose |
|----------|---------|
| [docs/OVERVIEW.md](docs/OVERVIEW.md) | High-level architecture overview |
| [docs/thread-creation.md](docs/thread-creation.md) | How Discord threads are created for `/opencode` sessions |
| [docs/sandbox-clone.md](docs/sandbox-clone.md) | Vercel Sandbox creation and Git repository cloning |
| [docs/messaging.md](docs/messaging.md) | Discord message sending mechanisms |
| [docs/state-stores.md](docs/state-stores.md) | State management with Vercel Blob storage |

## Key Entry Points

- `api/discord/interactions.ts` - Main HTTP handler for Discord interactions
- `src/discord-application-commands.ts` - Slash command definitions
- `src/sandbox-manager.ts` - Sandbox lifecycle management

## Important Patterns

- **Thread-per-session**: Each Discord thread gets its own Vercel Sandbox
- **Blob storage for durability**: State persists even when sandboxes are stopped
- **Snapshot-based resumption**: Checkpoints saved as Vercel Snapshots
