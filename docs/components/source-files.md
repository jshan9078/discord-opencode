# Source Files Reference

This document explains each source file in `src/` and how it fits into the system.

## Core Modules

### auth-bootstrap.ts

> Bootstraps provider credentials into OpenCode session. Checks stored credentials, syncs to runtime, returns auth status.

```typescript
export async function ensureProviderAuth(client, registry, credentials, providerId): Promise<AuthResult>
export async function resolveSessionForActiveProfile(client, stateStore, channelId): Promise<string>
```

Used by `prompt-orchestrator.ts` before sending prompts.

---

### channel-state-store.ts

> Persists state per Discord channel (provider, model, repo, branch, sessions). Used by the interactions endpoint to maintain conversation context across requests.

```typescript
class ChannelStateStore {
  get(channelId: string): ChannelState
  set(state: ChannelState): void
  setActiveProvider(channelId, providerId): ChannelState
  setActiveModel(channelId, modelId): ChannelState
  setProject(channelId, repoUrl, branch, projectName): ChannelState
  setSessionForActiveProfile(channelId, sessionId): ChannelState
  getSessionForActiveProfile(channelId): string | undefined
}
```

Persists to `~/.cache/opencode-chat-bridge/channel-state.json`.

---

### command-parser.ts

> Parses text commands (from slash command mapping) into structured types. Handles providers, models, opencode, auth, and prompt commands.

```typescript
export type ParsedCommand =
  | { type: "providers" }
  | { type: "config" }
  | { type: "health_check" }
  | { type: "update" }
  | { type: "models"; providerId?: string }
  | { type: "use_provider"; providerId: string }
  | { type: "use_model"; modelId: string }
  | { type: "auth_connect"; providerId: string; methodHint?: string }
  | { type: "auth_set_key"; providerId: string }
  | { type: "auth_disconnect"; providerId: string }
  | { type: "opencode"; project?: string }
  | { type: "checkpoint" }
  | { type: "delete" }
  | { type: "help" }
  | { type: "invalid"; message: string }
  | { type: "prompt"; text: string }

export function parseDiscordCommand(text: string): ParsedCommand
```

Used after `interaction-command-mapper.ts` converts Discord payload to text.

---

### credential-store.ts

> Encrypted storage for provider auth tokens and GitHub credentials. Keys are derived from BRIDGE_SECRET - credentials never leave the host.

```typescript
class CredentialStore {
  constructor(secret: string)
  setProviderAuth(providerId: string, auth: AuthPayload): void
  getProviderAuth(providerId: string): AuthPayload | null
  setGitHubToken(token: string): void
  getGitHubToken(): string | null
  clearProviderAuth(providerId: string): void
}
```

Uses AES-256-GCM encryption. Stores to `credentials.json`.

---

### discord-application-commands.ts

> Defines Discord slash command structure (/ask, /opencode, /checkpoint, etc.). Used by register-commands.ts to register commands with Discord.

```typescript
export function buildApplicationCommands(): DiscordApplicationCommand[]

// Returns:
// - /ask (prompt)
// - /opencode (project option)
// - /checkpoint
// - /delete
// - /providers
// - /models (provider option)
// - /use-provider (provider option)
// - /use-model (model option)
// - /auth-connect (provider, method options)
// - /auth-set-key (provider option)
// - /auth-disconnect (provider option)
```

Used by `scripts/register-commands.ts`.

---

### discord-command-service.ts

> Executes parsed commands against channel state, providers, and credentials. Handles /providers, /models, /use-provider, /use-model, /opencode, /checkpoint, /delete, /auth, etc.

```typescript
export function handleDiscordCommand(
  text: string,
  context: CommandContext,
  stateStore: ChannelStateStore,
  registry: ProviderRegistry,
  credentials: CredentialStore,
): CommandResult

// Returns: { handled, isPrompt, promptText?, message? }
```

The main command dispatcher after parsing.

---

### event-relay.ts

> Streams SSE events from OpenCode session and relays to Discord sink. Handles text deltas, tool activity, questions, permissions, errors.

```typescript
export interface EventRelaySink {
  onTextDelta(text: string): Promise<void>
  onToolActivity(message: string): Promise<void>
  onToolRequest?(payload): Promise<void>
  onToolResult?(payload): Promise<void>
  onQuestion(message: string): Promise<void>
  onPermission(message: string): Promise<void>
  onError(message: string): Promise<void>
}

export async function relaySessionEvents(
  client: EventStreamClient,
  sink: EventRelaySink,
  sessionId: string,
  options?: EventRelayOptions,
): Promise<EventRelayResult>

export function isTerminalSessionEvent(event: EventEnvelope): boolean
```

Used by `prompt-orchestrator.ts` to stream events to Discord.

---

### github-client.ts

> GitHub API client for listing repos and branches. Used by `/opencode` autocomplete to show available repos.

```typescript
class GitHubClient {
  constructor(token: string)
  async listRepos(): Promise<GitHubRepo[]>
  async listBranches(owner: string, repo: string): Promise<GitHubBranch[]>
}

export function getGitHubClient(): GitHubClient | null
```

