# Authentication Overview

The bridge manages credentials for providers (OpenAI, Anthropic, etc.) and GitHub. This document explains the auth model.

## Design Principles

1. **Via environment variables** - No secrets ever sent through Discord
2. **Single-user** - One canonical credential set
3. **Provider-agnostic** - Works with any auth method OpenCode supports

## Credential Sources

The bridge checks credentials in this order:

### 1. Environment Variables (API Keys)

For providers that use API keys, set env vars in Vercel:

```
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
GOOGLE_GENERATIVEAI_API_KEY=...
```

Format: `{PROVIDER}_API_KEY` (uppercase, underscores)

### 2. GitHub Token

```
GITHUB_TOKEN=ghp_...
```

### 3. Encrypted File (Advanced)

For OAuth tokens that can't be passed via env vars, you can use the credential store.

## Auth Methods

OpenCode supports multiple auth methods per provider:

| Method | Description | Storage |
|--------|-------------|---------|
| `api-key` | Direct API key | Env var `{PROVIDER}_API_KEY` |
| `oauth` | OAuth flow via `/auth-connect` | Stored in sandbox |
| `none` | No auth required | (free models) |

The bridge discovers available methods via `GET /provider/auth`.

## Auth Bootstrap Flow

When a prompt is sent, the bridge ensures credentials are available:

```typescript
// auth-bootstrap.ts
export async function ensureProviderAuth(
  client: RuntimeClientAdapter,
  registry: ProviderRegistry,
  credentials: CredentialStore,
  providerId: string,
): Promise<AuthResult> {
  // 1. Check if provider exists
  const provider = registry.getProvider(providerId)
  if (!provider) return { type: "needs_local_oauth" }
  
  // 2. Try stored credentials
  const stored = credentials.getProviderAuth(providerId)
  if (stored) {
    try {
      await client.auth.set({ path: { id: providerId }, body: stored })
      return { type: "ok" }
    } catch {
      // Continue to try auth methods
    }
  }
  
  // 3. Determine what's needed
  const hasOAuth = provider.methods.some(m => m.kind === "oauth")
  const hasApiKey = provider.methods.some(m => m.kind === "api-key")
  
  if (hasOAuth && !stored) return { type: "needs_local_oauth" }
  if (hasApiKey && !stored) return { type: "needs_local_api_key" }
  
  return { type: "ok" }
}
```

## Setting Credentials

### Via CLI (host-local)

```bash
# OAuth providers
pnpm exec bun scripts/auth.ts connect openai

# API key providers
printf %s "$ANTHROPIC_API_KEY" | pnpm exec bun scripts/auth.ts set-key anthropic --stdin

# GitHub
printf %s "$GITHUB_TOKEN" | pnpm exec bun scripts/auth.ts github --stdin
```

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
/auth-connect chatgpt
```

Follow the URL/code displayed, then run `/auth-connect chatgpt` again to complete.

Credentials are stored in the sandbox filesystem and persist across prompts.

## Token Refresh

OAuth tokens expire. OpenCode handles refresh automatically inside the sandbox.

If refresh fails (token revoked), run `/auth-connect <provider>` again to re-authenticate.

## GitHub Auth

GitHub is needed for:
- Repo/branch listing (`/project select`)
- `gh` CLI inside sandbox (git operations)

Stored similarly to provider auth, but used directly:
```typescript
const gh = getGitHubClient() // Uses GITHUB_TOKEN env var
const repos = await gh.listRepos()
```

## Environment Variables

| Variable | Purpose |
|----------|---------|
| `BRIDGE_SECRET` | Key for encrypting credential store |
| `GITHUB_TOKEN` | GitHub API token |
| `{PROVIDER}_API_KEY` | Provider API keys (e.g., OPENAI_API_KEY) |

## Related Files

- `src/sandbox-manager.ts` - Sandbox and credential injection
- `src/auth-bootstrap.ts` - Auth bootstrapping
- `src/provider-registry.ts` - Provider/method registry