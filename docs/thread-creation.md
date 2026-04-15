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

### `handleOpencodeCommand()` (lines 1298-1412)

When `/opencode` is run in a channel (not a thread):

1. Creates a new Discord thread via `createThreadFromChannel()`
2. Starts a sandbox session via `startThreadSession()`
3. **Pings the user in the thread** once sandbox is ready and repo is cloned
4. Returns a message directing user to the new thread

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
    |
    v
[If prompt provided?]
    |-- YES --> executeQueuedAskRun() --> Streams response to thread
    |-- NO  --> sendFollowup() --> Pings user in thread: "Your sandbox is ready!"
```

## Two Modes

1. **Empty sandbox** (`/opencode` without args): Creates fresh sandbox, pings user with "Your sandbox is ready! Use /ask in this thread to begin."
2. **With repo** (`/opencode <repo-url>`): Creates sandbox and clones repository, pings user with "Your sandbox is ready with the repository cloned! Use /ask in this thread to begin."

## Optional Prompt

Both modes support an optional prompt to skip the `/ask` step:

- `/opencode <prompt>` - Start empty sandbox and immediately process the prompt
- `/opencode <repo-url> <prompt>` - Start with repo and immediately process the prompt

The prompt is queued via `executeQueuedAskRun()` once the sandbox is ready.
