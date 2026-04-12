# Vercel Sandbox

[Vercel Sandbox](/sandbox) is a compute primitive designed to safely run untrusted or user-generated code on Vercel. It supports dynamic, real-time workloads for AI agents, code generation, and developer experimentation.

## Use Cases

- **Execute untrusted code safely**: Run AI agent output, user uploads, or third-party scripts without exposing your production systems.
- **Build interactive tools**: Create code playgrounds, AI-powered UI builders, or developer sandboxes.
- **Test in isolation**: Preview how user-submitted or agent-generated code behaves in a self-contained environment with access to logs, file edits, and live previews.
- **Run development servers**: Spin up and test applications with live previews.

## Getting Started

- **[Quickstart](/docs/vercel-sandbox/quickstart)**: Create your first sandbox
- **[SDK Reference](/docs/vercel-sandbox/sdk-reference)**: TypeScript/Python SDK (recommended)
- **[CLI Reference](/docs/vercel-sandbox/cli-reference)**: Command-line interface

## Features

- **Isolation**: Firecracker microVMs with separate filesystem and network
- **Runtimes**: Node.js 24, 22, and Python 3.13
- **Fast startup**: Milliseconds to spin up
- **Snapshots**: Save/restore sandbox state
- **Persistent sandboxes** (beta): Auto-save state on stop
- **Tags** (beta): Categorize sandboxes

## Authentication

- **OIDC tokens** (recommended): Via `vercel link` + `vercel env pull`
- **Access tokens**: For CI/CD or non-Vercel environments

See [Authentication](/docs/vercel-sandbox/concepts/authentication) for setup.

## Pricing

- **Hobby**: Free (5 hours CPU/month, 5,000 creations/month)
- **Pro**: $0.128/hour CPU, $0.0212/GB-hour memory
- **Enterprise**: Custom pricing

See [Pricing](/docs/vercel-sandbox/pricing) for details.