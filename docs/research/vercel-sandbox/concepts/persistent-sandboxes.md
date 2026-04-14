---
title: Persistent Sandboxes
product: vercel
url: /docs/vercel-sandbox/concepts/persistent-sandboxes
type: conceptual
prerequisites:
  - /docs/vercel-sandbox/concepts
  - /docs/vercel-sandbox
related:
  - /docs/vercel-sandbox/concepts/snapshots
  - /docs/vercel-sandbox/sdk-reference
  - /docs/vercel-sandbox/cli-reference
  - /docs/vercel-sandbox/concepts/authentication
summary: Learn about persistent sandboxes on Vercel.
install_vercel_plugin: npx plugins add vercel/vercel-plugin
---

# Persistent sandboxes

> **🔒 Permissions Required**: Persistent sandboxes

Persistent sandboxes automatically save their filesystem state when stopped and restore it when resumed. You no longer need to manually create and manage [snapshots](/docs/vercel-sandbox/concepts/snapshots) between runs.

## How persistent sandboxes differ from ephemeral sandboxes

Standard (ephemeral) sandboxes are destroyed when they stop. Continuing work requires creating a snapshot, storing its ID, and spinning up a new sandbox from that snapshot.

Persistent sandboxes handle this automatically. Create a sandbox, do your work, stop it, and pick up where you left off.

| Aspect                  | Ephemeral (current)                            | Persistent (beta)                          |
| :---------------------- | :--------------------------------------------- | :----------------------------------------- |
| **State on stop**       | Destroyed unless you snapshot manually         | Automatically saved                        |
| **Resuming**            | Create a new sandbox from a stored snapshot ID | Call `Sandbox.get()` with the sandbox name |
| **Identification**      | System-generated ID (`sbx_abc123`)             | User-defined name (`my-workspace`)         |
| **Snapshot management** | You manage snapshots and their IDs             | Automatic, handled by the SDK              |

## Key concepts

### Sandboxes and sessions

Persistent sandboxes introduce a two-level model:

- **Sandbox**: A long-lived entity identified by a unique name within your project. It tracks state across multiple runs.
- **Session**: An ephemeral VM run within a sandbox. Each time you resume a sandbox, a new session starts from the last saved state.

When you stop a persistent sandbox, the SDK automatically snapshots the filesystem. When you resume it, a new session boots from that snapshot.

### Sandbox names

Every persistent sandbox has a **name** that is unique within your project. Names replace the previous system-generated IDs as the primary way to identify sandboxes.

- If you don't provide a name, one is generated automatically.
- Names cannot be changed after creation.
- Names are unique per project.

### Default snapshot expiration

Persistent sandboxes automatically create snapshots when sessions stop. You can set a default expiration for these snapshots at the sandbox level, so you don't need to manage expiration per snapshot.

- When set, every automatic snapshot inherits this expiration.
- Use `0` or `"none"` (CLI) to keep snapshots indefinitely.
- If not set, snapshots use the system default.

You can set this at creation time or update it later:

```ts filename="index.ts"
// Set at creation time (7 days in milliseconds)
const sandbox = await Sandbox.create({
  snapshotExpiration: 7 * 24 * 60 * 60 * 1000,
});

// Or update it later
await sandbox.update({
  snapshotExpiration: 14 * 24 * 60 * 60 * 1000, // 14 days
});
```

### Automatic resume

If a persistent sandbox is stopped and you run a command on it, the SDK silently resumes it first. You don't need to check the sandbox status or manually restart before running commands.

Exceptions where auto-resume does not apply:

- `sandbox.stop()`
- `sandbox.update()`

## Install the beta packages

Install the beta SDK and CLI:

#### npm

```bash filename="Terminal"
# SDK
npm install @vercel/sandbox@beta

# CLI
npm install -g sandbox@beta
```

#### yarn

```bash filename="Terminal"
# SDK
yarn add @vercel/sandbox@beta

# CLI
yarn global add sandbox@beta
```

#### pnpm

```bash filename="Terminal"
# SDK
pnpm install @vercel/sandbox@beta

# CLI
pnpm install -g sandbox@beta
```

#### bun

```bash filename="Terminal"
# SDK
bun add @vercel/sandbox@beta

# CLI
bun add -g sandbox@beta
```

## SDK usage

### Create a persistent sandbox (or opt out)

```ts filename="index.ts" highlight={5}
import { Sandbox } from '@vercel/sandbox';

const sandbox = await Sandbox.create({
  name: 'user-a-workspace',
  // persistent: true is the default in the beta SDK, use false to opt out.
  snapshotExpiration: 7 * 24 * 60 * 60 * 1000, // 7 days
});

await sandbox.runCommand('npm', ['install']);
await sandbox.stop();
```

### Resume where you left off

