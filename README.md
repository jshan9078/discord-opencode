<h1 align="center">OpenCord</h1>
<p align="center">A serverless Discord bot that bridges your Discord server to AI-powered coding agents running in Vercel Sandboxes. Code, debug, and ship directly from Discord.</p>

## How It Works

```
You (Discord)             →    /project owner/repo
                                ↓
                            Sets repo for channel
                                ↓
You (Discord)             →    /ask fix the login bug
                                ↓
Vercel Functions          →    Creates thread + sandbox
                                ↓
OpenCode (sandbox)        →    Clones repo, runs your task
                                ↓
You (Discord)             ←    Streams results back
```

- **Thread-bound sessions** — Each Discord thread maps to one sandbox + one OpenCode session
- **Real-time streaming** — Watch the agent work as events arrive
- **GitHub integration** — Clone any repo into an isolated sandbox
- **Provider flexibility** — Use OpenAI, Anthropic, or any OpenCode-compatible provider
- **Fully serverless** — No always-on host, runs on Vercel Functions

## Tech Stack

| Layer | Technology |
|-------|------------|
| Hosting | Vercel Functions |
| Compute | Vercel Sandboxes (beta, persistent mode) |
| Persistence | Vercel Blob |
| Discord | discord.js |
| AI SDK | @opencode-ai/sdk |
| Sandbox SDK | @vercel/sandbox@beta |

## Sandbox Architecture

OpenCord uses **Vercel Sandboxes in persistent mode** (beta SDK). This gives each Discord thread a long-lived, resumable sandbox with automatic filesystem snapshots.

### How Persistent Sandboxes Work

1. **Named sandboxes** — Each Discord thread gets a sandbox named `discord-channel-{channelId}`
2. **Auto-snapshot on stop** — When a sandbox stops, its filesystem is automatically snapshotted
3. **Auto-resume on request** — When `/ask` runs, the sandbox resumes from its last saved state automatically
4. **No manual checkpointing required** — The persistent mode handles state retention

### Session Memory vs Filesystem

The sandbox **filesystem persists** across stops and resumes. However, **OpenCode's file-read context does not persist**. This means:

- Files you created or edited are preserved
- Conversation history is preserved
- The agent remembers previous questions and discussions
- The agent may need to re-read files before editing them after a resume (the "must read before edit" check resets)

### Timeout

Sandboxes have a **45-minute session timeout**. When exceeded:

1. Sandbox stops automatically
2. Filesystem state is snapshotted automatically
3. Next `/ask` resumes the sandbox from the saved state

### Snapshot Expiration

Automatic snapshots expire after **7 days**. Use `/checkpoint` to create explicit, named snapshots with longer expiration for critical project states.

### Explicit Snapshots

The `/checkpoint` command creates an explicit snapshot stored in `WorkspaceEntryStore`. This is useful for bookmarking a known-good state for a project. For normal use, the automatic snapshots from persistent mode are sufficient.

## Setup

### 1. Create a Discord Application

1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. Create a new application
3. Copy your **Application ID** and **Public Key**
4. Navigate to "OAuth2 > URL Generator"
5. Select `bot` scope and add `Send Messages` permission
6. Use the generated URL to invite the bot to your server

### 2. Deploy to Vercel

```bash
git clone <this-repo>
cd opencord
pnpm install
```

### 3. Configure Environment Variables

Set these in your Vercel project dashboard or via CLI:

| Variable | Required | Description |
|----------|----------|-------------|
| `DISCORD_APPLICATION_ID` | Yes | Your Discord application ID |
| `DISCORD_PUBLIC_KEY` | Yes | Discord public key (hex) |
| `DISCORD_BOT_TOKEN` | Yes | Discord bot token |
| `GITHUB_TOKEN` | Yes | GitHub PAT with `repo` and `read:user` scopes |
| `BLOB_READ_WRITE_TOKEN` | Yes | Vercel Blob token |
| `OPENAI_API_KEY` | No | For OpenAI provider |
| `ANTHROPIC_API_KEY` | No | For Anthropic provider |

### 4. Register Slash Commands

```bash
vercel link
vercel env pull
pnpm tsx scripts/register-commands.ts
```

### 5. Set Discord Interactions URL

In the Discord Developer Portal, set your interactions endpoint:

