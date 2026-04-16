<p align="center">
  <h1>OpenCord</h1>
  <p>A serverless Discord bot that bridges your Discord server to AI-powered coding agents running in Vercel Sandboxes. Code, debug, and ship directly from Discord.</p>
</p>

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
| Compute | Vercel Sandboxes |
| Persistence | Vercel Blob |
| Discord | discord.js |
| AI SDK | @opencode-ai/sdk |

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

```
/update
/use-provider openai
/use-model gpt-4o
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
| ThreadRuntimeStore | `runtime/threads/` | Sandbox ID, session ID, run locks |
| WorkspaceEntryStore | `runtime/workspaces/` | Project metadata, thread bindings |
| SelectionStore | `preferences/` | User default provider/model |
| OAuthTokenStore | `oauth/` | Provider OAuth tokens |
| ThreadAskQueueStore | `runtime/ask-queues/` | Pending `/ask` runs |

Channel state (repo, branch) is stored on the local filesystem.

### Sandbox Lifecycle

- **Creation**: Sandbox is created from a baseline snapshot or resumed from a checkpoint
- **Clone**: Git repo is cloned into `/vercel/sandbox` with GitHub token via `GIT_ASKPASS`
- **Boot**: OpenCode server starts on port 4096 with user config injected from Blob
- **Cleanup**: Thread deletion stops the sandbox without checkpointing

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