```ts filename="index.ts"
// Later, get the same sandbox by name
const sandbox = await Sandbox.get({ name: 'user-a-workspace' });

// The filesystem is restored from the last session
await sandbox.runCommand('npm', ['run', 'dev']);
```

### Update sandbox configuration

```ts filename="index.ts"
await sandbox.update({
  resources: { vcpus: 4 },
  timeout: 30 * 60 * 1000, // 30 minutes
  persistent: true,
  snapshotExpiration: 14 * 24 * 60 * 60 * 1000, // 14 days
});
```

### Delete a sandbox

Deleting a sandbox removes it and all its snapshots and sessions permanently.

```ts filename="index.ts"
await sandbox.delete();
```

### List and search sandboxes

```ts filename="index.ts"
const { sandboxes } = await Sandbox.list({
  namePrefix: 'user-a',
  sortBy: 'name',
});
```

## SDK breaking changes

The beta SDK (`@vercel/sandbox@beta`) includes breaking changes from the current stable version.

| Change                  | Before (stable)                         | After (beta)                               |
| :---------------------- | :-------------------------------------- | :----------------------------------------- |
| **Get a sandbox**       | `Sandbox.get({ sandboxId: "sbx_123" })` | `Sandbox.get({ name: "my-sandbox" })`     |
| **Sandbox identifier**  | `sandbox.sandboxId`                     | `sandbox.name`                             |
| **Default persistence** | Ephemeral (no auto-snapshot)            | Persistent (auto-snapshot on stop)         |
| **List pagination**     | `since` / `until` parameters            | `cursor`-based pagination                  |
| **List response**       | `{ json: { sandboxes, pagination } }`   | `{ sandboxes, pagination }`               |
| **Auto-resume**         | Commands fail on stopped sandboxes      | Commands silently resume the sandbox first |

### New SDK methods

| Method                     | Description                                                        |
| :------------------------- | :----------------------------------------------------------------- |
| `Sandbox.get({ resume })`  | Pass `resume: true` to resume a stopped sandbox. Defaults to false |
| `sandbox.update(params)`   | Update resources (vCPUs), persistence, timeout, and network policy |
| `sandbox.delete()`         | Delete a sandbox and all its snapshots and sessions                |
| `sandbox.currentSession()` | Get the active session for the sandbox                             |
| `sandbox.listSessions()`   | List all sessions for the sandbox                                   |
| `sandbox.listSnapshots()`  | List all snapshots for the sandbox                                 |

### New SDK properties

| Property                           | Type      | Description                               |
| :--------------------------------- | :-------- | :---------------------------------------- |
| `sandbox.name`                     | `string`  | The sandbox name (replaces `sandboxId`)   |
| `sandbox.persistent`               | `boolean` | Whether auto-snapshotting is enabled      |
| `sandbox.region`                   | `string`  | Region where the sandbox runs             |
| `sandbox.vcpus`                    | `number`  | Number of virtual CPUs allocated         |
| `sandbox.memory`                   | `number`  | Memory allocated in MB                   |
| `sandbox.runtime`                  | `string`  | Runtime used by the sandbox               |
| `sandbox.snapshotExpiration`       | `number`  | Default snapshot expiration in ms        |
| `sandbox.currentSnapshotId`        | `string`  | The latest snapshot ID                   |
| `sandbox.totalDurationMs`          | `number`  | Total wall-clock time across all sessions |
| `sandbox.totalActiveCpuDurationMs` | `number`  | Total active CPU time across all sessions |
| `sandbox.totalEgressBytes`         | `number`  | Total egress bytes across all sessions    |
| `sandbox.totalIngressBytes`        | `number`  | Total ingress bytes across all sessions   |
| `sandbox.updatedAt`                | `Date`    | When the sandbox was last updated        |

### New `Sandbox.list()` parameters

| Parameter    | Type                     | Description                                                               |
| :----------- | :----------------------- | :------------------------------------------------------------------------ |
| `namePrefix` | `string`                 | Filter sandboxes by name prefix. Requires `sortBy` to be set to `"name"`. |
| `sortBy`     | `string`                 | Sort by `createdAt` (default), `statusUpdatedAt`, or `"name"`               |
| `sortOrder`  | `string`                 | Sort direction: `"desc"` (default) or `"asc"`                              |
| `tags`       | `Record<string, string>` | Filter sandboxes by tags                                                  |

### New `Snapshot.list()` parameter

`Snapshot.list()` accepts a `name` parameter to filter snapshots by sandbox name.

### Deprecations

`sandbox.updateNetworkPolicy()` is deprecated. Use `sandbox.update({ networkPolicy })`.

## CLI usage

### Create a persistent sandbox