```
https://your-vercel-domain.vercel.app/api/discord/interactions
```

Discord will verify this URL immediately. Ensure your code is deployed and the public key matches.

### 6. Configure Provider

Run in Discord:

Example:
```
/update
/use-provider opencode-go
/use-model minimax-m2.7
```

## Authentication

You can authenticate with providers using either API keys or OAuth.

### API Keys

Set provider API keys as environment variables in your Vercel project:

| Variable | Provider |
|----------|----------|
| `OPENAI_API_KEY` | OpenAI |
| `ANTHROPIC_API_KEY` | Anthropic |
| `OPENCODE_API_KEY` | opencode-go |

The format is `{PROVIDER}_API_KEY` in uppercase. For example, `OPENCODE_API_KEY` for the opencode-go provider.

### OAuth

Some providers support OAuth authentication. Use the `/auth-connect` command in Discord:

```
/auth-connect openai
```

The bot will display a URL to complete the OAuth flow. Run the command again after completing authorization.

To disconnect a provider:

```
/auth-disconnect openai
```

Use `/config` to check your current auth status for all providers.

## Commands

### Session Management

| Command | Description |
|---------|-------------|
| `/project <repo> [branch]` | Set GitHub repository for this channel |
| `/ask <prompt>` | Send a coding request to the agent |
| `/checkpoint` | Save current thread state for resume |
| `/delete` | Stop and remove thread session |

### Provider Configuration

| Command | Description |
|---------|-------------|
| `/providers` | List available providers and auth status |
| `/models [provider]` | List models for a provider |
| `/use-provider <id>` | Set active provider |
| `/use-model <id>` | Set active model |

### Authentication

| Command | Description |
|---------|-------------|
| `/auth-connect <provider>` | OAuth flow for providers |
| `/auth-set-key <provider>` | Set API key for a provider |
| `/auth-disconnect <provider>` | Remove provider credentials |

### Utility

| Command | Description |
|---------|-------------|
| `/config` | Show current provider, model, and auth status |
| `/health-check` | Fast bridge health check |
| `/update` | Refresh provider registry from models.dev |

## Architecture

### Thread Creation Flow

1. `/project owner/repo` — Stores repo in `ChannelStateStore`
2. `/ask` — Creates Discord thread + Vercel Sandbox
3. Sandbox clones repo (if set) and boots OpenCode
4. OpenCode executes the prompt and streams results back

### State Management

All persistent state lives in Vercel Blob:

| Store | Path | Purpose |
|-------|------|---------|
| ThreadRuntimeStore | `runtime/threads/` | Sandbox name, session ID, run locks |
| WorkspaceEntryStore | `runtime/workspaces/` | Project metadata, thread bindings |
| SelectionStore | `preferences/` | User default provider/model |
| OAuthTokenStore | `oauth/` | Provider OAuth tokens |
| ThreadAskQueueStore | `runtime/ask-queues/` | Pending `/ask` runs |

Channel state (repo, branch) is stored on the local filesystem.

### Sandbox Lifecycle

```
New /ask                 → Sandbox.create() with name
                              ↓
                         Sandbox starts, OpenCode boots
                              ↓
                         Agent works, edits files
                              ↓
                         45-min timeout or stop
                              ↓
                         Auto-snapshot of filesystem
                              ↓
Resume /ask              → Sandbox.get() by name
                              ↓
                         Filesystem restored from snapshot
                              ↓
                         OpenCode restarts (conversation preserved, file-read context lost)
                              ↓
                         Agent may need to re-read files before editing
```

Key points:
- **Filesystem**: Persists across sessions via automatic snapshots
- **Conversation history**: Preserved across resumes
- **File-read context**: Lost on resume — agent may need to re-read files before editing
- **Git clone**: Only happens once per sandbox; subsequent sessions resume the existing `/vercel/sandbox`

## Documentation

- [Architecture Overview](./docs/OVERVIEW.md)
- [Thread Creation Flow](./docs/thread-creation.md)
- [Sandbox & Git Clone](./docs/sandbox-clone.md)
- [State Stores](./docs/state-stores.md)
- [Discord Messaging](./docs/messaging.md)

## Development

```bash
pnpm test        # Run tests
pnpm test:watch  # Watch mode
```

## License

MIT
