# Session Management

OpenCode sessions preserve conversation history across prompts. The bridge maps each Discord channel to one or more sessions based on provider/model profiles.

## Session Lifecycle

### Creation

```typescript
// session-manager.ts
export async function resolveSessionForActiveProfile(
  client: RuntimeClientAdapter,
  stateStore: ChannelStateStore,
  channelId: string,
): Promise<string> {
  const state = stateStore.get(channelId)
  const key = `${state.activeProviderId}:${state.activeModelId}`
  
  // Return existing session if present
  if (state.sessionByProfile?.[key]) {
    return state.sessionByProfile[key]
  }
  
  // Create new session
  const created = await client.session.create({
    body: { title: `discord-${channelId}` },
  })
  const sessionId = created.data.id
  
  // Save for future prompts
  if (key) {
    state.sessionByProfile ||= {}
    state.sessionByProfile[key] = sessionId
    stateStore.set(state)
  }
  
  return sessionId
}
```

### Profile Key

The key is `{providerId}:{modelId}`, e.g., `openai:gpt-4o`. This allows:

- **Provider switching**: Switching from OpenAI to Anthropic creates a new session
- **Model switching**: Switching models under the same provider also creates a new session
- **Preservation**: Old sessions are preserved (not deleted) when switching

This prevents context mixing - prompts to GPT-4 won't accidentally include Claude context.

### Channel State Storage

Sessions are stored in `channel-state.json`:

```typescript
interface ChannelState {
  channelId: string
  activeProviderId?: string
  activeModelId?: string
  sessionByProfile?: Record<string, string>
  repoUrl?: string
  branch?: string
  projectName?: string
}
```

The `channel-state-store.ts` manages reading/writing this file.

## Session Persistence

Inside the sandbox, OpenCode stores session data in:

```
/vercel/sandbox/.opencode/sessions/{sessionId}/
├── conversation.json    # Message history
├── memory/              # Indexed memory
└── ...                  # Other OpenCode state
```

This persists as long as the sandbox is alive. When the sandbox stops (after idle timeout), the snapshot is preserved. When resumed, the state is restored.

## When Sessions Are Created

| Scenario | Action |
|----------|--------|
| First prompt in channel | Create new session |
| Provider/model changed | Create new session (preserve old) |
| Same provider/model | Reuse existing session |
| Force new session | Create with `forceNewSession: true` |

## Session Recovery

If a session expires or is lost, the bridge can reconstruct context from:

1. **Recovery Log** (`recovery-log.ts`) - Tracks write/edit actions
2. **Discord Channel History** - Recent messages

```typescript
// In prompt-orchestrator.ts
const finalPrompt = options.recoveryContext
  ? ["Context recovery note: Use the following Discord channel history...",
     options.recoveryContext,
     "Current user request:",
     prompt].join("\n")
  : prompt
```

## Related Files

- `src/session-manager.ts` - Session resolution logic
- `src/channel-state-store.ts` - Channel state persistence
- `src/recovery-log.ts` - Write action tracking for recovery
- `src/prompt-orchestrator.ts` - Uses session in prompt flow