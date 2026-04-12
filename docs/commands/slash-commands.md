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

Manage the project (repository) for the current channel.

```
/project select     # Interactive repo/branch picker
/project set <repo> [branch]  # Set repo directly
/project show       # Show current project
/project clear      # Clear project setting
```

**Subcommands:**
- `select`: Opens GitHub repo select menu, then branch select menu
- `set`: Set repo URL and optional branch (defaults to "main")
- `show`: Display current project and branch
- `clear`: Remove project setting

**Examples:**
```
/project set https://github.com/user/repo
/project set https://github.com/user/repo main
/project show
```

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
- Creates the provider registry gist on first run
- Updates the existing registry gist on later runs
- Refreshes the snapshot used by `/providers`, `/models`, `/use-provider`, and `/ask`

Requires:
- `GITHUB_TOKEN` with `gist` scope

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

Set the active provider for the channel.

```
/use-provider openai
/use-provider anthropic
```

**Options:**
- `provider` (required): Provider ID, with autocomplete suggestions

Sets the provider for subsequent `/ask` commands. Creates a new session.

### /use-model

Set the active model for the channel.

```
/use-model openai/gpt-4.1
/use-model anthropic/claude-sonnet-4-20250514
```

**Options:**
- `model` (required): Model ID (format: `provider/model`), with autocomplete suggestions

Sets the model for subsequent `/ask` commands. Creates a new session.

### /auth-connect

Start OAuth flow for a provider (e.g., ChatGPT Pro/Plus).

```
/auth-connect chatgpt
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