Uses `GITHUB_TOKEN` env var. Called from `api/discord/interactions.ts`.

---

### interaction-command-mapper.ts

> Maps Discord Interactions payloads (slash command options) to text commands. Converts /ask, /opencode, /providers, etc. into parseable command strings.

```typescript
export function mapInteractionCommandToText(
  data: InteractionCommandData,
): { type: "command" | "prompt"; text: string }

// /ask prompt="hello" → { type: "prompt", text: "hello" }
// /opencode owner/repo → { type: "command", text: "opencode owner/repo" }
```

First step in `api/discord/interactions.ts`.

---

### opencode-client.ts

> HTTP client for OpenCode server (create session, prompt, stream events). Bridges the Discord endpoint to the OpenCode API.

```typescript
class OpencodeClient {
  constructor(baseUrl: string, password?: string)
  async health(): Promise<void>
  async createSession(title: string): Promise<string>
  async promptAsync(sessionId: string, prompt: string): Promise<void>
  async subscribeEvents(signal?: AbortSignal): AsyncIterable<RuntimeEvent>
  async fetchProviderAuthMethods(): Promise<Record<string, Array<{ label: string }>>>
  async fetchModelIds(): Promise<string[]>
  async syncRegistry(registry: ProviderRegistry): Promise<void>
  async setProviderAuth(providerId: string, payload: Record<string, unknown>): Promise<void>
}
```

Used by `prompt-orchestrator.ts`.

---

### project-manager.ts

> Manages saved projects (repo URLs) and per-channel project mappings. Used for project selection and tracking.

```typescript
class ProjectManager {
  async listProjects(): Promise<Project[]>
  async addProject(repoUrl: string, name?: string): Promise<Project>
  async removeProject(projectId: string): void
  getProjectForChannel(channelId: string): Project | null
  setProjectForChannel(channelId: string, projectId: string): void
  clearProjectForChannel(channelId: string): void
}
```

Note: Currently channel state uses `channel-state-store.ts` directly for project info.

---

### prompt-orchestrator.ts

> Orchestrates the full prompt flow: auth, session, execution, event streaming. The main entry point for processing /ask commands.

```typescript
export async function executePromptForChannel(
  runtime: OpencodeRuntime,
  registry: ProviderRegistry,
  credentials: CredentialStore,
  stateStore: ChannelStateStore,
  channelId: string,
  prompt: string,
  sink: EventRelaySink,
  options?: { forceNewSession?: boolean; recoveryContext?: string },
): Promise<{ ok: true } | { ok: false; message: string }>
```

Called from `api/discord/interactions.ts` for `/ask` commands.

---

### provider-registry.ts

> In-memory registry of available providers, auth methods, and models. Synced from OpenCode server at runtime.

```typescript
class ProviderRegistry {
  getProvider(id: string): ProviderRecord | undefined
  getAllProviders(): ProviderRecord[]
  setProviders(providers: ProviderRecord[]): void
  upsertProvider(provider: ProviderRecord): void
}

export interface ProviderRecord {
  id: string
  methods: ProviderAuthMethod[]
  models: ProviderModel[]
}

export function classifyAuthMethod(label: string): "oauth" | "api-key" | "none" | "unknown"
```

Synced at runtime via `opencode-client.ts`.

---

### provider-registry-env.ts

> Loads provider registry from PROVIDER_REGISTRY_JSON env var. Fallback when not synced from OpenCode server.

```typescript
export function loadProviderRegistryFromEnv(raw?: string): ProviderRegistry
```

Used as fallback if `opencode-client.ts` sync fails or isn't configured.

---

### recovery-log.ts

> Logs write/edit actions per channel for session recovery prioritization. Used to reconstruct context from channel history on session expiry.

```typescript
export function logAction(action: RecoveryAction): void
export function getActionsForChannel(channelId: string): RecoveryAction[]
export function clearActionsForChannel(channelId: string): void
export function classifyAction(toolName: string): RecoveryActionKind
```

Currently optional - can be used for future recovery features.

---

### session-manager.ts

> Resolves or creates OpenCode session for the active provider/model profile. Handles session reuse across prompts in the same channel.

```typescript
export async function resolveSessionForActiveProfile(
  client: RuntimeClientAdapter,
  stateStore: ChannelStateStore,
  channelId: string,
): Promise<string>
```

Used by `prompt-orchestrator.ts` before sending prompts.

---

### storage-paths.ts

> Provides paths for config/storage files (credentials, channel state, etc.). Uses SESSION_BASE_DIR env var or default ~/.cache/opencode-chat-bridge.

```typescript
export function getBaseDir(): string
export function getConfigDir(): string
export function getConfigPath(filename: string): string
```

Used by all modules that store state to disk.

---

## API Endpoint

### api/discord/interactions.ts

> Main serverless handler for Discord Interactions. Verifies signatures, routes commands, handles select menus, relays events.

```typescript
export default async function handler(request: Request): Promise<Response>
```

This is the entry point - the Vercel Function that receives all Discord interactions.