import nacl from "tweetnacl"
import { waitUntil } from "@vercel/functions"

type SandboxContext = {
  sandboxId: string
  opencodeBaseUrl: string
  opencodePassword: string
}

type OAuthStartResult = {
  success?: boolean
  message?: string
  url?: string
  userCode?: string
  instructions?: string
  deviceAuthId?: string
}

type OAuthCompleteResult = {
  success: boolean
  message?: string
  tokens?: Record<string, unknown>
}

type Interaction = {
  id: string
  type: number
  token: string
  application_id: string
  channel_id?: string
  member?: {
    user?: {
      id: string
    }
  }
  user?: {
    id: string
  }
  message?: {
    id: string
  }
  data: {
    custom_id?: string
    name: string
    values?: string[]
    options?: Array<{
      name: string
      type: number
      value?: string | number | boolean
      focused?: boolean
      options?: Array<{ name: string; type: number; value?: string | number | boolean; focused?: boolean }>
    }>
  }
}

const DISCORD_MESSAGE_LIMIT = 1800
const DISCORD_AUTOCOMPLETE_LIMIT = 25
const PROVIDERS_PER_PAGE = 12
const MODELS_PER_PAGE = 20

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

async function readNodeRequestBody(req: {
  rawBody?: Buffer | string
  body?: unknown
  on(event: "data", listener: (chunk: Buffer | string) => void): void
  on(event: "end", listener: () => void): void
  on(event: "error", listener: (error: Error) => void): void
}): Promise<Buffer> {
  if (typeof req.rawBody === "string") {
    return Buffer.from(req.rawBody)
  }
  if (Buffer.isBuffer(req.rawBody)) {
    return req.rawBody
  }
  if (typeof req.body === "string") {
    return Buffer.from(req.body)
  }
  if (Buffer.isBuffer(req.body)) {
    return req.body
  }

  const chunks: Buffer[] = []
  return await new Promise((resolve, reject) => {
    req.on("data", (chunk) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    })
    req.on("end", () => resolve(Buffer.concat(chunks)))
    req.on("error", reject)
  })
}

async function sendNodeResponse(
  res: {
    statusCode: number
    setHeader(name: string, value: string): void
    end(body?: string): void
  },
  response: Response,
): Promise<void> {
  res.statusCode = response.status
  response.headers.forEach((value, key) => res.setHeader(key, value))
  res.end(await response.text())
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
  threadId?: string,
): Promise<void> {
  const body: Record<string, unknown> = { content, components }
  if (threadId) {
    body.thread_id = threadId
  }
  await fetch(`https://discord.com/api/v10/webhooks/${applicationId}/${token}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

function splitDiscordMessage(content: string, limit = DISCORD_MESSAGE_LIMIT): string[] {
  if (content.length <= limit) {
    return [content]
  }

  const chunks: string[] = []
  let remaining = content

  while (remaining.length > limit) {
    let splitAt = remaining.lastIndexOf("\n", limit)
    if (splitAt <= 0) {
      splitAt = limit
    }
    chunks.push(remaining.slice(0, splitAt))
    remaining = remaining.slice(splitAt).replace(/^\n+/, "")
  }

  if (remaining) {
    chunks.push(remaining)
  }

  return chunks
}

async function sendChunkedInteractionResponse(interaction: Interaction, res: { statusCode: number; setHeader(name: string, value: string): void; end(body?: string): void }, content: string): Promise<void> {
  const chunks = splitDiscordMessage(content)
  await sendNodeResponse(res, json({ type: 4, data: { content: chunks[0] || "Done." } }))

  if (chunks.length > 1) {
    waitUntil((async () => {
      for (const chunk of chunks.slice(1)) {
        await sendFollowup(interaction.application_id, interaction.token, chunk)
      }
    })())
  }
}

function getInteractionUserId(interaction: Interaction): string | undefined {
  return interaction.member?.user?.id || interaction.user?.id
}

async function isThreadChannel(channelId: string): Promise<boolean> {
  const token = process.env.DISCORD_BOT_TOKEN
  if (!token) {
    return false
  }

  const response = await fetch(`https://discord.com/api/v10/channels/${channelId}`, {
    headers: { Authorization: `Bot ${token}` },
  }).catch(() => null)

  if (!response?.ok) {
    return false
  }

  const data = (await response.json()) as { type?: number }
  return data.type === 11 || data.type === 12
}

