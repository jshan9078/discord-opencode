# Discord Bridge for OpenCode - Architecture Overview

This is a **Discord bot** (GitHub App/integration) that handles `/ask` commands and orchestrates sandboxed AI coding sessions. It's built on Vercel Functions and uses Vercel Sandboxes to run OpenCode server instances.

## Tech Stack

- **Vercel Functions** - Serverless HTTP handlers
- **Vercel Sandboxes** - Persistent compute environments with OpenCode (beta SDK, auto-snapshot on stop)
- **Vercel Blob** - Persistent state storage
- **Discord.js** - Discord API library
- **@opencode-ai/sdk** - OpenCode client SDK

## Key Architectural Patterns

1. **One channel = one repo**: Each Discord channel is associated with one GitHub repository via `/project`
2. **Thread-per-session**: Each Discord channel thread gets its own named Vercel Sandbox
3. **Persistent sandboxes**: Sandboxes auto-snapshot filesystem on stop and auto-resume on request
4. **Blob storage for durability**: Thread metadata and state persists in Blob
5. **Rate-limited Discord API**: Protects against Discord rate limits
6. **Event streaming**: SSE from OpenCode → EventRelay → Discord messages
7. **Provider abstraction**: Supports multiple AI providers via registry pattern

## Core Documentation

- [Thread Creation Flow](thread-creation.md)
- [Sandbox & Git Clone Workflow](sandbox-clone.md)
- [Discord Messaging](messaging.md)
- [State Management Stores](state-stores.md)
