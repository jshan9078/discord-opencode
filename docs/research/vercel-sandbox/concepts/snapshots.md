# Snapshots

Snapshots capture the state of a running sandbox, including the filesystem and installed packages. Use them to skip setup time on subsequent runs.

## When to use snapshots

- **Faster startups**: Skip dependency installation by snapshotting after setup
- **Checkpointing**: Save progress on long-running tasks
- **Sharing environments**: Give teammates an identical starting point

## Usage

### Create a snapshot

```ts
const snapshot = await sandbox.snapshot();
```

> **Note**: Once you create a snapshot, the sandbox shuts down automatically.

### Create a sandbox from a snapshot

```ts
const sandbox = await Sandbox.create({
  snapshotId: 'snap_abc123',
});
```

### List snapshots

```ts
const { snapshots } = await Snapshot.list();
```

### Get a snapshot

```ts
const snapshot = await Snapshot.get({ snapshotId: 'snap_abc123' });
```

### Delete a snapshot

```ts
await Snapshot.delete({ snapshotId: 'snap_abc123' });
```

## Limits

- **Expiration**: 30 days default (configurable)
- **Storage**: $0.08/GB-month on Pro plans

See [Pricing](/docs/vercel-sandbox/pricing) for storage costs.