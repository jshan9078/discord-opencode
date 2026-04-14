# UX Plan

Bootstrap list: `[opencode, gh cli]`

All sandboxes are persistent sandboxes (named).
Blob metadata remains the UX/index layer.

## Types of environments

- Raw: bootstrap only (`opencode`, `gh cli`)
- Project: bootstrap + cloned repo + project filesystem state (may include local changes)

## In Channel

### `/opencode`

- Tells user it is starting an empty sandbox
- Opens the raw environment
- Creates a thread and binds it to that sandbox/session
- Does not save as a project snapshot

### `/opencode [project]`

- `project` autofills from the user’s GitHub repos
- Shows a dropdown of saved project entries (from Blob index):
  - show name
  - delete
  - resume/select
  - `New` option at the bottom
- If user selects Delete:
  - delete that saved entry (and optionally underlying sandbox if configured)
- If user selects Resume:
  - load associated persistent sandbox/session
  - route user to linked thread
  - if linked thread is gone, continue in current thread and show: `Resuming this session`
- If user selects New:
  - start from latest raw baseline
  - clone repo at `origin/main`
  - create new persistent sandbox + opencode session
  - store as a new project entry in Blob

### `/ask` in channel

- Not allowed
- Reply: `Run /opencode first in a channel to start or resume a session.`

## In Thread

### `/opencode` in thread

- Not allowed
- Reply: `Run /opencode from a channel to start or resume a session.`

### `/ask [prompt]`

- Sends prompt to the opencode session bound to this thread
- If this is first user message in session, rename saved entry with a truncated prompt title

## Invariant

- `1 thread = 1 project = 1 sandboxName = 1 opencode session = 1 active saved entry`
- Exception for raw `/opencode` (no project):
  - `1 thread = 1 sandboxName = 1 opencode session`

## Updates

### `/update` in Discord

- Checks whether raw baseline is stale
- If stale, creates a new raw baseline version (latest opencode + gh cli)
- Does not invalidate existing project entries

## Checkpointing

### `/checkpoint`

- Stops current persistent sandbox session to persist filesystem state
- Updates the current saved entry metadata/pointer
- Session can be resumed from the same thread mapping

- Keep `/checkpoint`, remove `/stop`
