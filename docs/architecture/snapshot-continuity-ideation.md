# Snapshot Continuity Plan (Ideation)

## Status

- This is a high-level planning document only.
- No implementation details or code changes are in scope here.
- Goal: define the target behavior for sandbox continuity after expiration.

## Problem Statement

- Sandboxes expire after a fixed runtime window.
- If work is not committed/pushed before expiration, local filesystem edits are lost.
- Conversation continuity can recover from Discord history, but code-state continuity is weaker.
- We need a design that preserves momentum, minimizes cold starts, and prevents stale repo state.

## Desired Outcome

- Fast restart after sandbox expiration.
- Predictable code freshness relative to GitHub branch state.
- Durable session continuity per Discord thread/profile.
- Clear user-facing behavior when local changes are at risk.

## Principles

- Treat snapshots as environment cache, not source of truth.
- Treat GitHub branch HEAD as source of truth for "fresh" mode.
- Keep thread runtime metadata durable in Blob.
- Prefer deterministic restore behavior over hidden heuristics.
- Make mode choices explicit (fresh vs resume).

## Proposed High-Level Flow

1. On `/ask`, resolve thread runtime metadata (Blob) and project context (repo/branch).
2. Attempt sandbox restore from latest snapshot for that repo/branch.
3. If no snapshot exists, perform standard cold bootstrap.
4. Start OpenCode server in sandbox and attach SDK client.
5. Run mandatory repo sync policy before first prompt execution.
6. Resolve session for active provider/model profile from durable mapping.
7. If session is missing/invalid, create new session and optionally inject recovery context.
8. Continue prompt flow and stream results.
9. Create/rotate snapshots at checkpoint boundaries.

## Sync Policy Modes

### Fresh mode (default)

- Intent: guarantee latest GitHub state.
- Behavior:
  - fetch remote branch
  - hard-align working tree to `origin/<branch>`
- Tradeoff: uncommitted sandbox-only edits are discarded.

### Resume mode (opt-in)

- Intent: maximize local continuity from snapshot state.
- Behavior:
  - fetch remote branch
  - preserve local working tree
  - surface ahead/behind/diverged status to user
- Tradeoff: local state may drift from remote unless user reconciles.

## Snapshot Lifecycle (Conceptual)

- Snapshot keying: repo + branch (+ optional workspace profile).
- Snapshot metadata should track:
  - snapshot ID
  - repo URL
  - branch
  - commit SHA at snapshot time
  - creation timestamp
  - expiration timestamp
- Rotation strategy:
  - keep only the most recent N snapshots per key
  - prune old/expired snapshots

## State Model (Conceptual)

- Durable thread runtime record should include:
  - sandbox identity
  - OpenCode connection auth material
  - session mapping per provider/model profile
  - active run lock metadata
  - latest snapshot reference
  - last-known repo commit info

## User Experience Expectations

- If sandbox expired but snapshot restore succeeds, user sees seamless continuation.
- If code is behind remote in fresh mode, auto-sync silently before execution.
- If in resume mode and divergence exists, user gets a concise warning and suggested action.
- If no snapshot is available, user gets a clear cold-start notice.

## Risks and Tradeoffs

- Snapshots can preserve sensitive local files if present at capture time.
- Resume mode can increase merge/conflict complexity.
- Frequent snapshots can raise storage usage and cost.
- Snapshot restore success still requires robust fallback path.

## Open Questions

- Should fresh mode always be default, or thread-configurable?
- When should snapshots be captured (time-based, event-based, manual)?
- How many snapshots per repo/branch should be retained?
- Should snapshot creation pause during active tool runs?
- What minimum metadata is required to diagnose restore/sync issues quickly?

## Success Criteria

- Median restart time after expiration is significantly lower than cold bootstrap.
- Session continuity rate across expiration events improves.
- Incidents of "stale code after restore" are near zero in fresh mode.
- Users have clear, actionable messaging around continuity and sync behavior.
