# Slash Commands

The bridge exposes a set of slash commands for interacting with the coding agent. This document lists all available commands and their usage.

## Available Commands

### /ask

Send a coding request to the agent.

```
/ask add a login feature with OAuth
/ask fix the bug in auth.ts line 42
/ask write tests for user.ts
```

**Options:**
- `prompt` (required): The coding task description

**Behavior:**
- Deferred response (type 5) - processing happens async
- Events stream to Discord as the agent works
- Final response posted as followup

### /project

Set the GitHub repository for this Discord channel. The repo will be cloned into any new sandbox created by `/ask`.

```
/project owner/repo                    # Set repo with default branch (main)
/project owner/repo feature-branch     # Set repo with specific branch
/project https://github.com/owner/repo # Also accepts full URLs
```

**Options:**
- `repo` (required): GitHub repo in `owner/repo` format or full URL, with autocomplete
- `branch` (optional): Branch name (default: `main`)

**Behavior:**
- Stores repo and branch in `ChannelStateStore` for the channel
- Repo persists across sessions until changed
- Used by `/ask` when creating new sandboxes

### /providers

List available providers and their auth status.

```
/providers
```

Shows:
- Provider ID (e.g., "openai", "anthropic")
- Available auth methods (OAuth, API key, none)
- Whether credentials are configured
- Paged results with `Prev` / `Next` buttons

### /config

Show your current provider/model selection and authentication status.

```
/config
```

Behavior:
- In a normal channel: shows your user default provider/model
- In a thread: shows effective thread selection (override or inherited)
- Indicates whether auth is available via OAuth or API key

### /health-check

Run a fast health check against the bridge without starting a sandbox.

```
/health-check
```

Shows:
- Current server time
- Number of providers loaded from the stored registry
- Number of configured providers
- Whether `GITHUB_TOKEN` is present
- Whether `DISCORD_BOT_TOKEN` is present

### /update

Refresh the stored provider registry snapshot from `models.dev`.

```
/update
```

Behavior:
- Creates the provider registry blob on first run
- Updates the existing registry blob on later runs
- Refreshes the snapshot used by `/providers`, `/models`, `/use-provider`, and `/ask`

Requires:
- `BLOB_READ_WRITE_TOKEN`

### /models

List available models for a provider.

```
/models
/models anthropic
```

**Options:**
- `provider` (optional): Filter by provider, with autocomplete suggestions

Shows model IDs and whether they're currently active.
- Large model lists are paged with `Prev` / `Next` buttons

### /use-provider

Set your default provider, or override the provider inside the current thread.

```
/use-provider openai
/use-provider anthropic
```

**Options:**
- `provider` (required): Provider ID, with autocomplete suggestions

Behavior:
- In a normal channel: updates your global default provider
- In a thread: updates only that thread's provider override
- If the current model does not belong to the new provider, the model is cleared

### /use-model

Set your default model, or override the model inside the current thread.

```
/use-model openai/gpt-4.1
/use-model anthropic/claude-sonnet-4-20250514
```

**Options:**
- `model` (required): Model ID (format: `provider/model`), with autocomplete suggestions

Behavior:
- In a normal channel: updates your global default model
- In a thread: updates only that thread's model override
- Requires a provider to already be selected in that scope
- Validates that the model belongs to the selected provider

### /auth-connect

Start OAuth flow for a provider (e.g., ChatGPT Pro/Plus).

```
/auth-connect openai
```

**Options:**
- `provider` (required): Provider ID

**Flow:**
1. Run `/auth-connect <provider>` - you'll get a URL and code
2. Visit the URL on your machine, enter the code
3. Run `/auth-connect <provider>` again to complete

Credentials are stored in the sandbox and persist across prompts.

### /auth-set-key

This command is deprecated. Use environment variables instead:

```
# In Vercel dashboard
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
```

### /auth-disconnect

Clear stored credentials for a provider.

```
/auth-disconnect openai
```

**Options:**
- `provider` (required): Provider ID

Clears both the local credential store and any sandbox credentials.

### /checkpoint

Save the current thread session state as a resumable checkpoint.

```
/checkpoint
```

**Behavior:**
- Snapshots the current sandbox state
- Enables fast resume on next `/ask`
- Useful before ending a session or switching contexts

### /delete

Stop and remove the current thread session without checkpointing.

```
/delete
```

**Behavior:**
- Terminates the sandbox immediately
- Removes session data (no resume possible)
- Deletes the associated checkpoint snapshot
- Clears channel state for this thread

## Command Flow

```
User Input
    │
    ▼
Discord API (Interactions)
    │
    ▼
api/discord/interactions.ts
    │
    ├──► interaction-command-mapper.ts (payload → text)
    │
    ├──► command-parser.ts (text → structured)
    │
    └──► discord-command-service.ts (execute)
            │
            ├──► channel-state-store.ts (state)
            │
            ├──► provider-registry.ts (providers)
            │
            └──► credential-store.ts (auth)
```

## Related Files

- `src/discord-application-commands.ts` - Command definitions
- `src/interaction-command-mapper.ts` - Payload mapping
- `src/command-parser.ts` - Text parsing
- `src/discord-command-service.ts` - Command execution
- `scripts/register-commands.ts` - Registration
