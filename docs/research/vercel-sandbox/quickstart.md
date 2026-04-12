# Quickstart

Learn how to run your first code in a Vercel Sandbox.

## Prerequisites

- [Vercel account](https://vercel.com/signup)
- Vercel CLI installed (`npm i -g vercel`)
- Node.js 22+ or Python 3.10+

## Steps

### 1. Set up your environment

Create a new directory and connect it to a Vercel project:

```bash
vercel link
```

When prompted, select **Create a new project**. The project doesn't need any code deployed.

Pull your environment variables:

```bash
vercel env pull
```

This creates a `.env.local` file with your authentication token.

### 2. Install the SDK

```bash
npm install @vercel/sandbox
```

### 3. Write your code

```ts filename="index.ts"
import { Sandbox } from '@vercel/sandbox';

const sandbox = await Sandbox.create();
const result = await sandbox.runCommand('echo', ['Hello from Vercel Sandbox!']);
console.log(result.output);
await sandbox.stop();
```

### 4. Run it

```bash
npx tsx index.ts
```

Output: `Hello from Vercel Sandbox!`

## What you did

1. **Set up authentication**: Connected to Vercel project and pulled credentials
2. **Created a sandbox**: Spun up an isolated Linux microVM
3. **Ran a command**: Executed code in the secure environment

## Next Steps

- [SDK Reference](/docs/vercel-sandbox/sdk-reference): Full API documentation
- [CLI Reference](/docs/vercel-sandbox/cli-reference): Terminal commands
- [Snapshots](/docs/vercel-sandbox/concepts/snapshots): Save state for faster startups
- [Examples](/docs/vercel-sandbox/working-with-sandbox#examples): Real-world use cases