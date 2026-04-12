import nacl from "tweetnacl"
import { waitUntil } from "@vercel/functions"
import { ChannelStateStore } from "../../src/channel-state-store"
import { CredentialStore } from "../../src/credential-store"
import { handleDiscordCommand } from "../../src/discord-command-service"
import { mapInteractionCommandToText } from "../../src/interaction-command-mapper"
import { OpencodeRuntime } from "../../src/opencode-runtime"
import { executePromptForChannel } from "../../src/prompt-orchestrator"
import { loadProviderRegistryFromEnv } from "../../src/provider-registry-env"
import { GitHubClient, getGitHubClient } from "../../src/github-client"
import { getSandboxManager, type SandboxContext, type OAuthStartResult, type OAuthCompleteResult } from "../../src/sandbox-manager"

type Interaction = {
  id: string
  type: number
  token: string
  application_id: string
  channel_id?: string
  message?: {
    id: string
  }
  data: {
    custom_id?: string
    name: string
    values?: string[]
    options?: Array<{ name: string; type: number; value?: string | number | boolean }>
  }
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

function verifyDiscordRequest(
  body: string,
  signature: string,
  timestamp: string,
  publicKey: string,
): boolean {
  const msg = Buffer.from(timestamp + body)
  const sig = Buffer.from(signature, "hex")
  const key = Buffer.from(publicKey, "hex")
  return nacl.sign.detached.verify(msg, sig, key)
}

async function sendFollowup(
  applicationId: string,
  token: string,
  content: string,
  components?: unknown[],
): Promise<void> {
  await fetch(`https://discord.com/api/v10/webhooks/${applicationId}/${token}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content, components }),
  })
}

async function sendInitialResponse(
  applicationId: string,
  token: string,
  content: string,
  components?: unknown[],
): Promise<void> {
  await fetch(`https://discord.com/api/v10/webhooks/${applicationId}/${token}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      content,
      components,
      flags: 64,
    }),
  })
}

function compactForId(text: string, max = 80): string {
  const normalized = text.replace(/\s+/g, " ").trim()
  if (normalized.length <= max) {
    return normalized
  }
  return normalized.slice(0, max - 1)
}

function encodeToolPayload(kind: string, toolName: string, data: string): string {
  const payload = JSON.stringify({ k: kind, t: toolName, d: data })
  return Buffer.from(payload).toString("base64url").slice(0, 100)
}

function decodeToolPayload(encoded: string): { kind: string; toolName: string; data: string } | null {
  try {
    const decoded = Buffer.from(encoded, "base64url").toString("utf-8")
    const parsed = JSON.parse(decoded)
    if (parsed.k && parsed.t) {
      return { kind: parsed.k, toolName: parsed.t, data: parsed.d || "" }
    }
    return null
  } catch {
    return null
  }
}

function buildToolButtons(toolName: string, requestData: string, resultData: string): unknown[] {
  const reqEncoded = encodeToolPayload("req", toolName, requestData)
  const resEncoded = encodeToolPayload("res", toolName, resultData)
  const jsonEncoded = encodeToolPayload("json", toolName, requestData || resultData)
  return [
    {
      type: 1,
      components: [
        { type: 2, custom_id: `tool:${reqEncoded}`, label: "Request", style: 2 },
        { type: 2, custom_id: `tool:${resEncoded}`, label: "Result", style: 2 },
        { type: 2, custom_id: `tool:${jsonEncoded}`, label: "JSON", style: 2 },
      ],
    },
  ]
}

async function handleToolButtonInteraction(interaction: Interaction): Promise<Response> {
  const customId = interaction.data?.custom_id
  if (!customId) {
    return json({ type: 4, data: { content: "Missing button data." } })
  }

  if (!customId.startsWith("tool:")) {
    return json({ type: 4, data: { content: "Invalid button." } })
  }

  const encoded = customId.slice(5)
  const payload = decodeToolPayload(encoded)

  if (!payload) {
    return json({ type: 4, data: { content: "Could not decode tool data." } })
  }

  if (payload.kind === "req") {
    const code = payload.data || "No request data available."
    return json({
      type: 4,
      data: {
        content: `\`\`\`\nRequest (${payload.toolName}):\n${code}\n\`\`\``,
      },
    })
  }

  if (payload.kind === "res") {
    const code = payload.data || "No result data available."
    return json({
      type: 4,
      data: {
        content: `\`\`\`\nResult (${payload.toolName}):\n${code}\n\`\`\``,
      },
    })
  }

  const fullJson = JSON.stringify(
    { tool: payload.toolName, note: "Full JSON view limited in serverless mode" },
    null,
  )
  return json({
    type: 4,
    data: {
      content: `\`\`\`json\n${fullJson.slice(0, 1700)}\n\`\`\``,
    },
  })
}

