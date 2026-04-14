# Running OpenCode securely with the Vercel Sandbox
Last updated March 10, 2026
By Allen Zhou

---

Learn how to run [OpenCode](https://opencode.ai/) in an isolated [Vercel Sandbox](https://vercel.com/docs/vercel-sandbox) MicroVM using the [Sandbox SDK](https://vercel.com/docs/vercel-sandbox/sdk-reference), with egress locked down so the agent can only reach the domains you allow.

Running a coding agent on your laptop means it shares your network, your credentials, and your access to everything. The Sandbox SDK lets you spin up a MicroVM programmatically, install OpenCode inside it, and then call `sandbox.updateNetworkPolicy()` to restrict outbound traffic to only the LLM endpoints the agent needs. If the agent tries to reach anything outside that allowlist, the request is blocked at the network level.

## [Setup](#setup)[](#setup)

Before you begin, make sure you have:

*   Vercel CLI installed on your machine. If you don't have it, install it with `pnpm i -g vercel`
*   Node.js 22 or later installed locally
*   A [Vercel project](https://vercel.com/docs/projects) to link your sandbox to

### [Create a project](#create-a-project)[](#create-a-project)

Start by creating a new directory and initializing it:

```
mkdir sandbox-opencode && cd sandbox-opencodepnpm init
```

### [Link your project](#link-your-project)[](#link-your-project)

Run `vercel link` to connect your local directory to a Vercel project. If you don't have a project yet, the CLI will create one for you:

```
vercel link
```

Follow the prompts to select your team and project name.

### [Pull environment variables](#pull-environment-variables)[](#pull-environment-variables)

This pulls a `VERCEL_OIDC_TOKEN` into a local `.env.local` file. The SDK uses this token to authenticate when creating sandboxes:

```
vercel env pull
```

### [Install dependencies](#install-dependencies)[](#install-dependencies)

Install the Sandbox SDK along with helpers for running TypeScript and loading environment variables:

```
pnpm add @vercel/sandbox dotenvpnpm add -D tsx @types/node
```

### [Get an AI Gateway API key](#get-an-ai-gateway-api-key)[](#get-an-ai-gateway-api-key)

OpenCode needs a model provider. [AI Gateway](https://vercel.com/docs/ai-gateway) gives you a single endpoint for Claude, GPT, Gemini, and other models with built-in spend tracking.

1.  Go to [AI Gateway API Keys](https://vercel.com/d?to=%2F%5Bteam%5D%2F%7E%2Fai-gateway%2Fapi-keys&title=AI+Gateway+API+Keys)
2.  Create a new API key
3.  Add it to your `.env.local` file:

```
echo 'AI_GATEWAY_API_KEY=vck_xxxxxx' >> .env.local
```

Replace `vck_xxxxxx` with the key you just created.

[AI Gateway](https://vercel.com/docs/ai-gateway) is not required. OpenCode supports 75+ providers natively. You can use your own Anthropic, OpenAI, or other API keys by adjusting the config in the [Configure AI Gateway](#configure-ai-gateway) section.

### [Create your script](#create-your-script)[](#create-your-script)

Create an `index.ts` file. This is where all the code in the following sections goes. Start with the imports and environment setup:

```
import { config } from 'dotenv';config({ path: '.env.local' });
import { Sandbox } from '@vercel/sandbox';
const OPENCODE_PORT = 4096;const OPENCODE_BIN = '/home/vercel-sandbox/.opencode/bin/opencode';const AI_GATEWAY_API_KEY = process.env.AI_GATEWAY_API_KEY;
function sleep(duration: number) {  return new Promise(r => setTimeout(r, duration));}
```

The `dotenv` import loads `VERCEL_OIDC_TOKEN` and `AI_GATEWAY_API_KEY` from `.env.local` so the SDK can authenticate. Run your script at any point with:

```
npx tsx index.ts
```

## [Create a sandbox](#create-a-sandbox)[](#create-a-sandbox)

Use `Sandbox.create()` to launch a fresh MicroVM. Expose port 4096 for the OpenCode server and set a timeout for the session:

```
const sandbox = await Sandbox.create({  timeout: 60 * 60 * 1000, // 1 hour  ports: [OPENCODE_PORT],  resources: { vcpus: 1 },});console.log('Sandbox ID:', sandbox.sandboxId);
```

If you want OpenCode to work on an existing codebase, pass a `source` to clone a Git repository into the sandbox:

```
const sandbox = await Sandbox.create({  source: {    type: 'git',    url: 'https://github.com/vercel/examples.git',  },  timeout: 60 * 60 * 1000,  ports: [OPENCODE_PORT],  resources: { vcpus: 4 },});
```

This clones the repo into the sandbox's working directory so OpenCode can read and edit the files directly. For private repositories, see [Using private GitHub repositories with Vercel Sandbox](https://vercel.com/kb/guide/sandbox-private-github-repositories).

## [Install OpenCode](#install-opencode)[](#install-opencode)

Run the official install script inside the sandbox. The `stdout` and `stderr` options stream output to your local terminal:

```
const install = await sandbox.runCommand({  cmd: 'bash',  args: ['-c', 'curl -fsSL https://opencode.ai/install | bash'],  stdout: process.stdout,  stderr: process.stderr,});if (install.exitCode !== 0) throw new Error('Install failed');
```

The installer places the binary at `~/.opencode/bin/opencode`. When using `runCommand` (rather than an interactive shell), the installer's `PATH` update doesn't apply, so you need the full path (we defined `OPENCODE_BIN` in the setup):

```
const version = await sandbox.runCommand(OPENCODE_BIN, ['--version']);console.log('OpenCode version:', await version.stdout());
```

## [Configure AI Gateway](#configure-ai-gateway)[](#configure-ai-gateway)

Write an `opencode.json` config file directly into the sandbox filesystem using `sandbox.writeFiles()`. This configures OpenCode to use [Vercel AI Gateway](https://vercel.com/docs/ai-gateway) as its model provider:

```
const opencodeConfig = JSON.stringify({  $schema: 'https://opencode.ai/config.json',  enabled_providers: ['vercel'],  provider: {    vercel: {      options: { apiKey: AI_GATEWAY_API_KEY },      models: { 'anthropic/claude-sonnet-4.6': {} },    },  },  model: 'anthropic/claude-sonnet-4.6',}, null, 2);
await sandbox.writeFiles([{  path: '/home/vercel-sandbox/.config/opencode/opencode.json',  content: Buffer.from(opencodeConfig),}]);
```

Models follow the `provider/model-name` format. Browse the [models catalog](https://vercel.com/d?to=%2F%5Bteam%5D%2F%7E%2Fai-gateway%2Fmodels&title=AI+Gateway+Models) for available options.

## [Start the server](#start-the-server)[](#start-the-server)

Start the OpenCode HTTP server in the background with a password for basic auth:

```
const password = Math.random().toString(36).slice(2);
await sandbox.runCommand({  cmd: 'bash',  args: [    '-c',    `OPENCODE_SERVER_PASSWORD=${password} nohup ${OPENCODE_BIN} serve --hostname 0.0.0.0 --port ${OPENCODE_PORT} > /tmp/opencode.log 2>&1 &`,  ],});
```

The server needs a few seconds for its initial database migration. Wait for it, then verify it is healthy:

```
await sleep(8000);
const publicUrl = sandbox.domain(OPENCODE_PORT);const auth = Buffer.from(`opencode:${password}`).toString('base64');
const res = await fetch(`${publicUrl}/global/health`, {  headers: { Authorization: `Basic ${auth}` },});const health = await res.json();console.log(health); // { healthy: true, version: "1.2.23" }
```

## [Lock down egress](#lock-down-egress)[](#lock-down-egress)

This is the key step. Once OpenCode is installed and running, call `sandbox.updateNetworkPolicy()` to restrict outbound traffic to only the domains the agent needs. Everything else is blocked at the network level:

```
await sandbox.updateNetworkPolicy({  allow: ['ai-gateway.vercel.sh'],});
```

From this point on, if the agent tries to reach your email, internal APIs, or any other service, the request is silently dropped. Only traffic to the allowed domains gets through.

Adjust the allowlist based on your provider:

| Provider   | Domain                 |
| ---------- | ---------------------- |
| AI Gateway | `ai-gateway.vercel.sh` |
| Anthropic  | `api.anthropic.com`    |
| OpenAI     | `api.openai.com`       |

You can verify the policy is working from inside the sandbox:

```
const blocked = await sandbox.runCommand('curl', [  '--max-time', '5', 'https://example.com',]);console.log(blocked.exitCode); // non-zero (blocked)
const allowed = await sandbox.runCommand('curl', [  '-sf', '-o', '/dev/null', '--max-time', '5',  'https://ai-gateway.vercel.sh',]);console.log(allowed.exitCode); // 0 (allowed)
```

### [Credential brokering](#credential-brokering)[](#credential-brokering)

For even stronger security, you can inject API credentials at the network level so they never enter the sandbox at all. This means the agent can make authenticated requests without ever seeing the API key:

```
await sandbox.updateNetworkPolicy({  allow: {    'ai-gateway.vercel.sh': [{      transform: [{        headers: { 'x-api-key': AI_GATEWAY_API_KEY },      }],    }],  },});
```

With [credential brokering](https://vercel.com/docs/vercel-sandbox/concepts/firewall#credentials-brokering), you can omit the API key from the `opencode.json` config entirely. The firewall injects it into every outbound request to the allowed domain.

## [Connect to OpenCode](#connect-to-opencode)[](#connect-to-opencode)

Once the server is running, `sandbox.domain(OPENCODE_PORT)` returns the public URL (e.g. `https://sb-xxxxxxxx.vercel.run`). You can connect to it two ways.

### [Web UI](#web-ui)[](#web-ui)

Open the public URL in your browser. You'll be prompted for HTTP basic auth credentials:

*   Username: `opencode`
*   Password: the value you generated earlier (stored in the `password` variable)

### [Terminal UI (attach)](#terminal-ui-attach)[](#terminal-ui-attach)

You can also connect your local terminal for the full TUI experience. [Install OpenCode locally](https://opencode.ai/docs) first, then run:

```
OPENCODE_SERVER_PASSWORD=<your_password> \  opencode attach https://sb-xxxxxxxx.vercel.run
```

Replace `<your_password>` with the password your script generated, and the URL with your actual sandbox domain.

## [Using snapshots for faster starts](#using-snapshots-for-faster-starts)[](#using-snapshots-for-faster-starts)

Installing OpenCode takes a few seconds. You can capture the installed state as a snapshot and skip that step on future sandboxes:

```
const snapshot = await sandbox.snapshot();console.log('Snapshot ID:', snapshot.snapshotId);
```

Create new sandboxes from the snapshot with the egress policy applied from the start:

```
const sandbox = await Sandbox.create({  source: { type: 'snapshot', snapshotId: 'snap_xxxxxxxx' },  timeout: 60 * 60 * 1000,  ports: [OPENCODE_PORT],  resources: { vcpus: 2 },  networkPolicy: { allow: ['ai-gateway.vercel.sh'] },});
```

The sandbox boots with OpenCode already installed and egress locked down. You only need to [start the server](#start-the-server).

## [Sending prompts via the API](#sending-prompts-via-the-api)[](#sending-prompts-via-the-api)

You can interact with OpenCode programmatically through its REST API. This is useful for automated workflows, CI pipelines, or building your own frontend.

First, create a helper for authenticated requests:

```
const headers = {  Authorization: `Basic ${auth}`,  'Content-Type': 'application/json',};
```

Create a session:

```
const session = await fetch(`${publicUrl}/session`, {  method: 'POST',  headers,  body: JSON.stringify({ title: 'My session' }),}).then(r => r.json());
```

Send a message and read the response:

```
const response = await fetch(`${publicUrl}/session/${session.id}/message`, {  method: 'POST',  headers,  body: JSON.stringify({    model: {      providerID: 'vercel',      modelID: 'anthropic/claude-sonnet-4.6',    },    parts: [{ type: 'text', text: 'Hello!' }],  }),}).then(r => r.json());
const text = response.parts  ?.filter((p: any) => p.type === 'text')  .map((p: any) => p.content || p.text)  .join('');console.log(text);
```

For typed requests and built-in SSE support, you can use the \`[@opencode-ai/sdk](https://www.npmjs.com/package/@opencode-ai/sdk)\` package. Point \`createOpencodeClient()\` at your sandbox URL with the same auth headers shown above.

## [Security](#security)[](#security)

*   Egress control: call `sandbox.updateNetworkPolicy()` to restrict outbound traffic to only the domains the agent needs. Everything else is blocked at the network level, so the agent cannot reach your email, internal APIs, or anything outside the allowlist.
*   Credential brokering: inject API keys at the firewall level so they never enter the sandbox. The agent makes authenticated requests without seeing the credentials.
*   Sandbox isolation: each sandbox is its own MicroVM with no access to your host machine.
*   Password auth: the server is protected with HTTP basic auth, so only you can access the web UI and API.
*   Timeouts: sandboxes shut down automatically when the timeout expires, so nothing runs forever by accident.
*   Port control: only ports you explicitly declare in `ports` are reachable from the internet.
