# Running Commands in a Sandbox

Step-by-step guide for creating sandboxes, running commands, copying files, and managing snapshots.

## Quick Reference

```bash
# 1. Create sandbox
sandbox create --runtime node24 --timeout 1h --publish-port 3000

# 2. Copy files into sandbox
sandbox cp ./my-app/. <sandbox-id>:/app

# 3. Run commands
sandbox exec --workdir /app <sandbox-id> "npm install"
sandbox exec --workdir /app <sandbox-id> "npm run build"
sandbox exec --workdir /app --env NODE_ENV=test <sandbox-id> "npm test"

# 4. Save snapshot
sandbox snapshot <sandbox-id> --stop

# 5. Create from snapshot
sandbox create --snapshot <snapshot-id> --timeout 30m

# 6. Clean up
sandbox stop <sandbox-id>
```

## 1. Create a Sandbox

```bash
# Basic
sandbox create --runtime node24 --timeout 1h

# With port exposure (for dev servers)
sandbox create --runtime node24 --timeout 1h --publish-port 3000

# Python
sandbox create --runtime python3.13 --timeout 1h

# Immediately connect to shell
sandbox create --runtime node24 --timeout 1h --connect
```

## 2. Copy Files

```bash
# Local to sandbox
sandbox cp ./my-app/. <sandbox-id>:/app

# Sandbox to local
sandbox cp <sandbox-id>:/app/output/results.json ./results.json

# Directory
sandbox cp <sandbox-id>:/app/dist/ ./build/
```

## 3. Run Commands

```bash
# Basic
sandbox exec --workdir /app <sandbox-id> "npm install"

# With environment variables
sandbox exec --workdir /app --env NODE_ENV=test <sandbox-id> "npm test"

# With sudo
sandbox exec --sudo <sandbox-id> "apt-get update && apt-get install -y jq"
```

## 4. Interactive Shell

```bash
sandbox connect <sandbox-id>
```

Exit shell to disconnect.

## 5. Save Snapshot

```bash
sandbox snapshot <sandbox-id> --stop
```

> Note: Snapshotting stops the sandbox automatically.

List snapshots:
```bash
sandbox snapshots list
```

## 6. Create from Snapshot

```bash
sandbox create --snapshot <snapshot-id> --timeout 30m
```

## 7. One-off Commands

```bash
sandbox run --runtime node24 --rm -- node -e 'console.log(process.version)'
```

The `--rm` flag auto-deletes the sandbox after.

## 8. Network Policy

```bash
# Create with restricted network
sandbox create --runtime node24 --network-policy deny-all \
  --allowed-domain "*.npmjs.org" \
  --allowed-domain "registry.npmjs.org"

# Update existing
sandbox config network-policy <sandbox-id> --network-policy deny-all \
  --allowed-domain "api.example.com"
```

## 9. Clean Up

```bash
# Stop one
sandbox stop <sandbox-id>

# Stop multiple
sandbox stop <id1> <id2>

# List all (including stopped)
sandbox list --all

# Delete snapshots
sandbox snapshots delete <snapshot-id>
```