async function handleProjectSelectMenu(interaction: Interaction): Promise<Response> {
  const customId = interaction.data?.custom_id
  const selectedValue = interaction.data?.values?.[0]

  if (!customId || !selectedValue) {
    return json({ type: 4, data: { content: "Missing selection." } })
  }

  const gh = getGitHubClient()
  if (!gh) {
    return json({ type: 4, data: { content: "GitHub is not configured (GITHUB_TOKEN missing)." } })
  }

  if (customId === "project:repo") {
    const parts = selectedValue.split(":")
    if (parts.length !== 2) {
      return json({ type: 4, data: { content: "Invalid repo selection." } })
    }
    const [owner, repo] = parts

    const branches = await gh.listBranches(owner, repo)
    if (branches.length === 0) {
      return json({ type: 4, data: { content: "No branches found in this repo." } })
    }

    const branchOptions = branches.map((b) => ({
      label: b.name,
      value: `${owner}:${repo}:${b.name}`,
    }))

    await sendInitialResponse(
      interaction.application_id,
      interaction.token,
      `Select a branch for **${owner}/${repo}**:`,
      [
        {
          type: 3,
          custom_id: "project:branch",
          options: branchOptions,
        },
      ],
    )

    return json({ type: 4 })
  }

  if (customId === "project:branch") {
    const parts = selectedValue.split(":")
    if (parts.length !== 3) {
      return json({ type: 4, data: { content: "Invalid branch selection." } })
    }
    const [owner, repo, branch] = parts
    const repoUrl = `https://github.com/${owner}/${repo}`
    const projectName = repo

    const stateStore = new ChannelStateStore()
    stateStore.setProject(interaction.channel_id || "dm", repoUrl, branch, projectName)

    await sendInitialResponse(
      interaction.application_id,
      interaction.token,
      `✅ Project set to **${projectName}**\n${repoUrl}\nBranch: ${branch}`,
    )

    return json({ type: 4 })
  }

  return json({ type: 4, data: { content: "Unknown project selection." } })
}

async function handleAuthConnect(interaction: Interaction, text: string): Promise<Response> {
  const channelId = interaction.channel_id
  if (!channelId) {
    return json({ type: 4, data: { content: "This command must be used in a channel." } })
  }

  const stateStore = new ChannelStateStore()
  const state = stateStore.get(channelId)

  const parts = text.replace(/^auth-connect\s*/i, "").replace(/^auth connect\s*/i, "").trim()
  const providerId = parts.split(" ")[0]

  if (!providerId) {
    return json({
      type: 4,
      data: {
        content: "Usage: `/auth-connect <provider>`\nExample: `/auth-connect chatgpt`",
      },
    })
  }

  const sandboxManager = getSandboxManager()

  if (state.pendingOAuth?.providerId === providerId && state.pendingOAuth?.deviceAuthId) {
    try {
      const completeResult: OAuthCompleteResult = await sandboxManager.completeOAuth(
        channelId,
        providerId,
        0,
        state.pendingOAuth.deviceAuthId,
      )

      if (completeResult.success && completeResult.tokens) {
        state.pendingOAuth = undefined
        stateStore.set(state)

        return json({
          type: 4,
          data: {
            content: `✅ Successfully connected to **${providerId}**!\n\nYou can now use this provider with \`/use-provider ${providerId}\``,
          },
        })
      }

      return json({
        type: 4,
        data: {
          content: completeResult.message || "OAuth not complete yet. Please try again in a moment.",
        },
      })
    } catch (error) {
      return json({
        type: 4,
        data: {
          content: `OAuth complete error: ${error instanceof Error ? error.message : "Unknown error"}`,
        },
      })
    }
  }

  try {
    const oauthResult: OAuthStartResult = await sandboxManager.startOAuth(channelId, providerId)

    if (oauthResult.success === false || !oauthResult.url) {
      return json({
        type: 4,
        data: {
          content: oauthResult.message || `Failed to start OAuth for '${providerId}'. Check the provider name.`,
        },
      })
    }

    if (oauthResult.deviceAuthId) {
      state.pendingOAuth = {
        providerId,
        deviceAuthId: oauthResult.deviceAuthId,
        timestamp: Date.now(),
      }
      stateStore.set(state)
    }

    const message = [
      `**OAuth for ${providerId}**`,
      "",
      oauthResult.instructions || "Please complete authentication:",
      "",
      `🔗 **URL**: ${oauthResult.url}`,
      oauthResult.userCode ? `🔢 **Code**: \`${oauthResult.userCode}\`` : "",
      "",
      "Once complete, run `/auth-connect " + providerId + "` again to complete the connection.",
    ].filter(Boolean).join("\n")

    return json({ type: 4, data: { content: message } })
  } catch (error) {
    return json({
      type: 4,
      data: {
        content: `OAuth error: ${error instanceof Error ? error.message : "Unknown error"}`,
      },
    })
  }
}

