# Discord Application Commands + Vercel Fluid Compute Notes

This file captures the two documentation pieces provided in discussion.

## Sources

- Discord application commands docs:
  - https://github.com/discord/discord-api-docs/blob/main/developers/interactions/application-commands.mdx
- Vercel Fluid Compute docs:
  - https://vercel.com/docs/fluid-compute

## Discord Application Commands (key excerpts)

- Application commands are native interactions with 3 primary command types:
  - `CHAT_INPUT` (slash commands)
  - `USER` (user context menu)
  - `MESSAGE` (message context menu)
- Commands are created/updated over HTTP endpoints.
- Commands can be global or guild-scoped.
- Commands can be authorized with `applications.commands` scope; command registration does not strictly require adding the bot scope if bot features are not needed.
- Interaction contexts (`GUILD`, `BOT_DM`, `PRIVATE_CHANNEL`) and installation contexts (`integration_types`) determine where commands appear.
- Slash commands support options, choices, autocomplete, subcommands, and subcommand groups.

## Vercel Fluid Compute (provided content)

### Frontmatter and summary

```md
---
title: Fluid compute
product: vercel
url: /docs/fluid-compute
type: reference
prerequisites:
  []
related:
  - /docs/fundamentals/what-is-compute
  - /docs/functions/functions-api-reference/vercel-functions-package
  - /docs/functions/configuring-functions/region
  - /docs/project-configuration
  - /docs/functions/runtimes/node-js
summary: Learn about fluid compute, an execution model for Vercel Functions that provides a more flexible and efficient way to run your functions.
install_vercel_plugin: npx plugins add vercel/vercel-plugin
---
```

### Highlights

- Fluid compute blends serverless flexibility with server-like capabilities.
- Benefits include:
  - zero config defaults,
  - optimized concurrency,
  - dynamic scaling,
  - background processing (`waitUntil`),
  - cold start optimizations,
  - AZ/region failover,
  - error isolation.
- Available for Node.js, Python, Edge, Bun, Rust.
- Enabled by default for new projects as of April 23, 2025.
- Can be enabled in `vercel.json` with:

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "fluid": true
}
```

- Default max durations by plan (from provided docs):
  - Hobby: up to 300s
  - Pro/Enterprise: up to 800s

### Additional notes from provided text

- Optimized in-function concurrency is especially useful for I/O-bound AI workloads.
- Bytecode caching applies for Node.js 20+ in production.
- Settings precedence order:
  1. function code,
  2. `vercel.json`,
  3. dashboard,
  4. fluid defaults.
