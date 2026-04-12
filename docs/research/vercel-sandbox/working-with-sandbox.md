# Working with Sandbox

Common tasks for Vercel Sandbox operations.

## Execute long-running tasks

Default timeout is 5 minutes. Set custom timeout:

```ts
const sandbox = await Sandbox.create({
  timeout: 30 * 60 * 1000, // 30 minutes
});
```

Extend a running sandbox:

```ts
await sandbox.extendTimeout(60 * 60 * 1000); // 1 hour
```

## Interactive shell

Connect for debugging:

```bash
sandbox connect <sandbox-id>
```

## Monitor usage

View sandboxes in the [Sandboxes dashboard](https://vercel.com/d?to=%2F%5Bteam%5D%2F%5Bproject%5D%2Fobservability%2Fsandboxes).

Track compute in the [Usage dashboard](https://vercel.com/d?to=%2Fdashboard%2F%5Bteam%5D%2Fusage).

## Stop a sandbox

### Through dashboard

1. Go to Sandboxes in Observability
2. Select your sandbox
3. Click Stop Sandbox

### Programmatically

```ts
await sandbox.stop();
```

### Automatic timeout

Sandboxes stop after their timeout expires (default: 5 minutes).

## Examples

### Quick test

```bash
sandbox run -- echo "Hello Sandbox!"
```

### Create long-running sandbox

```bash
sandbox create --timeout 30m
```

### Run commands

```bash
sandbox exec <sandbox-id> node --version
sandbox exec <sandbox-id> npm install express
```

### Copy files

```bash
# Local to sandbox
sandbox cp ./my-app.js <sandbox-id>:/app/

# Sandbox to local
sandbox cp <sandbox-id>:/app/output.json ./output.json
```

### Interactive shell

```bash
sandbox exec --interactive --tty <sandbox-id> bash
```

### Debug failing build

```bash
sandbox create --timeout 1h
sandbox cp ./my-project/ <sandbox-id>:/app/
sandbox exec --workdir /app <sandbox-id> npm run build
```

### Run dev server

```bash
sandbox create --timeout 30m --publish-port 3000
sandbox exec --workdir /app <sandbox-id> npm run dev
```

See also:

- [CLI Reference](/docs/vercel-sandbox/cli-reference)
- [Pricing](/docs/vercel-sandbox/pricing)