async function handleProjectCommand(interaction: Interaction): Promise<Response> {
  const gh = getGitHubClient()
  if (!gh) {
    return json({
      type: 4,
      data: {
        content: "GitHub is not configured. Set GITHUB_TOKEN to use project selection.",
      },
    })
  }

  try {
    const repos = await gh.listRepos()
    if (repos.length === 0) {
      return json({ type: 4, data: { content: "No repositories found for your account." } })
    }

    const repoOptions = repos.map((r) => ({
      label: r.name,
      value: `${r.fullName.split("/")[0]}:${r.name}`,
      description: r.defaultBranch,
    }))

    return json({
      type: 4,
      data: {
        content: "Select a repository:",
        components: [
          {
            type: 3,
            custom_id: "project:repo",
            options: repoOptions,
            placeholder: "Choose a repository",
          },
        ],
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error"
    return json({ type: 4, data: { content: `Failed to fetch repositories: ${message}` } })
  }
}

async function processAskInteraction(interaction: Interaction, prompt: string): Promise<void> {
  const channelId = interaction.channel_id

  if (!channelId) {
    await sendFollowup(
      interaction.application_id,
      interaction.token,
      "Missing channel ID.",
    )
    return
  }

  const stateStore = new ChannelStateStore()
  const state = stateStore.get(channelId)

  let repoUrl: string | undefined
  let branch = "main"
  if (state.repoUrl) {
    repoUrl = state.repoUrl
    branch = state.branch || "main"
  }

  const sandboxManager = getSandboxManager()
  let sandboxContext: SandboxContext

  try {
    sandboxContext = await sandboxManager.getOrCreate(channelId, state.sandboxId, repoUrl, branch)
  } catch (error) {
    console.error("Failed to get/create sandbox:", error)
    await sendFollowup(
      interaction.application_id,
      interaction.token,
      `Failed to create sandbox: ${error instanceof Error ? error.message : "Unknown error"}`,
    )
    return
  }

  // Update state with sandbox ID for future resumption
  state.sandboxId = sandboxContext.sandboxId
  stateStore.set(state)

  const runtime = new OpencodeRuntime(sandboxContext.opencodeBaseUrl, sandboxContext.opencodePassword)
  const credentials = new CredentialStore()
  const registry = loadProviderRegistryFromEnv()

  let responseBuffer = ""
  let toolEvents = 0

  const result = await executePromptForChannel(
    runtime,
    registry,
    credentials,
    stateStore,
    channelId,
    prompt,
    {
      onTextDelta: async (text) => {
        responseBuffer += text
      },
      onToolActivity: async (toolMessage: string) => {
        await sendFollowup(interaction.application_id, interaction.token, `> ${toolMessage}`)
      },
      onToolRequest: async (payload) => {
        toolEvents += 1
        const requestData = payload.requestSummary || ""
        const resultData = ""
        await sendFollowup(
          interaction.application_id,
          interaction.token,
          `> ⏳ Tool: ${payload.toolName}`,
          buildToolButtons(payload.toolName, requestData, resultData),
        )
      },
      onToolResult: async (payload) => {
        const requestData = ""
        const resultData = payload.resultSummary || ""
        await sendFollowup(
          interaction.application_id,
          interaction.token,
          `> ✅ Tool: ${payload.toolName}`,
          buildToolButtons(payload.toolName, requestData, resultData),
        )
      },
      onQuestion: async (questionMessage: string) => {
        await sendFollowup(interaction.application_id, interaction.token, `> ${questionMessage}`)
      },
      onPermission: async (permissionMessage: string) => {
        await sendFollowup(interaction.application_id, interaction.token, `> ${permissionMessage}`)
      },
      onError: async (errorMessage: string) => {
        await sendFollowup(interaction.application_id, interaction.token, `> Error: ${errorMessage}`)
      },
    },
  )

  if (!result.ok) {
    await sendFollowup(interaction.application_id, interaction.token, result.message)
    return
  }

  const text = responseBuffer.trim()
  if (result.hadError) {
    const helpMsg = "\n\nTo switch models, use `/use-provider` and `/use-model`"
    if (text) {
      const clipped = text.length > 1750 ? `${text.slice(0, 1749)}...${helpMsg}` : text + helpMsg
      await sendFollowup(interaction.application_id, interaction.token, clipped)
    } else {
      await sendFollowup(interaction.application_id, interaction.token, `Error occurred.${helpMsg}`)
    }
  } else if (text) {
    const clipped = text.length > 1800 ? `${text.slice(0, 1799)}...` : text
    await sendFollowup(interaction.application_id, interaction.token, clipped)
  } else {
    const suffix = toolEvents > 0 ? ` (${toolEvents} tool${toolEvents > 1 ? "s" : ""})` : ""
    await sendFollowup(interaction.application_id, interaction.token, `Done${suffix}.`)
  }
}

export default async function handler(request: Request): Promise<Response> {
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, 405)
  }

  const publicKey = process.env.DISCORD_PUBLIC_KEY
  if (!publicKey) {
    return json({ error: "DISCORD_PUBLIC_KEY not set" }, 500)
  }

  const signature = request.headers.get("x-signature-ed25519") || ""
  const timestamp = request.headers.get("x-signature-timestamp") || ""
  const body = await request.text()

  if (!verifyDiscordRequest(body, signature, timestamp, publicKey)) {
    return json({ error: "Invalid request signature" }, 401)
  }

  const interaction = JSON.parse(body) as Interaction

  if (interaction.type === 1) {
    return json({ type: 1 })
  }

  if (interaction.type === 3) {
    if (interaction.data?.custom_id?.startsWith("tool:")) {
      return handleToolButtonInteraction(interaction)
    }
    if (interaction.data?.custom_id?.startsWith("project:")) {
      return handleProjectSelectMenu(interaction)
    }
    return json({ type: 4, data: { content: "Unknown interaction." } })
  }

  if (interaction.type !== 2 || !interaction.data) {
    return json({ type: 4, data: { content: "Unsupported interaction type." } })
  }

  const mapped = mapInteractionCommandToText(interaction.data)

  if (mapped.type === "prompt") {
    waitUntil(processAskInteraction(interaction, mapped.text))
    return json({ type: 5 })
  }

  if (mapped.text === "project" || mapped.text === "project show" || mapped.text === "project select") {
    return handleProjectCommand(interaction)
  }

  if (mapped.text.startsWith("auth-connect") || mapped.text.startsWith("auth connect")) {
    return handleAuthConnect(interaction, mapped.text)
  }

  const registry = loadProviderRegistryFromEnv()
  const stateStore = new ChannelStateStore()
  const credentials = new CredentialStore()

  const commandResult = handleDiscordCommand(
    mapped.text,
    { channelId: interaction.channel_id || "dm" },
    stateStore,
    registry,
    credentials,
  )

  const content = commandResult.message || "Done."
  return json({ type: 4, data: { content } })
}