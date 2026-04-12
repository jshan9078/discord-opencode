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

### /models

List available models for a provider.

```
/models
/models anthropic
```

**Options:**
- `provider` (optional): Filter by provider

Shows model IDs and whether they're currently active.

### /use-provider

Set the active provider for the channel.

```
/use-provider openai
/use-provider anthropic
```

**Options:**
- `provider` (required): Provider ID

Sets the provider for subsequent `/ask` commands. Creates a new session.

### /use-model

Set the active model for the channel.

```
/use-model openai/gpt-4.1
/use-model anthropic/claude-sonnet-4-20250514
```

**Options:**
- `model` (required): Model ID (format: `provider/model`)

Sets the model for subsequent `/ask` commands. Creates a new session.

### /auth-connect

Show instructions for connecting a provider via OAuth.

```
/auth-connect openai
/auth-connect anthropic device
```

**Options:**
- `provider` (required): Provider ID
- `method` (optional): Hint for auth method (e.g., "oauth", "device", "browser")

**Response:**
Instructions to run on the host machine (not in Discord):
```bash
pnpm exec bun scripts/auth.ts connect openai
```

### /auth-set-key

Show instructions for setting an API key.

```
/auth-set-key openai
```

**Options:**
- `provider` (required): Provider ID

**Response:**
Instructions to run on the host machine:
```bash
printf %s "$OPENAI_API_KEY" | pnpm exec bun scripts/auth.ts set-key openai --stdin
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