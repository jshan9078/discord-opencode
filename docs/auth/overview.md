# Authentication Overview

The bridge manages credentials for providers (OpenAI, Anthropic, etc.) and GitHub.

## Credential Sources

### 1. Environment Variables (API Keys)

Set in Vercel dashboard:

```
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
GOOGLE_GENERATIVEAI_API_KEY=...
```

Format: `{PROVIDER}_API_KEY` (uppercase, underscores)

### 2. GitHub Token

```
GITHUB_TOKEN=ghp_...  (needs repo, read:user scopes)
```

## Auth Methods

OpenCode supports multiple auth methods per provider:

| Method | Description | Storage |
|--------|-------------|---------|
| `api-key` | Direct API key | Env var `{PROVIDER}_API_KEY` |
| `oauth` | OAuth flow via `/auth-connect` | Stored in sandbox |
| `none` | No auth required | (free models) |

## Setting Credentials

### Option 1: Environment Variables (API Keys)

Set in Vercel dashboard:
```
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
```

Format: `{PROVIDER}_API_KEY` (uppercase, underscores)

### Option 2: OAuth via Discord

Run in Discord:
```
/auth-connect openai
```

Follow the URL/code displayed, then run `/auth-connect openai` again to complete.

Credentials are saved in private Blob storage per user+provider and reused across sandbox sessions.

## Token Refresh

OAuth tokens expire. OpenCode handles refresh automatically inside the sandbox.

If refresh fails (token revoked), run `/auth-connect <provider>` again to re-authenticate.

## GitHub Auth

GitHub is needed for:
- Repo autocomplete (`/opencode` with project)
- Pushing commits from sandbox

Required PAT scopes: `repo`, `read:user`

## Environment Variables

| Variable | Purpose |
|----------|---------|
| `GITHUB_TOKEN` | GitHub API token |
| `BLOB_READ_WRITE_TOKEN` | Vercel Blob token for provider registry storage |
| `OPENCODE_CONFIG_BLOB_PATH` | Optional: Blob path for bundled `~/.config/opencode` |
| `{PROVIDER}_API_KEY` | Provider API keys (e.g., OPENAI_API_KEY) |

## Related Files

- `src/sandbox-manager.ts` - Sandbox and credential injection
- `src/auth-bootstrap.ts` - Auth bootstrapping
- `src/provider-registry.ts` - Provider/method registry
