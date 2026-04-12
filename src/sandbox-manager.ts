/**
 * Manages Vercel Sandboxes for Discord channels.
 * Handles creation, resumption, and OpenCode server lifecycle.
 */
import { Sandbox } from "@vercel/sandbox"

export interface SandboxContext {
  sandboxId: string
  opencodeBaseUrl: string
  opencodePassword: string
}

export interface OAuthStartResult {
  success?: boolean
  message?: string
  url?: string
  userCode?: string
  instructions?: string
  deviceAuthId?: string
}

export interface OAuthCompleteResult {
  success: boolean
  message?: string
  tokens?: Record<string, unknown>
}

export interface SandboxManagerOptions {
  runtime?: "node24" | "node22" | "python3.13"
  vcpus?: number
  timeout?: number
  persistent?: boolean
}

const DEFAULT_OPTIONS: Required<SandboxManagerOptions> = {
  runtime: "node24",
  vcpus: 2,
  timeout: 30 * 60 * 1000, // 30 minutes
  persistent: true,
}

export class SandboxManager {
  private readonly options: Required<SandboxManagerOptions>
  private readonly cache = new Map<string, SandboxContext>()

  constructor(options: SandboxManagerOptions = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options } as Required<SandboxManagerOptions>
  }

  getSandboxName(channelId: string): string {
    return `discord-channel-${channelId}`
  }

  async getOrCreate(
    channelId: string,
    sandboxIdFromState: string | undefined,
    repoUrl?: string,
    branch = "main",
  ): Promise<SandboxContext> {
    const cached = this.cache.get(channelId)
    if (cached) {
      return cached
    }

    let sandbox: Sandbox

    // Try to resume existing sandbox by ID
    if (sandboxIdFromState) {
      try {
        sandbox = await Sandbox.get({ sandboxId: sandboxIdFromState })
        console.log(`[SandboxManager] Resumed sandbox: ${sandbox.sandboxId}`)
      } catch (error) {
        console.log(`[SandboxManager] Could not resume sandbox ${sandboxIdFromState}, creating new`)
        sandbox = await this.createSandbox(channelId, repoUrl, branch)
      }
    } else {
      // No ID, create new
      sandbox = await this.createSandbox(channelId, repoUrl, branch)
    }

    const context = await this.ensureOpenCodeServer(sandbox)
    this.cache.set(channelId, context)
    return context
  }

  private async createSandbox(channelId: string, repoUrl?: string, branch = "main"): Promise<Sandbox> {
    const name = this.getSandboxName(channelId)

    const createOptions: Parameters<typeof Sandbox.create>[0] = {
      runtime: this.options.runtime,
      resources: { vcpus: this.options.vcpus },
      timeout: this.options.timeout,
    }

    if (repoUrl) {
      createOptions.source = {
        type: "git",
        url: repoUrl,
        depth: 1,
        revision: branch !== "main" ? branch : undefined,
      }
    }

    console.log(`[SandboxManager] Creating sandbox: ${name}`)
    const sandbox = await Sandbox.create(createOptions)
    console.log(`[SandboxManager] Sandbox created: ${sandbox.sandboxId}`)

    return sandbox
  }

  private async ensureOpenCodeServer(sandbox: Sandbox): Promise<SandboxContext> {
    const password = generatePassword()
    const port = 4096

    // Check if OpenCode is already running
    const checkResult = await sandbox.runCommand({
      cmd: "curl",
      args: ["-s", "-o", "/dev/null", "-w", "%{http_code}", `http://localhost:${port}/global/health`],
    }).catch(() => ({ exitCode: 1 }))

    if (checkResult.exitCode === 0) {
      console.log(`[SandboxManager] OpenCode server already running`)
      return {
        sandboxId: sandbox.sandboxId,
        opencodeBaseUrl: `https://${sandbox.sandboxId}.vercel.app`,
        opencodePassword: password,
      }
    }

    // Install OpenCode if needed
    await this.ensureOpenCodeInstalled(sandbox)

    // Fetch and inject user config from gist if configured
    await this.injectUserConfig(sandbox)

    // Inject credentials from env vars into sandbox env
    const envPrefix = this.buildCredentialsEnv()

    // Start OpenCode server with injected credentials
    console.log(`[SandboxManager] Starting OpenCode server`)
    await sandbox.runCommand({
      cmd: "bash",
      args: [
        "-lc",
        `${envPrefix} OPENCODE_SERVER_PASSWORD=${password} nohup opencode serve --hostname 0.0.0.0 --port ${port} >/tmp/opencode.log 2>&1 &`,
      ],
    })

    // Wait for server to be ready
    await this.waitForOpenCode(sandbox, port)

    return {
      sandboxId: sandbox.sandboxId,
      opencodeBaseUrl: `https://${sandbox.sandboxId}.vercel.app`,
      opencodePassword: password,
    }
  }

  private buildCredentialsEnv(): string {
    const parts: string[] = []
    for (const key of Object.keys(process.env)) {
      if (key.endsWith("_API_KEY") || key === "GITHUB_TOKEN") {
        parts.push(`${key}=${process.env[key]} `)
      }
    }
    return parts.join("")
  }

  private async ensureOpenCodeInstalled(sandbox: Sandbox): Promise<void> {
    // Check if opencode is available
    const checkResult = await sandbox.runCommand({
      cmd: "which",
      args: ["opencode"],
    }).catch(() => ({ exitCode: 1 }))

    if (checkResult.exitCode === 0) {
      return
    }

    console.log(`[SandboxManager] Installing OpenCode`)
    await sandbox.runCommand({
      cmd: "bash",
      args: ["-lc", "curl -LsSf https://opencode.ai/install.sh | sh"],
    })
  }

  private async injectUserConfig(sandbox: Sandbox): Promise<void> {
    const gistUrl = process.env.OPENCODE_GIST_URL
    if (!gistUrl) {
      return
    }

    console.log(`[SandboxManager] Fetching user config from gist`)

    try {
      // Fetch gist content
      // Extract gist ID from URL
      const gistIdMatch = gistUrl.match(/gist\.github\.com\/[^/]+\/([a-f0-9]+)/i)
      if (!gistIdMatch) {
        console.log(`[SandboxManager] Invalid gist URL format`)
        return
      }

      const gistId = gistIdMatch[1]
      const apiUrl = `https://api.github.com/gists/${gistId}`

      const response = await fetch(apiUrl, {
        headers: {
          Accept: "application/vnd.github.v3+json",
        },
      })

      if (!response.ok) {
        console.log(`[SandboxManager] Failed to fetch gist: ${response.status}`)
        return
      }

      const gist = (await response.json()) as {
        files: Record<string, { content: string; filename: string }>
      }

      // Determine target directory in sandbox
      const targetDir = "/vercel/sandbox/.opencode"

      // Write files to sandbox
      const files: Array<{ path: string; content: Buffer }> = []

      for (const [filename, file] of Object.entries(gist.files)) {
        const targetPath = filename.endsWith(".jsonc") || filename.endsWith(".json")
          ? `${targetDir}/${filename}`
          : `${targetDir}/${filename}`

        files.push({
          path: targetPath,
          content: Buffer.from(file.content || ""),
        })
      }

      if (files.length > 0) {
        await sandbox.writeFiles(files)
        console.log(`[SandboxManager] Wrote ${files.length} config files to sandbox`)
      }
    } catch (error) {
      console.log(`[SandboxManager] Failed to inject user config:`, error)
    }
  }

  private async waitForOpenCode(sandbox: Sandbox, port: number, maxAttempts = 30): Promise<void> {
    for (let i = 0; i < maxAttempts; i++) {
      const result = await sandbox.runCommand({
        cmd: "curl",
        args: ["-s", "-o", "/dev/null", "-w", "%{http_code}", `http://localhost:${port}/global/health`],
      }).catch(() => ({ exitCode: 1 }))

      if (result.exitCode === 0) {
        console.log(`[SandboxManager] OpenCode server ready`)
        return
      }

      await new Promise((resolve) => setTimeout(resolve, 1000))
    }

    throw new Error("OpenCode server failed to start")
  }

  async runCommand(
    channelId: string,
    cmd: string,
    args: string[],
    options?: { cwd?: string; env?: Record<string, string> },
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    const context = await this.getOrCreate(channelId, undefined)
    const sandbox = await Sandbox.get({ sandboxId: context.sandboxId })
    const result = await sandbox.runCommand({
      cmd,
      args,
      cwd: options?.cwd,
      env: options?.env,
    })

    return {
      stdout: await result.stdout(),
      stderr: await result.stderr(),
      exitCode: result.exitCode,
    }
  }

  async startOAuth(channelId: string, providerId: string, method?: number): Promise<OAuthStartResult> {
    const context = await this.getOrCreate(channelId, undefined)
    const url = `${context.opencodeBaseUrl}/provider/${providerId}/oauth/authorize`
    const body = method !== undefined ? JSON.stringify({ method }) : "{}"

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${Buffer.from(`opencode:${context.opencodePassword}`).toString("base64")}`,
      },
      body,
    })

    if (!response.ok) {
      return { success: false, message: `OAuth start failed: ${response.status}` }
    }

    const data = (await response.json()) as { data?: { url?: string; user_code?: string; instructions?: string; device_auth_id?: string } }
    const result = data.data || {}

    return {
      url: result.url,
      userCode: result.user_code,
      instructions: result.instructions,
      deviceAuthId: result.device_auth_id,
    }
  }

  async completeOAuth(
    channelId: string,
    providerId: string,
    method: number,
    deviceAuthId?: string,
  ): Promise<OAuthCompleteResult> {
    const context = await this.getOrCreate(channelId, undefined)

    const url = `${context.opencodeBaseUrl}/provider/${providerId}/oauth/callback`
    const body = JSON.stringify({ method, device_auth_id: deviceAuthId })

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${Buffer.from(`opencode:${context.opencodePassword}`).toString("base64")}`,
      },
      body,
    })

    if (!response.ok) {
      return { success: false, message: `OAuth callback failed: ${response.status}` }
    }

    const data = (await response.json()) as { data?: Record<string, unknown> }
    const tokens = data.data

    if (tokens) {
      // Save tokens directly to sandbox filesystem
      await this.saveCredentialsToSandbox(context.sandboxId, providerId, tokens)
    }

    return {
      success: true,
      tokens,
    }
  }

  private async saveCredentialsToSandbox(sandboxId: string, providerId: string, tokens: Record<string, unknown>): Promise<void> {
    try {
      const sandbox = await Sandbox.get({ sandboxId })

      // Read existing credentials
      let existing: Record<string, Record<string, unknown>> = {}
      try {
        const content = await sandbox.readFileToBuffer({ path: "/vercel/sandbox/.opencode-credentials.json" })
        if (content) {
          existing = JSON.parse(content.toString())
        }
      } catch {
        // No existing credentials
      }

      // Add new provider credentials
      existing[providerId] = tokens

      // Write back
      await sandbox.writeFiles([
        { path: "/vercel/sandbox/.opencode-credentials.json", content: Buffer.from(JSON.stringify(existing, null, 2)) },
      ])
      console.log(`[SandboxManager] Saved OAuth tokens for '${providerId}' to sandbox`)
    } catch (error) {
      console.error(`[SandboxManager] Failed to save credentials to sandbox:`, error)
    }
  }

  async stop(channelId: string): Promise<void> {
    const context = this.cache.get(channelId)
    if (context) {
      try {
        const sandbox = await Sandbox.get({ sandboxId: context.sandboxId })
        await sandbox.stop()
      } catch (e) {
        // Already stopped
      }
      this.cache.delete(channelId)
    }
  }

  async stopAll(): Promise<void> {
    for (const channelId of this.cache.keys()) {
      await this.stop(channelId)
    }
  }
}

function generatePassword(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"
  let result = ""
  for (let i = 0; i < 32; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return result
}

export function getSandboxManager(): SandboxManager {
  if (!globalSandboxManager) {
    globalSandboxManager = new SandboxManager()
  }
  return globalSandboxManager
}

let globalSandboxManager: SandboxManager | null = null