# Thread Creation Flow

Thread creation happens in `api/discord/interactions.ts`.

## Functions

### `createThreadFromChannel()` (lines 1223-1250)

Creates a private Discord thread with `auto_archive_duration: 1440` (24 hours).

```typescript
POST /channels/{channelId}/threads
```

### `startThreadSession()` (lines 1252-1296)

1. Creates or resumes a sandbox via `SandboxManager.getOrCreate()`
2. Stores sandbox context in `ThreadRuntimeStore`
3. Optionally clones a GitHub repo into the sandbox

### `handleOpencodeCommand()` (lines 1298-1380)

When `/opencode` is run in a channel (not a thread):

1. Creates a new Discord thread via `createThreadFromChannel()`
2. Starts a sandbox session via `startThreadSession()`
3. Returns a message directing user to the new thread

## Flow Diagram

```
User runs /opencode in channel
    |
    v
createThreadFromChannel() --> Creates Discord thread
    |
    v
startThreadSession()
    |
    v
SandboxManager.getOrCreate() --> Creates Vercel Sandbox + starts OpenCode server
    |
    v
WorkspaceEntryStore.setThreadBinding() --> Persists thread<->sandbox binding
```

## Two Modes

1. **Empty sandbox** (`/opencode` without args): Creates fresh sandbox from raw baseline
2. **With repo** (`/opencode <repo-url>`): Creates sandbox and clones specified repository
