# Discord Bridge for OpenCode - Architecture Overview

This is a **Discord bot** (GitHub App/integration) that handles `/opencode` commands and orchestrates sandboxed AI coding sessions. It's built on Vercel Functions and uses Vercel Sandboxes to run OpenCode server instances.

## Tech Stack

- **Vercel Functions** - Serverless HTTP handlers
- **Vercel Sandboxes** - Ephemeral compute environments with OpenCode
- **Vercel Blob** - Persistent state storage
- **Discord.js** - Discord API library
- **@opencode-ai/sdk** - OpenCode client SDK

## Entry Point & Command Handling

| File | Purpose |
|------|---------|
| `api/discord/interactions.ts` | Main HTTP handler - receives Discord interactions, routes them, sends responses |
| `src/discord-application-commands.ts` | Slash command definitions (`/ask`, `/opencode`, `/providers`, etc.) |
| `src/interaction-command-mapper.ts` | Maps Discord interaction payloads to text commands |
| `src/command-parser.ts` | Parses text commands into structured `ParsedCommand` types |
| `src/discord-command-service.ts` | Executes parsed commands against state, providers, and credentials |

## Key Architectural Patterns

1. **Thread-per-session**: Each Discord channel thread gets its own Vercel Sandbox
2. **Blob storage for durability**: Sandboxes can be stopped; state persists in Blob
3. **Snapshot-based resumption**: Checkpoints saved as Vercel Snapshots
4. **Rate-limited Discord API**: Protects against Discord rate limits
5. **Event streaming**: SSE from OpenCode → EventRelay → Discord messages
6. **Provider abstraction**: Supports multiple AI providers via registry pattern

## Core Documentation

- [Thread Creation Flow](thread-creation.md)
- [Sandbox & Git Clone Workflow](sandbox-clone.md)
- [Discord Messaging](messaging.md)
- [State Management Stores](state-stores.md)
