/**
 * Manages Vercel Sandboxes for Discord channels.
 * Handles creation, resumption, and OpenCode server lifecycle.
 */
import { Sandbox } from "@vercel/sandbox"
import { get } from "@vercel/blob"

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
  sandboxId?: string
  opencodePassword?: string
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

const OPENCODE_PORT = 4096
const OPENCODE_CONFIG_BLOB_PATH = "opencode-config/config-bundle.json"

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
    opencodePasswordFromState?: string,
  ): Promise<SandboxContext> {
    const cached = this.cache.get(channelId)
    if (cached) {
      const healthy = await fetch(`${cached.opencodeBaseUrl}/global/health`, {
        method: "GET",
        signal: AbortSignal.timeout(3000),
      })
        .then((response) => response.ok)
        .catch(() => false)

      if (healthy) {
        return cached
      }

      this.cache.delete(channelId)
    }

    let sandbox: Sandbox

    // Try to resume existing sandbox by ID
    if (sandboxIdFromState) {
      try {
        sandbox = await Sandbox.get({ sandboxId: sandboxIdFromState })
        console.log(`[SandboxManager] Resumed sandbox: ${sandbox.sandboxId}`)

        if (opencodePasswordFromState) {
          const resumedContext: SandboxContext = {
            sandboxId: sandbox.sandboxId,
            opencodeBaseUrl: this.getOpenCodeBaseUrl(sandbox),
            opencodePassword: opencodePasswordFromState,
          }

          const healthy = await fetch(`${resumedContext.opencodeBaseUrl}/global/health`, {
            method: "GET",
            headers: {
              Authorization: `Basic ${Buffer.from(`opencode:${resumedContext.opencodePassword}`).toString("base64")}`,
            },
            signal: AbortSignal.timeout(3000),
          })
            .then((response) => response.ok)
            .catch(() => false)

          if (healthy) {
            this.cache.set(channelId, resumedContext)
            return resumedContext
          }
        }
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
      ports: [OPENCODE_PORT],
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
    const port = OPENCODE_PORT
    const opencodeBaseUrl = this.getOpenCodeBaseUrl(sandbox)

    // Install OpenCode if needed
    await this.ensureOpenCodeInstalled(sandbox)
    await this.ensureGitHubCliInstalled(sandbox)
    const opencodePath = await this.resolveOpenCodePath(sandbox)

    // Fetch and inject user config (Blob preferred, gist fallback)
    await this.injectUserConfig(sandbox)

    // Configure non-interactive GitHub auth for git clone/fetch in tools
    await this.ensureGitAskPassConfigured(sandbox)

    // Inject credentials from env vars into sandbox env
    const envPrefix = this.buildCredentialsEnv()

    // Ensure previous OpenCode server process does not hold the port
    await sandbox.runCommand({
      cmd: "bash",
      args: ["-lc", "pkill -f 'opencode serve' >/dev/null 2>&1 || true"],
    })

    // Start OpenCode server with injected credentials
    console.log(`[SandboxManager] Starting OpenCode server`)
    await sandbox.runCommand({
      cmd: "bash",
      args: [
        "-lc",
        `${envPrefix} PATH="$HOME/.local/bin:$PATH" GIT_ASKPASS=/tmp/git-askpass.sh GIT_TERMINAL_PROMPT=0 OPENCODE_SERVER_PASSWORD=${password} nohup ${opencodePath} serve --hostname 0.0.0.0 --port ${port} >/tmp/opencode.log 2>&1 &`,
      ],
    })

    // Wait for server to be ready
    await this.waitForOpenCode(sandbox, port)

    return {
      sandboxId: sandbox.sandboxId,
      opencodeBaseUrl,
      opencodePassword: password,
    }
  }

  private getOpenCodeBaseUrl(sandbox: Sandbox): string {
    return sandbox.domain(OPENCODE_PORT)
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

  private async ensureGitAskPassConfigured(sandbox: Sandbox): Promise<void> {
    if (!process.env.GITHUB_TOKEN) {
      return
    }

    await sandbox.runCommand({
      cmd: "bash",
      args: [
        "-lc",
        "printf '%s\\n' '#!/bin/sh' 'prompt=\"$1\"' 'case \"$prompt\" in' '*Username*) echo \"x-access-token\" ;;' '*Password*) echo \"$GITHUB_TOKEN\" ;;' '*) echo \"\" ;;' 'esac' > /tmp/git-askpass.sh && chmod 700 /tmp/git-askpass.sh",
      ],
    })
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
    const installResult = await sandbox.runCommand({
      cmd: "bash",
      args: ["-lc", "curl -LsSf https://opencode.ai/install 2>&1 | head -20"],
    }).catch(() => null)
    console.error(`[SandboxManager] Install script preview: ${installResult ? await installResult.stdout() : "curl failed"}`)

    await sandbox.runCommand({
      cmd: "bash",
      args: ["-lc", "curl -fsSL https://opencode.ai/install | bash"],
    })

    // Ensure executable permission
    await sandbox.runCommand({
      cmd: "bash",
      args: ["-lc", "chmod +x ~/.local/bin/opencode 2>/dev/null || true"],
    })

    const afterInstall = await sandbox.runCommand({
      cmd: "bash",
      args: ["-c", "ls -la ~/.local/bin/ 2>/dev/null || echo 'no .local/bin'; echo '---'; echo PATH=$PATH"],
    }).catch(() => null)
    console.error(`[SandboxManager] After install: ${afterInstall ? await afterInstall.stdout() : "error"}`)

    const verifyResult = await sandbox.runCommand({
      cmd: "bash",
      args: ["-lc", "command -v opencode >/dev/null 2>&1 || [ -x \"$HOME/.local/bin/opencode\" ]"],
    }).catch(() => ({ exitCode: 1 }))

    if (verifyResult.exitCode !== 0) {
      throw new Error("OpenCode installation completed but executable not found")
    }
  }

  private async resolveOpenCodePath(sandbox: Sandbox): Promise<string> {
    const result = await sandbox.runCommand({
      cmd: "bash",
      args: [
        "-lc",
        "if command -v opencode >/dev/null 2>&1; then command -v opencode; elif [ -x \"$HOME/.local/bin/opencode\" ]; then echo \"$HOME/.local/bin/opencode\"; elif [ -f \"$HOME/.local/bin/opencode\" ]; then chmod +x \"$HOME/.local/bin/opencode\" && echo \"$HOME/.local/bin/opencode\"; else exit 1; fi",
      ],
    }).catch(() => null)

    const path = (result ? await result.stdout() : "").trim()
    if (!path) {
      throw new Error("OpenCode executable path could not be resolved")
    }
    return path
  }

  private async ensureGitHubCliInstalled(sandbox: Sandbox): Promise<void> {
    const checkResult = await sandbox.runCommand({
      cmd: "bash",
      args: ["-lc", "command -v gh >/dev/null 2>&1"],
    }).catch(() => ({ exitCode: 1 }))

    if (checkResult.exitCode === 0) {
      return
    }

    console.log("[SandboxManager] Installing GitHub CLI (gh)")
    const installResult = await sandbox.runCommand({
      cmd: "bash",
      args: [
        "-lc",
        [
          "set -e",
          "if command -v gh >/dev/null 2>&1; then exit 0; fi",
          "mkdir -p \"$HOME/.local/bin\"",
          "arch=$(uname -m)",
          "gh_arch=amd64",
          "if [ \"$arch\" = \"aarch64\" ] || [ \"$arch\" = \"arm64\" ]; then gh_arch=arm64; fi",
          "version=${GH_VERSION:-2.72.0}",
          "tmp=\"/tmp/gh_${version}_linux_${gh_arch}.tar.gz\"",
          "curl -fsSL \"https://github.com/cli/cli/releases/download/v${version}/gh_${version}_linux_${gh_arch}.tar.gz\" -o \"$tmp\"",
          "tar -xzf \"$tmp\" -C /tmp",
          "cp \"/tmp/gh_${version}_linux_${gh_arch}/bin/gh\" \"$HOME/.local/bin/gh\"",
          "chmod +x \"$HOME/.local/bin/gh\"",
        ].join("; "),
      ],
    }).catch(() => null)

    if (!installResult || installResult.exitCode !== 0) {
      const diagnostics = await sandbox.runCommand({
        cmd: "bash",
        args: [
          "-lc",
          [
            "echo '--- uname ---'",
            "uname -a || true",
            "echo '--- whoami ---'",
            "whoami || true",
            "echo '--- path ---'",
            "echo $PATH",
            "echo '--- gh lookup ---'",
            "command -v gh || true",
            "ls -la $HOME/.local/bin 2>/dev/null || true",
            "echo '--- apt-get ---'",
            "command -v apt-get || true",
            "echo '--- tar/curl ---'",
            "command -v tar || true",
            "command -v curl || true",
          ].join("; "),
        ],
      }).catch(() => null)

      const installStdout = installResult ? await installResult.stdout().catch(() => "") : ""
      const installStderr = installResult ? await installResult.stderr().catch(() => "") : ""
      const diagnosticsText = diagnostics ? await diagnostics.stdout().catch(() => "") : ""
      throw new Error(
        `GitHub CLI install command failed. stdout=${installStdout} stderr=${installStderr} diagnostics=${diagnosticsText}`,
      )
    }

    const verifyResult = await sandbox.runCommand({
      cmd: "bash",
      args: ["-lc", "command -v gh >/dev/null 2>&1 || [ -x \"$HOME/.local/bin/gh\" ]"],
    }).catch(() => ({ exitCode: 1 }))

    if (verifyResult.exitCode !== 0) {
      const diagnostics = await sandbox.runCommand({
        cmd: "bash",
        args: ["-lc", "echo PATH=$PATH; command -v gh || true; ls -la $HOME/.local/bin 2>/dev/null || true"],
      }).catch(() => null)
      const diagnosticsText = diagnostics ? await diagnostics.stdout().catch(() => "") : ""
      throw new Error(`GitHub CLI installation completed but executable not found. diagnostics=${diagnosticsText}`)
    }
  }

  private async injectUserConfig(sandbox: Sandbox): Promise<void> {
    const injectedFromBlob = await this.injectUserConfigFromBlob(sandbox)
    if (!injectedFromBlob) {
      console.log("[SandboxManager] No OpenCode config bundle found in Blob; continuing with defaults")
    }
  }

  private async injectUserConfigFromBlob(sandbox: Sandbox): Promise<boolean> {
    if (!process.env.BLOB_READ_WRITE_TOKEN) {
      return false
    }

    const path = process.env.OPENCODE_CONFIG_BLOB_PATH || OPENCODE_CONFIG_BLOB_PATH

    try {
      const result = await get(path, { access: "private" }).catch(() => null)
      if (!result || result.statusCode !== 200 || !result.stream) {
        return false
      }

      const text = await new Response(result.stream).text()
      const payload = JSON.parse(text) as {
        files?: Record<string, string>
      }

      const filesMap = payload.files || {}
      const targetDir = "/home/vercel-sandbox/.config/opencode"
      const files: Array<{ path: string; content: Buffer }> = []

      for (const [relativePath, rawContent] of Object.entries(filesMap)) {
        const content = this.sanitizeOpenCodeConfig(relativePath, rawContent || "")
        files.push({
          path: `${targetDir}/${relativePath}`,
          content: Buffer.from(content),
        })
      }

      if (files.length > 0) {
        await sandbox.writeFiles(files)
        console.log(`[SandboxManager] Wrote ${files.length} config files from Blob`)
      }

      return files.length > 0
    } catch (error) {
      console.log("[SandboxManager] Failed to inject user config from Blob:", error)
      return false
    }
  }

  private sanitizeOpenCodeConfig(filename: string, content: string): string {
    if (!filename.endsWith("opencode.jsonc") && !filename.endsWith("opencode.json")) {
      return content
    }

    const sanitized = content
      .replace(/^\s*["']?projectId["']?\s*:\s*.*?,?\s*$/gm, "")
      .replace(/^\s*["']?orgId["']?\s*:\s*.*?,?\s*$/gm, "")
      .replace(/^\s*["']?projectName["']?\s*:\s*.*?,?\s*$/gm, "")

    if (sanitized !== content) {
      console.log(`[SandboxManager] Removed unsupported OpenCode config keys from ${filename}`)
    }

    return sanitized
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

    console.error(`[SandboxManager] Sandbox ID: ${sandbox.sandboxId}`)

    const runAndLog = async (label: string, cmd: string, args: string[]): Promise<void> => {
      try {
        const result = await sandbox.runCommand({ cmd, args })
        const stdout = await result.stdout()
        console.error(`[SandboxManager] ${label}: ${stdout || "(empty)"}`)
      } catch (e) {
        console.error(`[SandboxManager] ${label}: error - ${e}`)
      }
    }

    await runAndLog("Bash & PATH", "bash", ["-c", "echo 'bash works'; echo PATH=$PATH"])
    await runAndLog("OpenCode locations", "bash", ["-c", "ls -la ~/.local/bin/opencode 2>/dev/null || echo 'not in ~/.local/bin'; ls -la /usr/local/bin/opencode 2>/dev/null || echo 'not in /usr/local/bin'; which opencode 2>&1"])
    await runAndLog("OpenCode type", "bash", ["-c", "type opencode 2>&1 || echo 'not found'"])
    await runAndLog("OpenCode version", "bash", ["-c", "opencode --version 2>&1 || echo 'version failed'"])
    await runAndLog("Direct opencode", "bash", ["-c", "$HOME/.local/bin/opencode --version 2>&1 || echo 'direct failed'"])
    await runAndLog("OpenCode env vars", "bash", ["-c", "env | grep -i opencode || echo 'no opencode env'"])
    await runAndLog("Install locations", "bash", ["-c", "ls -la ~/.bun/install/ 2>/dev/null || echo 'no bun install'; ls -la ~/.local/share/opencode/bin/ 2>/dev/null || echo 'no opencode bin'"])

    const logResult = await sandbox.runCommand({ cmd: "bash", args: ["-c", "cat /tmp/opencode.log 2>/dev/null || echo '(log missing)'"] }).catch(() => null)
    const logText = logResult ? await logResult.stdout() : null
    console.error(`[SandboxManager] OpenCode startup log: ${logText || "(could not read)"}`)

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

  async startOAuth(
    channelId: string,
    providerId: string,
    method?: number,
    sandboxIdFromState?: string,
    opencodePasswordFromState?: string,
  ): Promise<OAuthStartResult> {
    const context = await this.getOrCreate(channelId, sandboxIdFromState, undefined, "main", opencodePasswordFromState)
    const url = `${context.opencodeBaseUrl}/provider/${providerId}/oauth/authorize`
    const resolvedMethod = await this.resolveOAuthMethodIndex(context, providerId, method)
    if (resolvedMethod === undefined) {
      return {
        success: false,
        message: `Provider '${providerId}' has no OAuth method available.`,
      }
    }
    const body = JSON.stringify({ method: resolvedMethod })

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${Buffer.from(`opencode:${context.opencodePassword}`).toString("base64")}`,
      },
      body,
    })

    if (!response.ok) {
      const details = await response.text().catch(() => "")
      return { success: false, message: `OAuth start failed: ${response.status}${details ? ` ${details}` : ""}` }
    }

    const payload = (await response.json()) as {
      url?: string
      verification_uri?: string
      verification_url?: string
      verificationUri?: string
      user_code?: string
      userCode?: string
      instructions?: string
      device_auth_id?: string
      deviceAuthId?: string
      data?: {
        url?: string
        verification_uri?: string
        verification_url?: string
        verificationUri?: string
        user_code?: string
        userCode?: string
        instructions?: string
        device_auth_id?: string
        deviceAuthId?: string
      }
    }
    const result = payload.data || payload
    const urlValue =
      result.url
      || result.verification_uri
      || result.verification_url
      || result.verificationUri
    const userCodeValue = result.user_code || result.userCode
    const deviceAuthIdValue = result.device_auth_id || result.deviceAuthId

    if (!urlValue) {
      return {
        success: false,
        message: `OAuth start returned no URL for provider '${providerId}'. Response: ${JSON.stringify(result)}`,
      }
    }

    return {
      url: urlValue,
      userCode: userCodeValue,
      instructions: result.instructions,
      deviceAuthId: deviceAuthIdValue,
      sandboxId: context.sandboxId,
      opencodePassword: context.opencodePassword,
    }
  }

  async completeOAuth(
    channelId: string,
    providerId: string,
    method: number | undefined,
    deviceAuthId?: string,
    sandboxIdFromState?: string,
    opencodePasswordFromState?: string,
  ): Promise<OAuthCompleteResult> {
    const context = await this.getOrCreate(channelId, sandboxIdFromState, undefined, "main", opencodePasswordFromState)
    const resolvedMethod = await this.resolveOAuthMethodIndex(context, providerId, method)
    if (resolvedMethod === undefined) {
      return {
        success: false,
        message: `Provider '${providerId}' has no OAuth method available.`,
      }
    }

    const url = `${context.opencodeBaseUrl}/provider/${providerId}/oauth/callback`
    const body = JSON.stringify(
      deviceAuthId
        ? { method: resolvedMethod, device_auth_id: deviceAuthId }
        : { method: resolvedMethod },
    )

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${Buffer.from(`opencode:${context.opencodePassword}`).toString("base64")}`,
      },
      body,
    })

    if (!response.ok) {
      const details = await response.text().catch(() => "")
      return { success: false, message: `OAuth callback failed: ${response.status}${details ? ` ${details}` : ""}` }
    }

    await response.text().catch(() => "")
    const tokens = await this.readProviderAuthFromSandbox(context.sandboxId, providerId)

    return {
      success: true,
      tokens,
    }
  }

  private async readProviderAuthFromSandbox(
    sandboxId: string,
    runtimeProviderId: string,
  ): Promise<Record<string, unknown> | undefined> {
    try {
      const sandbox = await Sandbox.get({ sandboxId })
      const content = await sandbox.readFileToBuffer({ path: "/home/vercel-sandbox/.local/share/opencode/auth.json" })
      if (!content) {
        return undefined
      }

      const all = JSON.parse(content.toString("utf-8")) as Record<string, unknown>
      const entry = all[runtimeProviderId] ?? all[`${runtimeProviderId}/`]
      if (!entry || typeof entry !== "object") {
        return undefined
      }

      return entry as Record<string, unknown>
    } catch {
      return undefined
    }
  }

  private async resolveOAuthMethodIndex(
    context: SandboxContext,
    runtimeProviderId: string,
    explicitMethod?: number,
  ): Promise<number | undefined> {
    if (explicitMethod !== undefined) {
      return explicitMethod
    }

    const response = await fetch(`${context.opencodeBaseUrl}/provider/auth`, {
      headers: {
        Authorization: `Basic ${Buffer.from(`opencode:${context.opencodePassword}`).toString("base64")}`,
      },
    }).catch(() => null)

    if (!response?.ok) {
      return 0
    }

    const payload = (await response.json()) as {
      [key: string]: Array<{ label?: string }> | unknown
      data?: Record<string, Array<{ label?: string }>>
    }
    const methodsFromData = payload.data?.[runtimeProviderId]
    const methodsFromRoot = Array.isArray(payload[runtimeProviderId])
      ? (payload[runtimeProviderId] as Array<{ label?: string }>)
      : undefined
    const methods = methodsFromData || methodsFromRoot || []
    if (methods.length === 0) {
      return 0
    }

    const priorities = ["headless", "device", "code", "browser", "oauth"]
    for (const token of priorities) {
      const index = methods.findIndex((method) => (method.label || "").toLowerCase().includes(token))
      if (index >= 0) {
        return index
      }
    }

    return undefined
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
