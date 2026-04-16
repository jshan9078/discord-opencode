# State Management Stores

## ThreadRuntimeStore (`thread-runtime-store.ts`)

| Property | Purpose |
|----------|---------|
| Sandbox name | Vercel Sandbox identifier (unique name per channel) |
| Session ID | OpenCode session |
| Run locks | Prevents concurrent `/ask` runs |
| OpenCode password | Auth credential for OpenCode server |

**Storage**: Vercel Blob (`runtime/threads/{threadId}.json`)

**Note**: The sandbox name is used to resume a persistent sandbox after the 45-minute session timeout. The sandbox's filesystem is automatically snapshotted on stop.

## WorkspaceEntryStore (`workspace-entry-store.ts`)

| Property | Purpose |
|----------|---------|
| Project/workspace metadata | Name, repo, branch |
| Thread bindings | Maps Discord threads to workspaces |

**Storage**: Vercel Blob (`runtime/workspaces/...`)

## ChannelStateStore (`channel-state-store.ts`)

| Property | Purpose |
|----------|---------|
| Provider | AI provider selection |
| Model | Model selection |
| Repo | GitHub repository URL |
| Branch | Git branch |

**Storage**: Local filesystem

## SelectionStore (`selection-store.ts`)

| Property | Purpose |
|----------|---------|
| User default provider/model | Fallback selections |
| Thread-specific selections | Per-thread overrides |

**Storage**: Vercel Blob (`preferences/...`)

## OAuthTokenStore (`oauth-token-store.ts`)

| Property | Purpose |
|----------|---------|
| Provider OAuth tokens | User authentication per provider |

**Storage**: Vercel Blob (`oauth/...`)

## ThreadAskQueueStore (`thread-ask-queue-store.ts`)

| Property | Purpose |
|----------|---------|
| Pending `/ask` runs | Queue for a thread |

**Storage**: Vercel Blob (`runtime/ask-queues/...`)