function getCommandOption(
  options: Interaction["data"]["options"] | undefined,
  name: string,
): { name: string; type: number; value?: string | number | boolean; focused?: boolean; options?: Array<{ name: string; type: number; value?: string | number | boolean; focused?: boolean }> } | undefined {
  return options?.find((option) => option.name === name)
}

function getFocusedOption(data: Interaction["data"]): { name: string; value: string } | undefined {
  for (const option of data.options || []) {
    if (option.focused) {
      return { name: option.name, value: String(option.value || "") }
    }
    for (const nested of option.options || []) {
      if (nested.focused) {
        return { name: nested.name, value: String(nested.value || "") }
      }
    }
  }
  return undefined
}

function autocompleteChoices(values: Array<{ name: string; value: string }>): Response {
  return json({ type: 8, data: { choices: values.slice(0, DISCORD_AUTOCOMPLETE_LIMIT) } })
}

function encodePageId(kind: "providers" | "models", page: number, providerId?: string): string {
  if (kind === "models" && providerId) {
    return `page:${kind}:${providerId}:${page}`
  }
  return `page:${kind}:${page}`
}

function decodePageId(customId: string): { kind: "providers" | "models"; page: number; providerId?: string } | null {
  const parts = customId.split(":")
  if (parts[0] !== "page") {
    return null
  }
  if (parts[1] === "providers" && parts.length === 3) {
    return { kind: "providers", page: Number(parts[2] || 0) }
  }
  if (parts[1] === "models" && parts.length === 4) {
    return { kind: "models", providerId: parts[2], page: Number(parts[3] || 0) }
  }
  return null
}

function buildPaginationComponents(kind: "providers" | "models", page: number, totalPages: number, providerId?: string): unknown[] | undefined {
  if (totalPages <= 1) {
    return undefined
  }

  return [
    {
      type: 1,
      components: [
        {
          type: 2,
          custom_id: encodePageId(kind, page - 1, providerId),
          label: "Prev",
          style: 2,
          disabled: page <= 0,
        },
        {
          type: 2,
          custom_id: encodePageId(kind, page + 1, providerId),
          label: "Next",
          style: 2,
          disabled: page >= totalPages - 1,
        },
      ],
    },
  ]
}

function renderProvidersPage(
  registry: { toStatusView(configuredProviders: string[]): Array<{ id: string; methods: Array<{ label: string }>; isConfigured: boolean }> },
  configuredProviders: string[],
  page: number,
): { content: string; components?: unknown[] } {
  const providers = registry.toStatusView(configuredProviders)
  if (providers.length === 0) {
    return { content: "No providers available yet." }
  }

  const totalPages = Math.max(1, Math.ceil(providers.length / PROVIDERS_PER_PAGE))
  const safePage = Math.min(Math.max(page, 0), totalPages - 1)
  const start = safePage * PROVIDERS_PER_PAGE
  const items = providers.slice(start, start + PROVIDERS_PER_PAGE)
  const lines = items.map((provider) => {
    const methods = provider.methods.map((method) => method.label).join(", ") || "none"
    const status = provider.isConfigured ? "configured" : "not configured"
    return `- ${provider.id} (${status}) [${methods}]`
  })

  return {
    content: [`Available providers (${safePage + 1}/${totalPages}):`, ...lines].join("\n"),
    components: buildPaginationComponents("providers", safePage, totalPages),
  }
}

