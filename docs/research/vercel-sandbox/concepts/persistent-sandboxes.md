# Persistent Sandboxes (Beta)

Persistent sandboxes automatically save their filesystem state when stopped and restore it when resumed. No manual snapshot management needed.

## How it differs from ephemeral sandboxes

| Aspect | Ephemeral | Persistent |
|--------|-----------|------------|
| State on stop | Destroyed (unless you snapshot) | Auto-saved |
| Resuming | Create new sandbox from snapshot ID | `Sandbox.get({ name: 'my-sandbox' })` |
| Identification | System-generated ID | User-defined name |

## Installation

```bash
npm install @vercel/sandbox@beta
```

## Usage

### Create a persistent sandbox

```ts
import { Sandbox } from '@vercel/sandbox';

const sandbox = await Sandbox.create({
  name: 'my-workspace',
  snapshotExpiration: 7 * 24 * 60 * 60 * 1000, // 7 days
});

await sandbox.runCommand('npm install');
await sandbox.stop();
```

### Resume where you left off

```ts
const sandbox = await Sandbox.get({ name: 'my-workspace' });
await sandbox.runCommand('npm run dev');
```

### Update configuration

```ts
await sandbox.update({
  vcpus: 4,
  timeout: 30 * 60 * 1000,
  persistent: true,
});
```

### Delete a sandbox

```ts
await sandbox.delete();
```

### List sandboxes

```ts
const { sandboxes } = await Sandbox.list({
  namePrefix: 'user-a',
  sortBy: 'name',
});
```

## CLI Usage

```bash
# Create
sandbox create --name my-sandbox --snapshot-expiration 7d

# Run (auto-resumes if stopped)
sandbox run --name my-sandbox -- npm test

# Configure
sandbox config vcpus my-sandbox 4
sandbox config timeout my-sandbox 30m

# Delete
sandbox remove my-sandbox
```

## Breaking changes from stable

| Before | After |
|--------|-------|
| `sandboxId` | `sandbox.name` |
| `Sandbox.get({ sandboxId })` | `Sandbox.get({ name })` |
| Manual snapshot management | Auto-snapshot on stop |

See also: [Snapshots](/docs/vercel-sandbox/concepts/snapshots)