# Architecture Overview

The Discord Bridge connects Discord users to an OpenCode coding agent running inside Vercel Sandboxes. This document provides a high-level view of how the system works together.

## System Diagram

```
Discord User
    │
    ▼
Discord API (Interactions)
    │
    ▼
Vercel Functions (Fluid Compute)
    │
    └─► api/discord/interactions.ts
            │
            ├─► Command parsing & routing
            ├─► Channel state management
            ├─► Project selection (GitHub API)
            │
            └─► OpenCode Runtime (HTTP)
                    │
                    ▼
              OpenCode Server (per sandbox)
                    │
                    ├─► Project files
                    ├─► Session DB
                    ├─► Provider auth
                    └─► Tools (gh, git, editor, etc.)
```

## Core Concepts

### 1. Serverless Discord Integration

The bridge uses **Discord Interactions** (slash commands) rather than the Gateway websocket. This means:

- **No always-on host** required
- Each request is independent
- Runs on Vercel Fluid Compute (`vercel.json` with `fluid: true`)
- Signature verification via Ed25519

### 2. Per-Channel Sandboxes

Each Discord channel maps to a persistent Vercel Sandbox:

- **Sandbox name**: `discord-channel-{channelId}`
- **Persistence**: Files and state survive across requests
- **Auto-stop**: Sandboxes idle and stop when not in use
- **Cost**: Only pay while actively running (~0.03/min for typical tasks)

### 3. OpenCode Server

Inside each sandbox, OpenCode runs as an HTTP server:

- **Port**: 4096
- **Auth**: Basic auth with server password
- **Session state**: Preserved between prompts
- **Events**: SSE stream for real-time updates

### 4. Single-User Credential Strategy

As a self-hosted tool, the bridge maintains one canonical credential bundle:

- **Provider auth**: OAuth tokens, API keys stored encrypted locally
- **GitHub token**: For repo/branch selection and `gh` CLI
- **No per-channel prompts**: Credentials sync to any sandbox

---

## Data Flow

### Slash Command Processing

1. **Discord sends** interaction payload to `/api/discord/interactions`
2. **Verify** signature using public key
3. **Map** command options to text via `interaction-command-mapper.ts`
4. **Parse** text into structured command via `command-parser.ts`
5. **Execute** command via `discord-command-service.ts`
6. **Return** response (or defer for async prompt)

### Prompt Execution

1. **Load** channel state (provider, model, project, session)
2. **Sync** provider registry from OpenCode server
3. **Bootstrap** credentials into runtime
4. **Resolve** or create OpenCode session
5. **Subscribe** to SSE events
6. **Send** prompt via `POST /session/:id/prompt_async`
7. **Relay** events to Discord as they arrive
8. **Post** final response

---

## Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| Slash commands | Serverless-friendly, no Gateway needed |
| Per-channel sandbox | Isolated state, auto-persistence |
| Single-user credentials | Self-hosted use case, no multi-tenant complexity |
| SSE event relay | Real-time updates without polling |
| Provider-agnostic | Works with OpenAI, Anthropic, any provider |

---

## Related Docs

- [Discord Integration](./discord-integration.md) - Slash commands, signature verification
- [OpenCode Runtime](./opencode-runtime.md) - HTTP client, session management
- [Event Streaming](./event-streaming.md) - SSE relay, event types
- [Slash Commands](./commands/slash-commands.md) - Available commands
- [Auth Overview](./auth/overview.md) - Credential management
- [Source Files](./components/source-files.md) - Code modules explained