function renderModelsPage(
  registry: { getModels(providerId: string): Array<{ id: string; label?: string }> },
  providerId: string,
  page: number,
): { content: string; components?: unknown[] } {
  const models = registry.getModels(providerId)
  if (models.length === 0) {
    return { content: `No models found for provider '${providerId}'.` }
  }

  const totalPages = Math.max(1, Math.ceil(models.length / MODELS_PER_PAGE))
  const safePage = Math.min(Math.max(page, 0), totalPages - 1)
  const start = safePage * MODELS_PER_PAGE
  const items = models.slice(start, start + MODELS_PER_PAGE)
  const lines = items.map((model) => `- ${model.id}${model.label ? ` (${model.label})` : ""}`)

  return {
    content: [`Models for ${providerId} (${safePage + 1}/${totalPages}):`, ...lines].join("\n"),
    components: buildPaginationComponents("models", safePage, totalPages, providerId),
  }
}

async function handleAutocompleteInteraction(interaction: Interaction): Promise<Response> {
  const [{ loadProviderRegistry }, { SelectionStore }] = await Promise.all([
    import("../../src/provider-registry-store.js"),
    import("../../src/selection-store.js"),
  ])

  const registry = await loadProviderRegistry()
  const selectionStore = new SelectionStore()
  const focused = getFocusedOption(interaction.data)
  if (!focused) {
    return autocompleteChoices([])
  }

  const query = focused.value.toLowerCase()
  const startsWith = (value: string): boolean => value.toLowerCase().includes(query)

  if (focused.name === "provider") {
    const choices = registry.listProviders()
      .filter((provider) => !query || startsWith(provider.id))
      .slice(0, DISCORD_AUTOCOMPLETE_LIMIT)
      .map((provider) => ({ name: provider.id, value: provider.id }))
    return autocompleteChoices(choices)
  }

  if (focused.name === "model") {
    const userId = getInteractionUserId(interaction)
    const threadId = interaction.channel_id && await isThreadChannel(interaction.channel_id) ? interaction.channel_id : undefined
    const selection = userId ? await selectionStore.resolveSelection(userId, threadId) : undefined
    const providerOption = getCommandOption(interaction.data.options, "provider")
    const providerId = typeof providerOption?.value === "string" ? providerOption.value : selection?.providerId
    if (!providerId) {
      return autocompleteChoices([])
    }

    const choices = registry.getModels(providerId)
      .filter((model) => !query || startsWith(model.id) || startsWith(model.label || ""))
      .slice(0, DISCORD_AUTOCOMPLETE_LIMIT)
      .map((model) => ({
        name: (model.label ? `${model.id} (${model.label})` : model.id).slice(0, 100),
        value: model.id,
      }))
    return autocompleteChoices(choices)
  }

  return autocompleteChoices([])
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

async function handlePageButtonInteraction(interaction: Interaction): Promise<Response> {
  const [{ loadProviderRegistry }, { CredentialStore }] = await Promise.all([
    import("../../src/provider-registry-store.js"),
    import("../../src/credential-store.js"),
  ])

  const customId = interaction.data?.custom_id
  if (!customId) {
    return json({ type: 4, data: { content: "Missing page data." } })
  }

  const pageData = decodePageId(customId)
  if (!pageData) {
    return json({ type: 4, data: { content: "Invalid page data." } })
  }

  const registry = await loadProviderRegistry()

  if (pageData.kind === "providers") {
    const credentials = new CredentialStore()
    const page = renderProvidersPage(registry, credentials.listProviders(), pageData.page)
    return json({ type: 7, data: { content: page.content, components: page.components } })
  }

  if (!pageData.providerId) {
    return json({ type: 4, data: { content: "Missing provider for models page." } })
  }

  const page = renderModelsPage(registry, pageData.providerId, pageData.page)
  return json({ type: 7, data: { content: page.content, components: page.components } })
}

async function handleProjectSelectMenu(interaction: Interaction): Promise<Response> {
  const [{ getGitHubClient }, { ChannelStateStore }] = await Promise.all([
    import("../../src/github-client.js"),
    import("../../src/channel-state-store.js"),
  ])
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
  const [{ getSandboxManager }, { ChannelStateStore }] = await Promise.all([
    import("../../src/sandbox-manager.js"),
    import("../../src/channel-state-store.js"),
  ])
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
  const { getGitHubClient } = await import("../../src/github-client.js")
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
  const [
    { ChannelStateStore },
    { CredentialStore },
    { OpencodeRuntime },
    { executePromptForChannel },
    { getSandboxManager },
    { getRecoveryContext },
    { loadProviderRegistry },
    { SelectionStore },
  ] = await Promise.all([
    import("../../src/channel-state-store.js"),
    import("../../src/credential-store.js"),
    import("../../src/opencode-runtime.js"),
    import("../../src/prompt-orchestrator.js"),
    import("../../src/sandbox-manager.js"),
    import("../../src/discord-message-fetcher.js"),
    import("../../src/provider-registry-store.js"),
    import("../../src/selection-store.js"),
  ])

  const channelId = interaction.channel_id
  const messageId = interaction.message?.id
  const userId = getInteractionUserId(interaction)

  if (!channelId || !userId) {
    await sendFollowup(
      interaction.application_id,
      interaction.token,
      !channelId ? "Missing channel ID." : "Missing user ID.",
    )
    return
  }

  const stateStore = new ChannelStateStore()
  const selectionStore = new SelectionStore()
  const channelState = stateStore.get(channelId)
  const commandIsInThread = await isThreadChannel(channelId)

  // Create or reuse thread for this conversation
  let threadId = commandIsInThread ? channelId : channelState.threadId

  if (!threadId && messageId) {
    // Create a new thread from the command message
    const threadName = `OpenCode: ${prompt.slice(0, 50)}${prompt.length > 50 ? "..." : ""}`
    const threadResponse = await fetch(
      `https://discord.com/api/v10/channels/${channelId}/messages/${messageId}/threads`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}`,
        },
        body: JSON.stringify({
          name: threadName,
          auto_archive_duration: 1440, // 24 hours
        }),
      },
    ).catch(() => null)

    if (threadResponse?.ok) {
      const thread = (await threadResponse.json()) as { id: string }
      threadId = thread.id
      channelState.threadId = threadId
      stateStore.set(channelState)
      stateStore.set({
        channelId: threadId,
        repoUrl: channelState.repoUrl,
        branch: channelState.branch,
        projectName: channelState.projectName,
        sessionByProfile: {},
      })
    }
  }

  // If no thread and no message ID, we'll use channel-level followups
  const effectiveThreadId = threadId || undefined
  const conversationId = effectiveThreadId || channelId
  const conversationState = stateStore.get(conversationId)

  const selection = await selectionStore.resolveSelection(userId, effectiveThreadId)
  if (!selection?.providerId || !selection?.modelId) {
    await sendFollowup(
      interaction.application_id,
      interaction.token,
      "No default provider/model configured. Run `/use-provider <provider>` and `/use-model <model>` in any normal channel first.",
      undefined,
      effectiveThreadId,
    )
    return
  }

  let repoUrl: string | undefined
  let branch = "main"
  if (conversationState.repoUrl || channelState.repoUrl) {
    repoUrl = conversationState.repoUrl || channelState.repoUrl
    branch = conversationState.branch || channelState.branch || "main"
  }

  const sandboxManager = getSandboxManager()
  let sandboxContext: SandboxContext
  const oldSandboxId = conversationState.sandboxId

  try {
    sandboxContext = await sandboxManager.getOrCreate(conversationId, conversationState.sandboxId, repoUrl, branch)
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
  conversationState.sandboxId = sandboxContext.sandboxId
  stateStore.set(conversationState)

  const runtime = new OpencodeRuntime(sandboxContext.opencodeBaseUrl, sandboxContext.opencodePassword)
  const credentials = new CredentialStore()
  const registry = await loadProviderRegistry()

  // Check if sandbox was newly created (old one expired) - fetch recovery context
  const isNewSandbox = oldSandboxId && oldSandboxId !== sandboxContext.sandboxId

  // Warn user about lost local changes if sandbox expired
  if (isNewSandbox && repoUrl) {
    await sendFollowup(
      interaction.application_id,
      interaction.token,
      "⚠️ **Sandbox expired** - A new session was started. Your repository was cloned fresh from GitHub.\n\n> **Note:** Any uncommitted local changes in the previous session have been lost. Remember to commit and push your work before the sandbox expires!",
      undefined,
      effectiveThreadId,
    )
  }

  const recoveryContext = isNewSandbox
    ? await getRecoveryContext(stateStore, conversationId, prompt)
    : undefined

  let responseBuffer = ""
  let toolEvents = 0
  const threadIdForFollowups = effectiveThreadId

  const result = await executePromptForChannel(
    runtime,
    registry,
    credentials,
    stateStore,
    conversationId,
    {
      providerId: selection.providerId,
      modelId: selection.modelId,
    },
    prompt,
    {
      onTextDelta: async (text) => {
        responseBuffer += text
      },
      onToolActivity: async (toolMessage: string) => {
        await sendFollowup(interaction.application_id, interaction.token, `> ${toolMessage}`, undefined, threadIdForFollowups)
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
          threadIdForFollowups,
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
          threadIdForFollowups,
        )
      },
      onQuestion: async (questionMessage: string) => {
        await sendFollowup(interaction.application_id, interaction.token, `> ${questionMessage}`, undefined, threadIdForFollowups)
      },
      onPermission: async (permissionMessage: string) => {
        await sendFollowup(interaction.application_id, interaction.token, `> ${permissionMessage}`, undefined, threadIdForFollowups)
      },
      onError: async (errorMessage: string) => {
        await sendFollowup(interaction.application_id, interaction.token, `> Error: ${errorMessage}`, undefined, threadIdForFollowups)
      },
    },
    {
      recoveryContext: recoveryContext || undefined,
    },
  )

  if (!result.ok) {
    await sendFollowup(interaction.application_id, interaction.token, result.message, undefined, threadIdForFollowups)
    return
  }

  const text = responseBuffer.trim()
  if (result.hadError) {
    const helpMsg = "\n\nTo switch models, use `/use-provider` and `/use-model`"
    if (text) {
      const clipped = text.length > 1750 ? `${text.slice(0, 1749)}...${helpMsg}` : text + helpMsg
      await sendFollowup(interaction.application_id, interaction.token, clipped, undefined, threadIdForFollowups)
    } else {
      await sendFollowup(interaction.application_id, interaction.token, `Error occurred.${helpMsg}`, undefined, threadIdForFollowups)
    }
  } else if (text) {
    const clipped = text.length > 1800 ? `${text.slice(0, 1799)}...` : text
    await sendFollowup(interaction.application_id, interaction.token, clipped, undefined, threadIdForFollowups)
  } else {
    const suffix = toolEvents > 0 ? ` (${toolEvents} tool${toolEvents > 1 ? "s" : ""})` : ""
    await sendFollowup(interaction.application_id, interaction.token, `Done${suffix}.`, undefined, threadIdForFollowups)
  }
}

export default async function handler(
  req: {
    method?: string
    url?: string
    rawBody?: Buffer | string
    body?: unknown
    headers: Record<string, string | string[] | undefined>
    on(event: "data", listener: (chunk: Buffer | string) => void): void
    on(event: "end", listener: () => void): void
    on(event: "error", listener: (error: Error) => void): void
  },
  res: {
    statusCode: number
    setHeader(name: string, value: string): void
    end(body?: string): void
  },
): Promise<void> {
  try {
    if (req.method !== "POST") {
      await sendNodeResponse(res, json({ error: "Method not allowed" }, 405))
      return
    }

    const publicKey = process.env.DISCORD_PUBLIC_KEY
    if (!publicKey) {
      await sendNodeResponse(res, json({ error: "DISCORD_PUBLIC_KEY not set" }, 500))
      return
    }

    const rawBody = await readNodeRequestBody(req)
    const body = rawBody.toString("utf-8")
    const signatureHeader = req.headers["x-signature-ed25519"]
    const timestampHeader = req.headers["x-signature-timestamp"]
    const signature = Array.isArray(signatureHeader) ? signatureHeader[0] || "" : signatureHeader || ""
    const timestamp = Array.isArray(timestampHeader) ? timestampHeader[0] || "" : timestampHeader || ""

    if (!verifyDiscordRequest(body, signature, timestamp, publicKey)) {
      await sendNodeResponse(res, json({ error: "Invalid request signature" }, 401))
      return
    }

    const interaction = JSON.parse(body) as Interaction

    if (interaction.type === 1) {
      await sendNodeResponse(res, json({ type: 1 }))
      return
    }

    if (interaction.type === 3) {
      if (interaction.data?.custom_id?.startsWith("tool:")) {
        await sendNodeResponse(res, await handleToolButtonInteraction(interaction))
        return
      }
      if (interaction.data?.custom_id?.startsWith("page:")) {
        await sendNodeResponse(res, await handlePageButtonInteraction(interaction))
        return
      }
      if (interaction.data?.custom_id?.startsWith("project:")) {
        await sendNodeResponse(res, await handleProjectSelectMenu(interaction))
        return
      }
      await sendNodeResponse(res, json({ type: 4, data: { content: "Unknown interaction." } }))
      return
    }

    if (interaction.type === 4) {
      await sendNodeResponse(res, await handleAutocompleteInteraction(interaction))
      return
    }

    if (interaction.type !== 2 || !interaction.data) {
      await sendNodeResponse(res, json({ type: 4, data: { content: "Unsupported interaction type." } }))
      return
    }

    const [{ mapInteractionCommandToText }, { parseDiscordCommand }, { ChannelStateStore }, { CredentialStore }, { handleDiscordCommand }, { SelectionStore }] = await Promise.all([
      import("../../src/interaction-command-mapper.js"),
      import("../../src/command-parser.js"),
      import("../../src/channel-state-store.js"),
      import("../../src/credential-store.js"),
      import("../../src/discord-command-service.js"),
      import("../../src/selection-store.js"),
    ])

    const mapped = mapInteractionCommandToText(interaction.data)

    if (mapped.type === "prompt") {
      waitUntil(processAskInteraction(interaction, mapped.text))
      await sendNodeResponse(res, json({ type: 5 }))
      return
    }

    if (mapped.text === "project" || mapped.text === "project show" || mapped.text === "project select") {
      await sendNodeResponse(res, await handleProjectCommand(interaction))
      return
    }

    if (mapped.text.startsWith("auth-connect") || mapped.text.startsWith("auth connect")) {
      await sendNodeResponse(res, await handleAuthConnect(interaction, mapped.text))
      return
    }

    if (mapped.text === "update") {
      const { refreshProviderRegistry } = await import("../../src/provider-registry-store.js")

      const result = await refreshProviderRegistry()
      await sendChunkedInteractionResponse(
        interaction,
        res,
        `${result.created ? "Created" : "Updated"} provider registry.\n` +
          `Providers: ${result.providerCount}\n` +
          `Models: ${result.modelCount}\n` +
          `Registry blob: ${result.blobUrl}`,
      )
      return
    }

    const { loadProviderRegistry } = await import("../../src/provider-registry-store.js")
    const registry = await loadProviderRegistry()
    const stateStore = new ChannelStateStore()
    const credentials = new CredentialStore()
    const selectionStore = new SelectionStore()
    const parsed = parseDiscordCommand(mapped.text)
    const userId = getInteractionUserId(interaction)
    const currentChannelId = interaction.channel_id || "dm"
    const inThread = interaction.channel_id ? await isThreadChannel(interaction.channel_id) : false

    if (parsed.type === "providers") {
      const page = renderProvidersPage(registry, credentials.listProviders(), 0)
      await sendNodeResponse(res, json({ type: 4, data: { content: page.content, components: page.components } }))
      return
    }

    if (parsed.type === "models") {
      const selection = userId ? await selectionStore.resolveSelection(userId, inThread ? currentChannelId : undefined) : undefined
      const providerId = parsed.providerId || selection?.providerId
      if (!providerId) {
        await sendChunkedInteractionResponse(interaction, res, "No active provider. Run: /models <provider> or /use-provider <provider>")
        return
      }

      const page = renderModelsPage(registry, providerId, 0)
      await sendNodeResponse(res, json({ type: 4, data: { content: page.content, components: page.components } }))
      return
    }

    if (parsed.type === "use_provider") {
      if (!userId) {
        await sendChunkedInteractionResponse(interaction, res, "Missing user ID.")
        return
      }
      if (!registry.hasProvider(parsed.providerId)) {
        await sendChunkedInteractionResponse(interaction, res, `Unknown provider '${parsed.providerId}'. Run: /providers`)
        return
      }

      const userDefaults = await selectionStore.getUserDefaults(userId)
      if (inThread && (!userDefaults?.providerId || !userDefaults?.modelId)) {
        await sendChunkedInteractionResponse(
          interaction,
          res,
          "No default provider/model configured. Run `/use-provider <provider>` and `/use-model <model>` in any normal channel first.",
        )
        return
      }

      const existing = inThread
        ? await selectionStore.initializeThreadFromUser(currentChannelId, userId)
        : userDefaults

      const nextSelection = {
        providerId: parsed.providerId,
        modelId: existing?.modelId && registry.hasModel(parsed.providerId, existing.modelId) ? existing.modelId : undefined,
      }

      if (inThread) {
        await selectionStore.setThreadSelection(currentChannelId, nextSelection)
        await sendChunkedInteractionResponse(interaction, res, `Thread provider set to '${parsed.providerId}'. Run: /models`) 
        return
      }

      await selectionStore.setUserDefaults(userId, nextSelection)
      await sendChunkedInteractionResponse(interaction, res, `Default provider set to '${parsed.providerId}'. Run: /models`) 
      return
    }

    if (parsed.type === "use_model") {
      if (!userId) {
        await sendChunkedInteractionResponse(interaction, res, "Missing user ID.")
        return
      }

      const userDefaults = await selectionStore.getUserDefaults(userId)
      if (inThread && (!userDefaults?.providerId || !userDefaults?.modelId)) {
        await sendChunkedInteractionResponse(
          interaction,
          res,
          "No default provider/model configured. Run `/use-provider <provider>` and `/use-model <model>` in any normal channel first.",
        )
        return
      }

      const selection = inThread
        ? await selectionStore.initializeThreadFromUser(currentChannelId, userId)
        : userDefaults

      if (!selection?.providerId) {
        await sendChunkedInteractionResponse(
          interaction,
          res,
          inThread
            ? "No provider configured for this thread. Run: /use-provider <provider> in this thread first."
            : "No default provider configured. Run: /use-provider <provider> first.",
        )
        return
      }

      if (!registry.hasModel(selection.providerId, parsed.modelId)) {
        const matchingProviders = registry.findProvidersForModel(parsed.modelId)
        const message = matchingProviders.length > 0
          ? `Model '${parsed.modelId}' does not belong to provider '${selection.providerId}'. It is available under: ${matchingProviders.join(", ")}. Run: /use-provider <provider> first.`
          : `Unknown model '${parsed.modelId}' for provider '${selection.providerId}'. Run: /models ${selection.providerId}`
        await sendChunkedInteractionResponse(interaction, res, message)
        return
      }

      const nextSelection = { providerId: selection.providerId, modelId: parsed.modelId }
      if (inThread) {
        await selectionStore.setThreadSelection(currentChannelId, nextSelection)
        await sendChunkedInteractionResponse(interaction, res, `Thread model set to '${parsed.modelId}'.`)
        return
      }

      await selectionStore.setUserDefaults(userId, nextSelection)
      await sendChunkedInteractionResponse(interaction, res, `Default model set to '${parsed.modelId}'.`)
      return
    }

    const commandResult = handleDiscordCommand(
      mapped.text,
      { channelId: currentChannelId },
      stateStore,
      registry,
      credentials,
    )

    await sendChunkedInteractionResponse(interaction, res, commandResult.message || "Done.")
  } catch (error) {
    console.error("Discord interaction handler failed:", error)
    await sendNodeResponse(
      res,
      json({
        type: 4,
        data: {
          content: `Handler error: ${error instanceof Error ? error.message : "Unknown error"}`,
        },
      }),
    )
  }
}
