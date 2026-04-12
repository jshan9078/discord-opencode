# Sandbox CLI Reference

Based on the Docker CLI. Install with:

```bash
npm i -g sandbox
```

Commands: `sandbox` or `sbx`

## Authentication

```bash
sandbox login
```

## Commands

### sandbox create

Create a sandbox:

```bash
sandbox create --runtime node24 --timeout 1h --publish-port 3000
```

Options:
- `--runtime <runtime>`: `node24`, `node22`, or `python3.13` (default: node24)
- `--timeout <duration>`: `5m`, `1h`, etc. (default: 5m)
- `-p, --publish-port <port>`: Expose port via public URL
- `--snapshot <id>`: Create from snapshot
- `--network-policy <mode>`: `allow-all` or `deny-all`
- `--allowed-domain <domain>`: Allow specific domains
- `--silent`: No output
- `--connect`: Open interactive shell after creation

### sandbox list

```bash
sandbox list              # Running only
sandbox list --all        # Include stopped
sandbox list --project my-app
```

### sandbox run

Create and run a command:

```bash
sandbox run -- node -e 'console.log("Hello")'
sandbox run --rm -- npm test
sandbox run --publish-port 3000 -- npm run dev
```

Options: `--timeout`, `--runtime`, `--publish-port`, `--workdir`, `--env`, `--rm`

### sandbox exec

Execute in existing sandbox:

```bash
sandbox exec <sandbox-id> ls -la
sandbox exec --workdir /app <sandbox-id> npm run build
sandbox exec --env NODE_ENV=test <sandbox-id> npm test
sandbox exec --interactive --sudo <sandbox-id> bash
```

Options: `-w, --workdir`, `-e, --env`, `--sudo`, `--interactive`, `--tty`

### sandbox connect

Interactive shell:

```bash
sandbox connect <sandbox-id>
sandbox connect --workdir /app <sandbox-id>
```

### sandbox stop

```bash
sandbox stop <sandbox-id>
sandbox stop <id1> <id2>
```

Aliases: `rm`, `remove`

### sandbox copy

Copy files (alias: `cp`):

```bash
sandbox cp ./file.txt <sandbox-id>:/app/
sandbox cp <sandbox-id>:/app/output.json ./output.json
```

### sandbox snapshot

Create snapshot:

```bash
sandbox snapshot <sandbox-id> --stop
sandbox snapshot <sandbox-id> --stop --expiration 14d
sandbox snapshot <sandbox-id> --stop --expiration 0  # Never expires
```

### sandbox snapshots

Manage snapshots:

```bash
sandbox snapshots list
sandbox snapshots get <snapshot-id>
sandbox snapshots delete <snapshot-id>
```

### sandbox config

Update network policy:

```bash
sandbox config network-policy <sandbox-id> --network-policy deny-all
sandbox config network-policy <sandbox-id> --allowed-domain "*.npmjs.org"
```

### sandbox login / logout

```bash
sandbox login
sandbox logout
```

## Examples

### First sandbox

```bash
sandbox run echo "Hello Sandbox!"
```

### Test AI-generated code

```bash
SANDBOX_ID=$(sandbox create --timeout 15m --silent)
sandbox copy ./ai-generated.js $SANDBOX_ID:/app/
sandbox exec --interactive --tty $SANDBOX_ID bash
sandbox stop $SANDBOX_ID
```

### Run dev server with port

```bash
sandbox create --timeout 30m --publish-port 3000
sandbox exec --workdir /app <sandbox-id> npm run dev
# Visit: https://<sandbox-id>.vercel.app
```