# Sandbox & Git Clone Workflow

Located in `src/sandbox-manager.ts`.

## SDK Version

Uses `@vercel/sandbox@beta` with persistent sandboxes enabled.

## Sandbox Identification

Sandboxes are identified by **name** (not ID). Each Discord thread gets a unique name: `discord-channel-{channelId}`.

## `getOrCreate()` (line 60)

1. Checks if sandbox is cached and healthy (OpenCode health check)
2. If not cached, calls `Sandbox.get({ name })` to resume existing sandbox
3. If no existing sandbox, calls `createSandbox()` to create new persistent sandbox

## `createFromSnapshot()` (line 139)

1. Creates sandbox from a Vercel Snapshot using `Sandbox.create({ source: { type: "snapshot", snapshotId } })`
2. If `repoUrl` provided, calls `cloneRepoIntoSandbox()`
3. Calls `ensureOpenCodeServer()` to start OpenCode

## `createSandbox()` (line 186)

1. Creates persistent Vercel Sandbox with:
   - `name`: `discord-channel-{channelId}`
   - `persistent: true`
   - `snapshotExpiration`: 7 days
   - Node 24 runtime
2. If `repoUrl` provided, calls `cloneRepoIntoSandbox()`

## `cloneRepoIntoSandbox()` (line 259)

1. Runs `git clone --depth=1 --branch {branch} {repoUrl} /vercel/sandbox`
2. Configures GitHub token via `GIT_ASKPASS` for private repos
3. Verifies clone succeeded

Note: Git clone only happens once when the sandbox is first created. On subsequent resumes, the sandbox filesystem is restored from the last snapshot, so the repo is already present.

## `ensureOpenCodeServer()` (line 213)

1. Installs OpenCode if needed
2. Injects user config from Blob storage
3. Injects API keys from env vars
4. Configures GitHub credentials via `GIT_ASKPASS` for clone/fetch operations
5. Configures `git config user.name` and `git config user.email` from GitHub user info
6. Starts OpenCode server on port 4096
7. Waits for server health check

## Session Memory vs Filesystem

**Persists across resume:**
- All files in the sandbox filesystem
- Git repo and working tree
- OpenCode config files
- Conversation history (agent remembers previous discussions)

**Does NOT persist across resume:**
- OpenCode's "file-read" context (the "must read before edit" check resets)
- Any in-memory state of the OpenCode server process

After a sandbox resume, the agent may need to re-read files before editing them, even though it remembers the conversation.