```bash filename="Terminal"
# Create a persistent sandbox
sandbox create --name my-sandbox

# Create with a default snapshot expiration of 7 days
sandbox create --name my-sandbox --snapshot-expiration 7d

# Create with no snapshot expiration
sandbox create --name my-sandbox --snapshot-expiration none
```

### Run a command with automatic resume

If the sandbox is stopped, `run` resumes it before executing the command:

```bash filename="Terminal"
sandbox run --name my-sandbox -- npm test
```

### Inspect sessions

```bash filename="Terminal"
sandbox sessions list my-sandbox
```

### Configure a sandbox

```bash filename="Terminal"
sandbox config vcpus my-sandbox 4
sandbox config timeout my-sandbox 30m
sandbox config persistent my-sandbox true
sandbox config snapshot-expiration my-sandbox 7d
```

### Delete a sandbox

```bash filename="Terminal"
sandbox remove my-sandbox
```

## CLI breaking changes

The beta CLI (`sandbox@beta`) includes breaking changes from the current stable version.

| Change                               | Before (stable)                       | After (beta)                          |
| :----------------------------------- | :------------------------------------ | :------------------------------------ |
| **Sandbox identifier**               | `<sandbox_id>` argument               | `<name>` argument                     |
| **`sandbox stop`**                   | Stops and removes the sandbox         | Stops the current session only        |
| **`sandbox rm` / `sandbox remove`**  | Alias for `stop`                      | Permanently deletes the sandbox        |
| **`sandbox cp` paths**               | `SANDBOX_ID:PATH`                     | `NAME:PATH`                           |
| **`sandbox run --rm`**               | Stopped the sandbox after the command | Deletes the sandbox after the command |
| **`sandbox list` columns**           | `ID` column                           | `NAME` column                         |
| **`sandbox snapshots list` columns** | `SOURCE SANDBOX` column               | `SOURCE SESSION` column               |

### New CLI commands

| Command                                                      | Description                                    |
| :----------------------------------------------------------- | :--------------------------------------------- |
| `sandbox remove <name>`                                      | Permanently delete a sandbox and its resources |
| `sandbox sessions list <name>`                               | List all sessions for a sandbox                |
| `sandbox config list <name>`                                 | Display the current sandbox configuration      |
| `sandbox config vcpus <name> <count>`                        | Update vCPU allocation                         |
| `sandbox config timeout <name> <duration>`                   | Update session timeout                         |
| `sandbox config persistent <name> <true\|false>`             | Enable or disable persistence                 |
| `sandbox config snapshot-expiration <name> <duration\|none>` | Update default snapshot expiration            |
| `sandbox config network-policy <name>`                       | Update network policy                          |

### New CLI options

| Command                  | New options                                                                                                 |
| :----------------------- | :---------------------------------------------------------------------------------------------------------- |
| `sandbox create`         | `--name`, `--non-persistent`, `--tag <key=value>`, `--snapshot-expiration <duration\|none>`                 |
| `sandbox run`            | `--name` (resume existing sandbox), `--stop` (stop after command), `--snapshot-expiration <duration\|none>` |
| `sandbox list`           | `--name-prefix`, `--sort-by`, `--sort-order`, `--tag`                                                       |
| `sandbox snapshots list` | `--name` (filter by sandbox)                                                                                 |

## Managing persistent sandboxes in the dashboard

Persistent sandboxes appear in your project's [Sandboxes](https://vercel.com/d?to=%2F%5Bteam%5D%2F%5Bproject%5D%2Fsandboxes\&title=Show+Sandbox+page) page. Each sandbox shows its name, status, resources, and runtime.

Select a sandbox to view its detail page, which includes:

- **Sandbox**: Overview of the sandbox configuration, status, and resources.
- **Activity**: A log of sandbox lifecycle events.
- **Snapshots**: Automatic snapshots created when sessions stop. These are the saved filesystem states that enable resume.

From the dashboard you can stop the current session or permanently remove the sandbox.

## Migration from stable to beta

Existing sandbox IDs are automatically backfilled as the name for each sandbox. The only required code change is switching from `sandboxId` or `id` to `name`:

```ts filename="index.ts"
// Before (stable SDK)
const sandbox = await Sandbox.get({ sandboxId: 'sbx_123' });

// After (beta SDK)
const sandbox = await Sandbox.get({ name: 'sbx_123' });
```

> **💡 Note:** While the backfill is running, some older sandboxes may not appear when using
> the beta SDK or CLI.

## Next steps

- [Snapshots](/docs/vercel-sandbox/concepts/snapshots): Learn how snapshots work under the hood.
- [SDK Reference](/docs/vercel-sandbox/sdk-reference): Full API documentation for the stable SDK.
- [CLI Reference](/docs/vercel-sandbox/cli-reference): Command reference for the stable CLI.
- [Authentication](/docs/vercel-sandbox/concepts/authentication): Configure SDK authentication.