#!/usr/bin/env node

import { CredentialStore } from "../src/credential-store.js"
import { createSandboxOpencodeClient } from "../src/opencode-client.js"
import { classifyAuthMethod, pickBestOAuthMethod } from "../src/provider-registry.js"

function usage(): string {
  return [
    "Usage:",
    "  bridge auth status",
    "  bridge auth connect <provider> [method]",
    "  bridge auth set-key <provider> --stdin",
    "  bridge auth github --stdin",
    "  bridge auth disconnect <provider>",
    "",
    "Examples:",
    "  printf %s \"$OPENAI_API_KEY\" | bridge auth set-key openai --stdin",
    "  printf %s \"$GITHUB_TOKEN\" | bridge auth github --stdin",
  ].join("\n")
}

function getFlagValue(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag)
  if (index === -1 || index + 1 >= args.length) {
    return undefined
  }
  return args[index + 1]
}

async function readSecretFromStdin(): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  return Buffer.concat(chunks).toString("utf-8").trim()
}

async function main(): Promise<void> {
  const bridgeSecret = process.env.BRIDGE_SECRET
  if (!bridgeSecret) {
    throw new Error("BRIDGE_SECRET is required")
  }

  const store = new CredentialStore(bridgeSecret)
  const args = process.argv.slice(2)

  if (args.length === 0) {
    console.log(usage())
    return
  }

  const [command, subcommand, provider, method] = args

  if (command === "status") {
    const providers = store.listProviders()
    const githubConfigured = Boolean(store.getGithubToken())
    console.log(`Providers: ${providers.length > 0 ? providers.join(", ") : "none"}`)
    console.log(`GitHub: ${githubConfigured ? "configured" : "not configured"}`)
    return
  }

  if (command === "connect") {
    if (!subcommand) {
      throw new Error("Provider is required. Usage: bridge auth connect <provider> [method]")
    }
    const baseUrl = process.env.OPENCODE_BASE_URL
    if (!baseUrl) {
      throw new Error("OPENCODE_BASE_URL is required for local OAuth connect")
    }

    const client = createSandboxOpencodeClient(baseUrl, process.env.OPENCODE_SERVER_PASSWORD)
    const methods = await client.provider.auth()
    const providerMethods = methods[subcommand] || []
    if (providerMethods.length === 0) {
      throw new Error(`No auth methods reported for provider '${subcommand}'`)
    }

    const normalizedMethods = providerMethods.map((method) => ({
      label: method.label,
      kind: classifyAuthMethod(method.label),
    }))
    const index = pickBestOAuthMethod(normalizedMethods, provider)
    if (index < 0) {
      throw new Error(
        `No OAuth/device/browser method found for '${subcommand}'. Use 'bridge auth set-key ${subcommand} --stdin' instead.`,
      )
    }

    const authStart = await client.provider.oauth.authorize({
      path: { id: subcommand },
      body: { method: index },
    })
    const instructions = typeof authStart.instructions === "string" ? authStart.instructions : undefined
    const url = typeof authStart.url === "string" ? authStart.url : undefined

    console.log(`Started local OAuth for '${subcommand}' using method '${providerMethods[index].label}'.`)
    if (instructions) {
      console.log(instructions)
    }
    if (url) {
      console.log(`Open this URL: ${url}`)
    }

    console.log("Press Enter after completing login in your browser...")
    await new Promise<void>((resolve) => {
      process.stdin.resume()
      process.stdin.once("data", () => resolve())
    })

    const callback = await client.provider.oauth.callback({
      path: { id: subcommand },
      body: { method: index },
    })
    if (callback && Object.keys(callback).length > 0) {
      store.setProviderAuth(subcommand, callback)
    }

    console.log(`Connected provider '${subcommand}'.`)
    return
  }

  if (command === "set-key") {
    if (!subcommand) {
      throw new Error("Provider is required. Usage: bridge auth set-key <provider> --stdin")
    }
    const value = args.includes("--stdin")
      ? await readSecretFromStdin()
      : getFlagValue(args, "--value")
    if (!value) {
      throw new Error("Missing secret. Use --stdin with a local secret source.")
    }

    store.setProviderAuth(subcommand, {
      type: "api-key",
      key: value,
    })
    console.log(`Stored API key for provider '${subcommand}'.`)
    return
  }

  if (command === "github") {
    const value = args.includes("--stdin")
      ? await readSecretFromStdin()
      : getFlagValue(args, "--value")
    if (!value) {
      throw new Error("Missing token. Use --stdin with a local secret source.")
    }
    store.setGithubToken(value)
    console.log("Stored GitHub token.")
    return
  }

  if (command === "disconnect") {
    if (!subcommand) {
      throw new Error("Provider is required. Usage: bridge auth disconnect <provider>")
    }
    const removed = store.removeProviderAuth(subcommand)
    console.log(removed ? `Disconnected '${subcommand}'.` : `Provider '${subcommand}' was not configured.`)
    return
  }

  console.log(usage())
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
