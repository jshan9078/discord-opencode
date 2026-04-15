# Sandbox & Git Clone Workflow

Located in `src/sandbox-manager.ts`.

## `getOrCreate()` (lines 60-137)

1. Checks if sandbox is cached and healthy
2. If not, creates a new sandbox or resumes existing one by ID

## `createSandbox()` (lines 179-198)

1. Creates Vercel Sandbox with Node 24 runtime
2. If `repoUrl` provided, calls `cloneRepoIntoSandbox()`

## `cloneRepoIntoSandbox()` (lines 248-306)

1. Runs `git clone --depth=1 --branch {branch} {repoUrl} /vercel/sandbox`
2. Configures GitHub token via `GIT_ASKPASS` for private repos
3. Verifies clone succeeded

## `ensureOpenCodeServer()` (lines 200-246)

1. Installs OpenCode if needed
2. Injects user config from Blob storage
3. Injects API keys from env vars
4. Starts OpenCode server on port 4096
5. Waits for server health check
