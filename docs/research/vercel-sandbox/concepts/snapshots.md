---
title: Snapshots
product: vercel
url: /docs/vercel-sandbox/concepts/snapshots
type: conceptual
prerequisites:
  - /docs/vercel-sandbox/concepts
  - /docs/vercel-sandbox
related:
  - /docs/vercel-sandbox/sdk-reference
  - /docs/vercel-sandbox/cli-reference
  - /docs/vercel-sandbox/pricing
summary: Save and restore sandbox state with snapshots for faster startups and environment sharing.
install_vercel_plugin: npx plugins add vercel/vercel-plugin
---

# Snapshots

Snapshots capture the state of a running sandbox, including the filesystem and installed packages. Use snapshots to skip setup time on subsequent runs.

## When to use snapshots

- **Faster startups**: Skip dependency installation by snapshotting after setup.
- **Checkpointing**: Save progress on long-running tasks.
- **Sharing environments**: Give teammates an identical starting point.

## Create a snapshot

Call `snapshot()` on a running sandbox:

> **💡 Note:** Once you create a snapshot, the sandbox shuts down automatically and becomes unreachable. You don't need to stop it afterwards.

```ts filename="index.ts"
const snapshot = await sandbox.snapshot();
```

## Create a sandbox from a snapshot

Pass the snapshot ID when creating a new sandbox:

```ts filename="index.ts"
const sandbox = await Sandbox.create({
  snapshotId: "snap_abc123",
});
```

## List snapshots

View all snapshots for your project:

```ts filename="index.ts"
const { snapshots } = await Snapshot.list();
```

## Retrieve an existing snapshot

Look up a snapshot by ID:

```ts filename="index.ts"
const snapshot = await Snapshot.get({ snapshotId: "snap_abc123" });
```

## Delete a snapshot

Remove snapshots you no longer need:

```ts filename="index.ts"
await Snapshot.delete({ snapshotId: "snap_abc123" });
```

## Snapshot limits

- Snapshots expire after **30 days** by default
- You can define a custom expiration time or none at all when creating a snapshot. See the [SDK](/docs/vercel-sandbox/sdk-reference#sandbox.snapshot) and [CLI](/docs/vercel-sandbox/cli-reference#sandbox-snapshot) documentation for more details.
- See [Pricing and Limits](/docs/vercel-sandbox/pricing#snapshot-storage) for storage costs and limits


---

[View full sitemap](/docs/sitemap)