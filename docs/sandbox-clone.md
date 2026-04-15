# Sandbox & Git Clone Workflow

Located in `src/sandbox-manager.ts`.

## `getOrCreate()` (line 60)

1. Checks if sandbox is cached and healthy
2. If not, creates a new sandbox or resumes existing one by ID

## `createFromSnapshot()` (line 139)

1. Creates sandbox from a Vercel Snapshot
2. If `repoUrl` provided, calls `cloneRepoIntoSandbox()`
3. Calls `ensureOpenCodeServer()` to start OpenCode

## `createSandbox()` (line 186)

1. Creates Vercel Sandbox with Node 24 runtime
2. If `repoUrl` provided, calls `cloneRepoIntoSandbox()`

## `cloneRepoIntoSandbox()` (line 258)

1. Runs `git clone --depth=1 --branch {branch} {repoUrl} /vercel/sandbox`
2. Configures GitHub token via `GIT_ASKPASS` for private repos
3. Verifies clone succeeded

## `ensureOpenCodeServer()` (line 207)

1. Installs OpenCode if needed
2. Injects user config from Blob storage
3. Injects API keys from env vars
4. Configures GitHub credentials via `GIT_ASKPASS` for clone/fetch operations
5. Configures `git config user.name` and `git config user.email` from GitHub user info (for commit authorship)
6. Starts OpenCode server on port 4096
7. Waits for server health check
