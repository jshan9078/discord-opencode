import { createHmac } from "crypto"
import nacl from "tweetnacl"
import { waitUntil } from "@vercel/functions"
import { Sandbox } from "@vercel/sandbox"
import { sendDiscordRateLimitedRequest } from "../../src/discord-rate-limited-fetch.js"

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
  sandboxId?: string
  opencodePassword?: string
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

function logAskStage(stage: string, details: Record<string, unknown>): void {
  console.info("ask.stage", { stage, ...details })
}

function repoUrlToWorkspaceCwd(repoUrl: string | undefined): string | undefined {
  return repoUrl ? "/vercel/sandbox" : undefined
}

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

function getInternalDispatchSecret(): string | undefined {
  return process.env.DISCORD_BOT_TOKEN || process.env.BLOB_READ_WRITE_TOKEN || undefined
}

function signInternalDispatch(body: string, timestamp: string): string | undefined {
  const secret = getInternalDispatchSecret()
  if (!secret) {
    return undefined
  }
  return createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex")
}

function verifyInternalDispatch(body: string, timestamp: string, signature: string): boolean {
  const expected = signInternalDispatch(body, timestamp)
  return Boolean(expected && signature && expected === signature)
}

function getRequestOrigin(req: { url?: string; headers: Record<string, string | string[] | undefined> }): string | undefined {
  if (req.url) {
    try {
      return new URL(req.url).origin
    } catch {
      // Fall through to header-based reconstruction.
    }
  }

  const protoHeader = req.headers["x-forwarded-proto"]
  const hostHeader = req.headers["x-forwarded-host"] || req.headers.host
  const proto = Array.isArray(protoHeader) ? protoHeader[0] : protoHeader
  const host = Array.isArray(hostHeader) ? hostHeader[0] : hostHeader
  if (proto && host) {
    return `${proto}://${host}`
  }
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`
  }
  return undefined
}

async function sendFollowup(
  applicationId: string,
  token: string,
  content: string,
  components?: unknown[],
  threadId?: string,
  embeds?: unknown[],
): Promise<string | undefined> {
  const parseMessageId = async (response: Response): Promise<string | undefined> => {
    try {
      const data = await response.json() as { id?: string }
      return data.id
    } catch {
      return undefined
    }
  }

  if (threadId && process.env.DISCORD_BOT_TOKEN) {
    const threadResponse = await sendDiscordRateLimitedRequest(`https://discord.com/api/v10/channels/${threadId}/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}`,
      },
      body: JSON.stringify({ content, embeds, components }),
    }).catch(() => null)

    if (threadResponse?.ok) {
      return await parseMessageId(threadResponse)
    }

    // If direct thread post fails, try webhook with explicit thread_id next.
    const webhookThreadResponse = await sendDiscordRateLimitedRequest(
      `https://discord.com/api/v10/webhooks/${applicationId}/${token}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content, components, embeds, thread_id: threadId }),
      },
    ).catch(() => null)

    if (webhookThreadResponse?.ok) {
      return await parseMessageId(webhookThreadResponse)
    }

    const threadErrorText = threadResponse ? await threadResponse.text().catch(() => "") : "no response"
    const webhookThreadErrorText = webhookThreadResponse ? await webhookThreadResponse.text().catch(() => "") : "no response"
    throw new Error(
      `Thread delivery failed: thread post ${threadResponse?.status || "n/a"} ${threadErrorText}; webhook thread post ${webhookThreadResponse?.status || "n/a"} ${webhookThreadErrorText}`,
    )
  }

  const tokenHasThread = token.includes("/")
  const body: Record<string, unknown> = { content, components, embeds }
  if (threadId && !tokenHasThread) {
    body.thread_id = threadId
  }

  const send = async (payload: Record<string, unknown>): Promise<Response> => sendDiscordRateLimitedRequest(
    `https://discord.com/api/v10/webhooks/${applicationId}/${token}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
  )

  let response = await send(body)

  if (!response.ok && threadId && !tokenHasThread) {
    const fallbackBody: Record<string, unknown> = { content, components, embeds }
    response = await send(fallbackBody)
  }

  if (!response.ok) {
    const errorText = await response.text().catch(() => "")
    throw new Error(`Discord followup failed: ${response.status} ${errorText}`)
  }

  return await parseMessageId(response)
}

async function editThreadMessage(
  threadId: string,
  messageId: string,
  payload: { content?: string; embeds?: unknown[]; components?: unknown[] },
): Promise<boolean> {
  const token = process.env.DISCORD_BOT_TOKEN
  if (!token) {
    return false
  }

  const response = await sendDiscordRateLimitedRequest(`https://discord.com/api/v10/channels/${threadId}/messages/${messageId}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bot ${token}`,
    },
    body: JSON.stringify(payload),
  }).catch(() => null)

  return Boolean(response?.ok)
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

  if (focused.name === "project") {
    const { getGitHubClient } = await import("../../src/github-client.js")
    const gh = getGitHubClient()
    if (!gh) {
      return autocompleteChoices([])
    }

    const repos = await gh.listRepos().catch(() => [])
    const choices = repos
      .filter((repo) => !query || startsWith(repo.fullName) || startsWith(repo.name))
      .slice(0, DISCORD_AUTOCOMPLETE_LIMIT)
      .map((repo) => ({
        name: repo.fullName,
        value: repo.fullName,
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
  await sendDiscordRateLimitedRequest(`https://discord.com/api/v10/webhooks/${applicationId}/${token}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      content,
      components,
      flags: 64,
    }),
  })
}

async function updateOriginalResponse(
  applicationId: string,
  token: string,
  content: string,
): Promise<void> {
  await sendDiscordRateLimitedRequest(`https://discord.com/api/v10/webhooks/${applicationId}/${token}/messages/@original`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content }),
  }).catch(() => null)
}

function compactForId(text: string, max = 80): string {
  const normalized = text.replace(/\s+/g, " ").trim()
  if (normalized.length <= max) {
    return normalized
  }
  return normalized.slice(0, max - 1)
}

function formatUsageFooter(
  usage: {
    providerId: string
    modelId: string
    cost: number
    tokens: {
      total?: number
      input: number
      output: number
      reasoning: number
      cache: { read: number; write: number }
    }
  } | undefined,
  contextWindow?: number,
): string | undefined {
  if (!usage) {
    return undefined
  }

  const totalTokens = usage.tokens.total
    ?? usage.tokens.input + usage.tokens.output + usage.tokens.reasoning + usage.tokens.cache.read + usage.tokens.cache.write
  const contextPercent = contextWindow && totalTokens > 0
    ? ` | context ${(totalTokens / contextWindow * 100).toFixed(1)}%`
    : ""

  return [
    `Model ${usage.providerId}/${usage.modelId}`,
    `Tokens ${totalTokens.toLocaleString()}${contextPercent}`,
    `Cost $${usage.cost.toFixed(4)}`,
  ].join(" | ")
}

function clipEmbedDescription(text: string, limit = 4000): string {
  return text.length > limit ? `${text.slice(0, limit - 3)}...` : text
}

function stripPromptEcho(text: string, prompt: string): string {
  const trimmedPrompt = prompt.trim()
  if (!trimmedPrompt) {
    return text
  }

  const trimmedText = text.trimStart()
  if (!trimmedText.toLowerCase().startsWith(trimmedPrompt.toLowerCase())) {
    return text
  }

  const remainder = trimmedText.slice(trimmedPrompt.length)
  return remainder.replace(/^[\s:,-]+/, "")
}

function stripInjectedPromptScaffolding(text: string, prompt: string, runtimeContext?: string): string {
  let next = text.trimStart()

  next = next.replace(/^context recovery note:[\s\S]*?current user request:\s*/i, "")

  const removePrefix = (prefix: string): void => {
    const normalized = prefix.trim()
    if (!normalized) {
      return
    }
    if (next.toLowerCase().startsWith(normalized.toLowerCase())) {
      next = next.slice(normalized.length).replace(/^[\s:,-]+/, "")
    }
  }

  if (runtimeContext) {
    removePrefix(runtimeContext)
  }

  next = next.replace(/^current user request:\s*/i, "")
  removePrefix(prompt)

  return next
}

function stripInternalReasoningLeak(text: string): string {
  const patterns = [
    /^the user is asking[\s\S]{0,500}?let me provide this information\.?\s*/i,
    /^the user asked[\s\S]{0,500}?let me provide this information\.?\s*/i,
    /^i can see from the environment information that[\s\S]{0,500}?let me provide this information\.?\s*/i,
  ]

  let cleaned = text
  for (const pattern of patterns) {
    cleaned = cleaned.replace(pattern, "")
  }

  return cleaned.trimStart()
}

function formatToolPreview(text: string | undefined, max = 140): string {
  if (!text) {
    return ""
  }
  const singleLine = text.replace(/\s+/g, " ").trim()
  if (!singleLine) {
    return ""
  }
  const clipped = singleLine.length > max ? `${singleLine.slice(0, max - 1)}...` : singleLine
  return ` - ${clipped.replace(/`/g, "'")}`
}

function enforceDiscordTextFormatting(text: string): string {
  const lines = text.split("\n")
  const converted: string[] = []

  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed.startsWith("|") && trimmed.endsWith("|")) {
      const cells = trimmed
        .split("|")
        .map((cell) => cell.trim())
        .filter(Boolean)

      if (cells.length >= 2) {
        const isSeparator = cells.every((cell) => /^:?-{3,}:?$/.test(cell))
        if (isSeparator) {
          continue
        }
        converted.push(`- ${cells[0]}: ${cells.slice(1).join(" | ")}`)
        continue
      }
    }

    converted.push(line)
  }

  return converted.join("\n")
}

function providerEnvCandidates(providerId: string): string[] {
  const normalized = providerId.toUpperCase().replace(/[^A-Z0-9]/g, "_")
  const candidates = [`${normalized}_API_KEY`]
  if (providerId === "google") {
    candidates.push("GOOGLE_GENERATIVEAI_API_KEY")
  }
  return candidates
}

function hasProviderApiKey(providerId: string): boolean {
  return providerEnvCandidates(providerId).some((key) => {
    const value = process.env[key]
    return typeof value === "string" && value.trim().length > 0
  })
}

async function sendFinalAskResponse(
  applicationId: string,
  token: string,
  threadId: string | undefined,
  text: string,
): Promise<void> {
  const clipped = text.length > 1900 ? `${text.slice(0, 1899)}...` : text
  await sendFollowup(applicationId, token, clipped || "Done.", undefined, threadId)
}

interface AskQueueRunRequest {
  interactionId: string
  applicationId: string
  token: string
  channelId: string
  userId: string
  prompt: string
}

function parseTodoItems(value: unknown): Array<{ content: string; status: string }> {
  if (!value) {
    return []
  }

  let source: unknown = value
  if (typeof source === "string") {
    try {
      source = JSON.parse(source)
    } catch {
      return []
    }
  }

  if (Array.isArray(source)) {
    return source
      .map((item) => ({
        content: typeof (item as { content?: unknown }).content === "string" ? (item as { content: string }).content : "",
        status: typeof (item as { status?: unknown }).status === "string" ? (item as { status: string }).status : "",
      }))
      .filter((item) => item.content && item.status)
  }

  if (source && typeof source === "object") {
    const obj = source as { todos?: unknown }
    if (Array.isArray(obj.todos)) {
      return parseTodoItems(obj.todos)
    }
  }

  return []
}

function todoStatusIcon(status: string): string {
  const normalized = status.toLowerCase()
  if (normalized === "completed") {
    return "✅"
  }
  if (normalized === "in_progress") {
    return "⏳"
  }
  if (normalized === "cancelled") {
    return "❌"
  }
  return "⌛"
}

function encodeToolPayload(kind: string, toolName: string, data: string): string {
  const maxEncodedLength = 95
  let safeTool = toolName
  let safeData = data

  while (true) {
    const payload = JSON.stringify({ k: kind, t: safeTool, d: safeData })
    const encoded = Buffer.from(payload).toString("base64url")
    if (encoded.length <= maxEncodedLength) {
      return encoded
    }

    if (safeData.length > 0) {
      safeData = safeData.slice(0, Math.max(0, Math.floor(safeData.length * 0.6)))
      continue
    }

    if (safeTool.length > 12) {
      safeTool = safeTool.slice(0, safeTool.length - 4)
      continue
    }

    return Buffer.from(JSON.stringify({ k: kind, t: kind, d: "" })).toString("base64url")
  }
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
  const reqId = `tool:${reqEncoded}`
  const resId = `tool:${resEncoded}`
  const jsonId = `tool:${jsonEncoded}`

  if (reqId.length > 100 || resId.length > 100 || jsonId.length > 100) {
    return []
  }

  return [
    {
      type: 1,
      components: [
        { type: 2, custom_id: reqId, label: "Request", style: 2 },
        { type: 2, custom_id: resId, label: "Result", style: 2 },
        { type: 2, custom_id: jsonId, label: "JSON", style: 2 },
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
  const [{ getSandboxManager }, { ChannelStateStore }, { OAuthTokenStore }] = await Promise.all([
    import("../../src/sandbox-manager.js"),
    import("../../src/channel-state-store.js"),
    import("../../src/oauth-token-store.js"),
  ])
  const channelId = interaction.channel_id
  const userId = getInteractionUserId(interaction)
  if (!channelId) {
    return json({ type: 4, data: { content: "This command must be used in a channel." } })
  }
  if (!userId) {
    return json({ type: 4, data: { content: "Missing user ID for auth flow." } })
  }

  const stateStore = new ChannelStateStore()
  const state = stateStore.get(channelId)

  const parts = text.replace(/^auth-connect\s*/i, "").replace(/^auth connect\s*/i, "").trim()
  const providerId = parts.split(" ")[0]

  if (!providerId) {
    return json({
      type: 4,
        data: {
          content: "Usage: `/auth-connect <provider>`\nExample: `/auth-connect openai`",
        },
      })
  }

  const sandboxManager = getSandboxManager()
  const oauthStore = new OAuthTokenStore()

  const pendingFromBlob = await oauthStore.getPendingOAuth(userId, providerId)
  const pendingOAuth = state.pendingOAuth?.providerId === providerId
    ? state.pendingOAuth
    : pendingFromBlob

  if (pendingOAuth?.providerId === providerId) {
    try {
      const completeResult: OAuthCompleteResult = await sandboxManager.completeOAuth(
        channelId,
        providerId,
        undefined,
        pendingOAuth.deviceAuthId,
        pendingFromBlob?.sandboxId || state.sandboxId,
        pendingFromBlob?.opencodePassword || state.opencodePassword,
      )

      if (completeResult.success) {
        if (completeResult.tokens) {
          await oauthStore.setUserProviderAuth(userId, providerId, completeResult.tokens)
        }
        await oauthStore.clearPendingOAuth(userId, providerId)
        state.pendingOAuth = undefined
        stateStore.set(state)

        return json({
          type: 4,
          data: {
            content: completeResult.tokens
              ? `✅ Successfully connected to **${providerId}**!\n\nCredentials are now saved for your user and will be reused across sandbox sessions.`
              : `✅ Successfully connected to **${providerId}**!\n\nOAuth is active in the current sandbox.`,
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
    const oauthResult: OAuthStartResult = await sandboxManager.startOAuth(
      channelId,
      providerId,
      undefined,
      state.sandboxId,
      state.opencodePassword,
    )
    if (oauthResult.sandboxId) {
      state.sandboxId = oauthResult.sandboxId
    }
    if (oauthResult.opencodePassword) {
      state.opencodePassword = oauthResult.opencodePassword
    }

    if (oauthResult.success === false || !oauthResult.url) {
      return json({
        type: 4,
        data: {
          content: oauthResult.message || `Failed to start OAuth for '${providerId}'. Check the provider name.`,
        },
      })
    }

    state.pendingOAuth = {
      providerId,
      deviceAuthId: oauthResult.deviceAuthId,
      timestamp: Date.now(),
    }
    stateStore.set(state)
    await oauthStore.setPendingOAuth(userId, providerId, {
      providerId,
      deviceAuthId: oauthResult.deviceAuthId,
      sandboxId: oauthResult.sandboxId,
      opencodePassword: oauthResult.opencodePassword,
      timestamp: Date.now(),
    })

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

async function processAuthConnectInteraction(interaction: Interaction, text: string): Promise<void> {
  try {
    const response = await handleAuthConnect(interaction, text)
    const raw = await response.text()
    let content = "Auth flow completed."

    try {
      const parsed = JSON.parse(raw) as { data?: { content?: string } }
      if (parsed.data?.content) {
        content = parsed.data.content
      }
    } catch {
      if (raw) {
        content = raw
      }
    }

    await sendFollowup(interaction.application_id, interaction.token, content)
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error"
    await sendFollowup(interaction.application_id, interaction.token, `OAuth error: ${message}`)
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

function parseProjectInput(project: string): { project: string; repoUrl: string; branch: string } {
  const normalized = project.trim().replace(/^https?:\/\/github\.com\//, "").replace(/\.git$/, "")
  const [ownerRepo, branchHint] = normalized.split("#")
  const branch = branchHint || "main"
  if (!ownerRepo || !ownerRepo.includes("/")) {
    throw new Error("Project must be in owner/repo format.")
  }
  return {
    project: ownerRepo,
    repoUrl: `https://github.com/${ownerRepo}`,
    branch,
  }
}

function truncateLabel(input: string, max = 80): string {
  const compact = input.replace(/\s+/g, " ").trim()
  return compact.length <= max ? compact : `${compact.slice(0, max - 3)}...`
}

async function createThreadFromChannel(channelId: string, name: string): Promise<string | undefined> {
  if (!process.env.DISCORD_BOT_TOKEN) {
    return undefined
  }

  const response = await sendDiscordRateLimitedRequest(
    `https://discord.com/api/v10/channels/${channelId}/threads`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}`,
      },
      body: JSON.stringify({
        name: truncateLabel(name, 90),
        auto_archive_duration: 1440,
        type: 11,
      }),
    },
  ).catch(() => null)

  if (!response?.ok) {
    return undefined
  }

  const data = await response.json() as { id?: string }
  return data.id
}

async function startThreadSession(
  threadId: string,
  repoUrl: string | undefined,
  branch: string,
  options?: { snapshotId?: string; resetSessions?: boolean; cloneRepoOnSnapshot?: boolean },
): Promise<{ sandboxId: string; opencodePassword: string }> {
  const [{ getSandboxManager }, { ThreadRuntimeStore }, { ChannelStateStore }] = await Promise.all([
    import("../../src/sandbox-manager.js"),
    import("../../src/thread-runtime-store.js"),
    import("../../src/channel-state-store.js"),
  ])

  const sandboxManager = getSandboxManager()
  const runtimeStore = new ThreadRuntimeStore()
  const channelStateStore = new ChannelStateStore()

  const context = options?.snapshotId
    ? await sandboxManager.createFromSnapshot(
      threadId,
      options.snapshotId,
      options.cloneRepoOnSnapshot ? repoUrl : undefined,
      branch,
    )
    : await sandboxManager.getOrCreate(threadId, undefined, repoUrl, branch)

  await runtimeStore.setSandbox(threadId, context.sandboxId, context.opencodePassword, {
    clearSession: options?.resetSessions !== false,
  })

  const threadState = channelStateStore.get(threadId)
  if (repoUrl) {
    const projectName = repoUrl.split("/").slice(-1)[0] || "Project"
    channelStateStore.setProject(threadId, repoUrl, branch, projectName)
  } else {
    delete threadState.repoUrl
    delete threadState.branch
    delete threadState.projectName
    channelStateStore.set(threadState)
  }

  return {
    sandboxId: context.sandboxId,
    opencodePassword: context.opencodePassword,
  }
}

async function handleOpencodeCommand(interaction: Interaction, projectInput?: string, prompt?: string): Promise<Response> {
  const channelId = interaction.channel_id
  const userId = getInteractionUserId(interaction)
  if (!channelId || !userId) {
    return json({ type: 4, data: { content: !channelId ? "Missing channel ID." : "Missing user ID." } })
  }

  const inThread = await isThreadChannel(channelId)
  if (inThread) {
    return json({
      type: 4,
      data: {
        content: "Run `/opencode` from a channel to start or resume a session.",
      },
    })
  }

  const [{ WorkspaceEntryStore }] = await Promise.all([
    import("../../src/workspace-entry-store.js"),
  ])

  const workspaceStore = new WorkspaceEntryStore()

  if (!projectInput) {
    const rawBaselineSnapshotId = await ensureRawBaselineSnapshot()
    const threadId = await createThreadFromChannel(channelId, "OpenCode Session")
    if (!threadId) {
      return json({ type: 4, data: { content: "Failed to create thread for /opencode." } })
    }

    await startThreadSession(threadId, undefined, "main", {
      snapshotId: rawBaselineSnapshotId,
      resetSessions: true,
    })
    await workspaceStore.setThreadBinding({
      threadId,
      userId,
      updatedAt: Date.now(),
    })

    if (prompt) {
      await executeQueuedAskRun({
        interactionId: interaction.id,
        applicationId: interaction.application_id,
        token: interaction.token,
        channelId: threadId,
        userId,
        prompt,
      })
    } else {
      await sendFollowup(interaction.application_id, interaction.token, `<@${userId}> Your sandbox is ready! Use /ask in this thread to begin.`, undefined, threadId)
    }

    return json({
      type: 4,
      data: {
        content: prompt
          ? `Starting sandbox and processing your prompt in <#${threadId}>...`
          : `Starting empty sandbox in <#${threadId}>. Use /ask in that thread to begin.`,
      },
    })
  }

  const parsedProject = parseProjectInput(projectInput)
  const threadId = await createThreadFromChannel(channelId, `OpenCode ${parsedProject.project}`)
  if (!threadId) {
    return json({ type: 4, data: { content: "Failed to create thread." } })
  }

  const rawBaselineSnapshotId = await ensureRawBaselineSnapshot()
  console.log(`[handleOpencodeCommand] Starting thread session, threadId=${threadId}, repoUrl=${parsedProject.repoUrl}`)
  await startThreadSession(threadId, parsedProject.repoUrl, parsedProject.branch, {
    snapshotId: rawBaselineSnapshotId,
    resetSessions: true,
    cloneRepoOnSnapshot: true,
  })
  console.log(`[handleOpencodeCommand] Thread session started successfully, threadId=${threadId}`)
  const entry = await workspaceStore.createEntry({
    userId,
    project: parsedProject.project,
    repoUrl: parsedProject.repoUrl,
    branch: parsedProject.branch,
    name: `New session ${new Date().toISOString()}`,
    threadId,
  })
  await workspaceStore.setThreadBinding({
    threadId,
    userId,
    project: parsedProject.project,
    workspaceEntryId: entry.id,
    updatedAt: Date.now(),
  })

  if (prompt) {
    await executeQueuedAskRun({
      interactionId: interaction.id,
      applicationId: interaction.application_id,
      token: interaction.token,
      channelId: threadId,
      userId,
      prompt,
    })
  } else {
    await sendFollowup(interaction.application_id, interaction.token, `<@${userId}> Your sandbox is ready with the repository cloned! Use /ask in this thread to begin.`, undefined, threadId)
  }

  return json({
    type: 4,
    data: {
      content: prompt
        ? `Started session and processing your prompt in <#${threadId}>...`
        : `Started a new session in <#${threadId}>.`,
    },
  })
}

async function processOpencodeCommandInteraction(interaction: Interaction, projectInput?: string, prompt?: string): Promise<void> {
  try {
    const response = await handleOpencodeCommand(interaction, projectInput, prompt)
    const raw = await response.text()
    let content = "OpenCode session started."
    let components: unknown[] | undefined

    try {
      const parsed = JSON.parse(raw) as { data?: { content?: string; components?: unknown[] } }
      if (parsed.data?.content) {
        content = parsed.data.content
      }
      if (Array.isArray(parsed.data?.components)) {
        components = parsed.data.components
      }
    } catch {
      if (raw) {
        content = raw
      }
    }

    await sendFollowup(interaction.application_id, interaction.token, content, components)
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error"
    await sendFollowup(interaction.application_id, interaction.token, `Failed to start opencode session: ${message}`)
  }
}

async function refreshRawBaselineSnapshot(): Promise<string> {
  const [{ getSandboxManager }, { WorkspaceEntryStore }] = await Promise.all([
    import("../../src/sandbox-manager.js"),
    import("../../src/workspace-entry-store.js"),
  ])

  const sandboxManager = getSandboxManager()
  const workspaceStore = new WorkspaceEntryStore()
  const key = `raw-baseline-${Date.now()}`
  const { snapshotId } = await sandboxManager.createRawBaselineSnapshot(key)
  await workspaceStore.setRawBaseline(snapshotId)
  return snapshotId
}

async function ensureRawBaselineSnapshot(maxAgeMs = 24 * 60 * 60_000): Promise<string> {
  const [{ WorkspaceEntryStore }] = await Promise.all([
    import("../../src/workspace-entry-store.js"),
  ])

  const workspaceStore = new WorkspaceEntryStore()
  const baseline = await workspaceStore.getRawBaseline()
  const isFresh = Boolean(baseline.snapshotId && baseline.updatedAt && (Date.now() - baseline.updatedAt) < maxAgeMs)
  if (isFresh && baseline.snapshotId) {
    return baseline.snapshotId
  }
  return await refreshRawBaselineSnapshot()
}

async function getRawBaselineStatus(maxAgeMs = 24 * 60 * 60_000): Promise<{ snapshotId?: string; stale: boolean }> {
  const [{ WorkspaceEntryStore }] = await Promise.all([
    import("../../src/workspace-entry-store.js"),
  ])

  const workspaceStore = new WorkspaceEntryStore()
  const baseline = await workspaceStore.getRawBaseline()
  if (!baseline.snapshotId || !baseline.updatedAt) {
    return { stale: true }
  }
  const stale = (Date.now() - baseline.updatedAt) >= maxAgeMs
  return { snapshotId: baseline.snapshotId, stale }
}

async function processUpdateInteraction(interaction: Interaction): Promise<void> {
  try {
    const { refreshProviderRegistry } = await import("../../src/provider-registry-store.js")

    const result = await refreshProviderRegistry()
    const rawStatus = await getRawBaselineStatus()
    let rawSnapshotId = rawStatus.snapshotId || ""
    let rawAction = "unchanged"
    if (rawStatus.stale) {
      try {
        rawSnapshotId = await refreshRawBaselineSnapshot()
        rawAction = "refreshed"
      } catch (error) {
        rawAction = "failed"
        console.error("Raw baseline refresh failed:", error)
      }
    }

    const message = `${result.created ? "Created" : "Updated"} provider registry.\n` +
      `Providers: ${result.providerCount}\n` +
      `Models: ${result.modelCount}` +
      (rawSnapshotId
        ? `\nRaw baseline (${rawAction}): ${rawSnapshotId}`
        : `\nRaw baseline (${rawAction}).`)

    const chunks = splitDiscordMessage(message)
    await sendFollowup(interaction.application_id, interaction.token, chunks[0] || "Updated.")
    for (const chunk of chunks.slice(1)) {
      await sendFollowup(interaction.application_id, interaction.token, chunk)
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error"
    await sendFollowup(interaction.application_id, interaction.token, `Update failed: ${message}`)
  }
}

async function processCheckpointInteraction(interaction: Interaction, channelId: string, inThread: boolean): Promise<void> {
  try {
    if (!inThread) {
      await sendFollowup(interaction.application_id, interaction.token, "Run /checkpoint inside a thread.")
      return
    }

    const [{ ThreadRuntimeStore }, { WorkspaceEntryStore }] = await Promise.all([
      import("../../src/thread-runtime-store.js"),
      import("../../src/workspace-entry-store.js"),
    ])
    const runtimeStore = new ThreadRuntimeStore()
    const workspaceStore = new WorkspaceEntryStore()
    const runtime = await runtimeStore.get(channelId)
    if (!runtime.sandboxId) {
      await sendFollowup(interaction.application_id, interaction.token, "No active sandbox in this thread. Run /opencode in a channel first.")
      return
    }

    const sandbox = await Sandbox.get({ sandboxId: runtime.sandboxId }).catch(() => null)
    if (!sandbox) {
      await sendFollowup(interaction.application_id, interaction.token, "Sandbox is no longer available.")
      return
    }

    const snapshot = await sandbox.snapshot().catch(() => null)
    if (!snapshot) {
      await sendFollowup(interaction.application_id, interaction.token, "Failed to create checkpoint snapshot.")
      return
    }

    const binding = await workspaceStore.getThreadBinding(channelId)
    if (binding?.project && binding.workspaceEntryId) {
      await workspaceStore.updateEntry(binding.userId, binding.project, binding.workspaceEntryId, {
        snapshotId: snapshot.snapshotId,
      })
    }

    await sendFollowup(
      interaction.application_id,
      interaction.token,
      `Checkpoint created: ${snapshot.snapshotId}\nThis thread can now be resumed from this saved state.`,
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error"
    await sendFollowup(interaction.application_id, interaction.token, `Checkpoint failed: ${message}`)
  }
}

async function processDeleteInteraction(interaction: Interaction, channelId: string, inThread: boolean): Promise<void> {
  try {
    if (!inThread) {
      await sendFollowup(interaction.application_id, interaction.token, "Run /delete inside a thread.")
      return
    }

    const [{ ThreadRuntimeStore }, { WorkspaceEntryStore }, { getSandboxManager }, { ThreadAskQueueStore }] = await Promise.all([
      import("../../src/thread-runtime-store.js"),
      import("../../src/workspace-entry-store.js"),
      import("../../src/sandbox-manager.js"),
      import("../../src/thread-ask-queue-store.js"),
    ])

    const runtimeStore = new ThreadRuntimeStore()
    const workspaceStore = new WorkspaceEntryStore()
    const sandboxManager = getSandboxManager()
    const askQueueStore = new ThreadAskQueueStore()
    const runtime = await runtimeStore.get(channelId)

    if (!runtime.sandboxId) {
      await askQueueStore.clearThread(channelId)
      await runtimeStore.clear(channelId)
      await sendFollowup(interaction.application_id, interaction.token, "No active sandbox in this thread. Cleared any queued /ask runs.")
      return
    }

    await sandboxManager.stop(channelId, runtime.sandboxId)
    await runtimeStore.clear(channelId)
    await askQueueStore.clearThread(channelId)

    const binding = await workspaceStore.getThreadBinding(channelId)
    if (binding?.project && binding.workspaceEntryId) {
      await workspaceStore.updateEntry(binding.userId, binding.project, binding.workspaceEntryId, {
        threadId: undefined,
      })
    }
    await workspaceStore.clearThreadBinding(channelId)

    await sendFollowup(
      interaction.application_id,
      interaction.token,
      "Deleted this thread session. Sandbox stopped without checkpointing. Run /opencode in a channel to start or resume again.",
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error"
    await sendFollowup(interaction.application_id, interaction.token, `Delete failed: ${message}`)
  }
}

async function executeQueuedAskRun(run: AskQueueRunRequest): Promise<void> {
  const startedAt = Date.now()
  try {
  logAskStage("execute_start", {
    threadId: run.channelId,
    interactionId: run.interactionId,
    promptLength: run.prompt.length,
  })
  const [
    { ChannelStateStore },
    { CredentialStore },
    { OAuthTokenStore },
    { createSandboxOpencodeClient },
    { executePromptForChannel },
    { getSandboxManager },
    { loadProviderRegistry },
    { SelectionStore },
    { ThreadRuntimeStore },
  ] = await Promise.all([
    import("../../src/channel-state-store.js"),
    import("../../src/credential-store.js"),
    import("../../src/oauth-token-store.js"),
    import("../../src/opencode-client.js"),
    import("../../src/prompt-orchestrator.js"),
    import("../../src/sandbox-manager.js"),
    import("../../src/provider-registry-store.js"),
    import("../../src/selection-store.js"),
    import("../../src/thread-runtime-store.js"),
  ])

    const channelId = run.channelId
    const userId = run.userId
    const prompt = run.prompt

    if (!channelId || !userId) {
      await sendFollowup(run.applicationId, run.token, !channelId ? "Missing channel ID." : "Missing user ID.")
      return
    }

    const stateStore = new ChannelStateStore()
    const selectionStore = new SelectionStore()
    const channelState = stateStore.get(channelId)
    const commandIsInThread = await isThreadChannel(channelId)

  if (!commandIsInThread) {
    await sendFollowup(run.applicationId, run.token, "Run `/opencode` first in a channel to start or resume a session.")
    return
  }

  const effectiveThreadId = channelId
  await updateOriginalResponse(run.applicationId, run.token, "Working...")
  logAskStage("execute_working", { threadId: channelId, interactionId: run.interactionId })

  const conversationId = effectiveThreadId
  const conversationState = stateStore.get(conversationId)
  const [{ WorkspaceEntryStore }] = await Promise.all([
    import("../../src/workspace-entry-store.js"),
  ])
  const workspaceStore = new WorkspaceEntryStore()
  let threadBinding = await workspaceStore.getThreadBinding(conversationId)
  const threadRuntimeStore = new ThreadRuntimeStore()
  let threadRuntimeState = await threadRuntimeStore.get(conversationId)
  logAskStage("execute_runtime_loaded", {
    threadId: conversationId,
    interactionId: run.interactionId,
    hasSandboxId: Boolean(threadRuntimeState.sandboxId),
    hasSessionId: Boolean(threadRuntimeState.sessionId),
    bindingProject: threadBinding?.project,
    bindingWorkspaceEntryId: threadBinding?.workspaceEntryId,
  })
  console.log(`[executeQueuedAskRun] threadRuntimeState=`, threadRuntimeState)
  console.log(`[executeQueuedAskRun] threadBinding=`, threadBinding)

  if (!threadBinding && threadRuntimeState.sandboxId) {
    logAskStage("execute_binding_missing", {
      threadId: conversationId,
      interactionId: run.interactionId,
      hasSandboxId: true,
    })
    // Do not overwrite the durable binding with an empty fallback.
    // A transient stale read would permanently erase project metadata.
    threadBinding = {
      threadId: conversationId,
      userId,
      updatedAt: Date.now(),
    }
  }

  if (threadBinding && threadBinding.userId !== userId) {
    await sendFollowup(
      run.applicationId,
      run.token,
      "This thread is bound to another user session. Start your own with `/opencode` in a channel.",
      undefined,
      effectiveThreadId,
    )
    return
  }

  if (threadBinding?.project && threadBinding.workspaceEntryId) {
    const entry = await workspaceStore.getEntry(threadBinding.userId, threadBinding.project, threadBinding.workspaceEntryId)
    if (!entry) {
      threadBinding = {
        threadId: conversationId,
        userId: threadBinding.userId,
        updatedAt: Date.now(),
      }
      await workspaceStore.setThreadBinding(threadBinding)
    } else if (entry.threadId !== conversationId) {
      await workspaceStore.updateEntry(threadBinding.userId, threadBinding.project, threadBinding.workspaceEntryId, {
        threadId: conversationId,
      })
    }
  }

  if (!threadRuntimeState.sandboxId && !commandIsInThread) {
    const rawBaselineSnapshotId = await ensureRawBaselineSnapshot()
    const fresh = await startThreadSession(conversationId, undefined, "main", {
      snapshotId: rawBaselineSnapshotId,
      resetSessions: true,
    })
    threadRuntimeState = {
      ...threadRuntimeState,
      sandboxId: fresh.sandboxId,
      opencodePassword: fresh.opencodePassword,
    }
  }

  if (!threadRuntimeState.sandboxId) {
    await sendFollowup(
      run.applicationId,
      run.token,
      "No active thread session. Run `/opencode <project>` from a channel first.",
      undefined,
      effectiveThreadId,
    )
    return
  }

  // Selection semantics:
  // - If /ask is invoked inside a thread, honor thread overrides.
  // - If /ask is invoked in a normal channel, use user defaults.
  const selectionThreadId = commandIsInThread ? effectiveThreadId : undefined

  let selection = await selectionStore.resolveSelection(userId, selectionThreadId)
  const userDefaults = await selectionStore.getUserDefaults(userId)

  if (selection?.providerId && !selection.modelId && userDefaults?.providerId === selection.providerId && userDefaults.modelId) {
    selection = {
      providerId: selection.providerId,
      modelId: userDefaults.modelId,
    }

    if (selectionThreadId) {
      await selectionStore.setThreadSelection(selectionThreadId, selection)
    }
  }

  if (!commandIsInThread && effectiveThreadId) {
    await selectionStore.initializeThreadFromUser(effectiveThreadId, userId)
  }
  if (!selection?.providerId) {
    await sendFollowup(
      run.applicationId,
      run.token,
      "No default provider configured. Run `/use-provider <provider>` in any normal channel first.",
      undefined,
      effectiveThreadId,
    )
    return
  }

  if (threadBinding?.project && threadBinding.workspaceEntryId && !threadBinding.hasCustomName) {
    const isFirstPrompt = !threadRuntimeState.sessionId
    if (isFirstPrompt) {
      await workspaceStore.updateEntry(threadBinding.userId, threadBinding.project, threadBinding.workspaceEntryId, {
        name: truncateLabel(prompt, 72),
      })
      await workspaceStore.setThreadBinding({
        ...threadBinding,
        hasCustomName: true,
        updatedAt: Date.now(),
      })
    }
  }

    if (!selection?.modelId) {
    await sendFollowup(
      run.applicationId,
      run.token,
      `No model configured for provider '${selection.providerId}'. Run /use-model <model> in any normal channel first.`,
      undefined,
      effectiveThreadId,
    )
    return
  }

    let repoUrl: string | undefined
    let branch = "main"
    if (threadBinding?.project && threadBinding.workspaceEntryId) {
      const entry = await workspaceStore.getEntry(threadBinding.userId, threadBinding.project, threadBinding.workspaceEntryId)
      if (entry) {
        repoUrl = entry.repoUrl
        branch = entry.branch || "main"
      }
    }
    if (!repoUrl && threadBinding?.project) {
      try {
        const parsedBindingProject = parseProjectInput(threadBinding.project)
        repoUrl = parsedBindingProject.repoUrl
        branch = parsedBindingProject.branch || branch
      } catch {
        // Ignore malformed historical binding values.
      }
    }
    if (!repoUrl && (conversationState.repoUrl || channelState.repoUrl)) {
      repoUrl = conversationState.repoUrl || channelState.repoUrl
      branch = conversationState.branch || channelState.branch || "main"
    }

    const sessionCwd = repoUrlToWorkspaceCwd(repoUrl)

    const sandboxManager = getSandboxManager()
    let sandboxContext: SandboxContext
    const oldSandboxId = threadRuntimeState.sandboxId

    try {
      sandboxContext = await sandboxManager.getOrCreate(
        conversationId,
        threadRuntimeState.sandboxId,
        repoUrl,
        branch,
        threadRuntimeState.opencodePassword,
      )
      logAskStage("sandbox_ready", {
        threadId: conversationId,
        interactionId: run.interactionId,
        sandboxId: sandboxContext.sandboxId,
      })
    } catch (error) {
      logAskStage("sandbox_error", {
        threadId: conversationId,
        interactionId: run.interactionId,
        error: error instanceof Error ? error.message : String(error),
      })
      console.error("Failed to get/create sandbox:", error)
      await sendFollowup(
        run.applicationId,
        run.token,
        `Failed to create sandbox: ${error instanceof Error ? error.message : "Unknown error"}`,
      )
      return
    }

    await threadRuntimeStore.setSandbox(conversationId, sandboxContext.sandboxId, sandboxContext.opencodePassword)

    const client = createSandboxOpencodeClient(sandboxContext.opencodeBaseUrl, sandboxContext.opencodePassword)
    const credentials = new CredentialStore()
    const oauthStore = new OAuthTokenStore()
    const registry = await loadProviderRegistry()
    const providerAuth = await oauthStore.getUserProviderAuth(userId, selection.providerId)
    let runtimeContext: string | undefined
    logAskStage("prompt_flow_start", {
      threadId: conversationId,
      interactionId: run.interactionId,
      providerId: selection.providerId,
      modelId: selection.modelId,
      sandboxId: sandboxContext.sandboxId,
      cwd: sessionCwd,
      repoUrl,
    })

    try {
      const { getGitHubClient } = await import("../../src/github-client.js")
      const ghClient = getGitHubClient()
      if (ghClient) {
        const githubLogin = await Promise.race<string | undefined>([
          ghClient.getViewerLogin(),
          new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), 3_000)),
        ])
        if (!githubLogin) {
          throw new Error("GitHub viewer lookup timed out")
        }
        runtimeContext = [
          "Runtime GitHub context:",
          `- Authenticated GitHub login: ${githubLogin}`,
          "- For repository references without explicit owner, assume this login by default.",
        ].join("\n")
      }
    } catch {
      // Continue without explicit GitHub login context.
    }

  // Check if sandbox was newly created (old one expired) - fetch recovery context
    const isNewSandbox = oldSandboxId && oldSandboxId !== sandboxContext.sandboxId

  // Warn user about lost local changes if sandbox expired
    if (isNewSandbox && repoUrl) {
    await sendFollowup(
      run.applicationId,
      run.token,
      "⚠️ **Sandbox expired** - A new session was started. Your repository was cloned fresh from GitHub.\n\n> **Note:** Any uncommitted local changes in the previous session have been lost. Remember to commit and push your work before the sandbox expires!",
      undefined,
      effectiveThreadId,
    )
  }

    const hadExistingSession = Boolean(await threadRuntimeStore.getSession(conversationId))

    const recoveryContext = isNewSandbox
      ? await (async () => {
          const { getRecoveryContext } = await import("../../src/discord-message-fetcher.js")
          return getRecoveryContext(stateStore, conversationId, prompt)
        })()
      : undefined

    let responseBuffer = ""
    let streamedLength = 0
    let assistantStreamStarted = false
    let assistantMessageId: string | undefined
    let assistantMessageText = ""
    let lastAssistantFlushAt = 0
    const reasoningBufferByPart = new Map<string, string>()
    const reasoningMessageIdByPart = new Map<string, string>()
    const lastReasoningSentLengthByPart = new Map<string, number>()
    let toolEvents = 0
    const toolMessageByCall = new Map<string, string>()
    let toolSequence = 0
    let todoProgressMessageId: string | undefined
    const threadIdForFollowups = effectiveThreadId
    const ASSISTANT_MESSAGE_LIMIT = 1900

    const flushReasoning = async (partId: string, force = false): Promise<void> => {
      const trimmed = (reasoningBufferByPart.get(partId) || "").trim()
      if (!trimmed) {
        return
      }

      const lastSentLength = lastReasoningSentLengthByPart.get(partId) || 0
      if (!force && trimmed.length - lastSentLength < 60) {
        return
      }

      const clipped = trimmed.length > 1800 ? `${trimmed.slice(0, 1799)}...` : trimmed
      const content = `> 💭 ${clipped}`
      const reasoningMessageId = reasoningMessageIdByPart.get(partId)

      if (threadIdForFollowups && reasoningMessageId) {
        const updated = await editThreadMessage(threadIdForFollowups, reasoningMessageId, { content })
        if (updated) {
          lastReasoningSentLengthByPart.set(partId, trimmed.length)
          return
        }
      }

      const messageId = await sendFollowup(
        run.applicationId,
        run.token,
        content,
        undefined,
        threadIdForFollowups,
      )
      if (messageId) {
        reasoningMessageIdByPart.set(partId, messageId)
      }
      lastReasoningSentLengthByPart.set(partId, trimmed.length)
    }

    const flushAssistantStream = async (force = false): Promise<void> => {
      const sanitized = enforceDiscordTextFormatting(stripInternalReasoningLeak(
        stripInjectedPromptScaffolding(responseBuffer, prompt, runtimeContext),
      ))
      const pending = sanitized.slice(streamedLength)
      if (!pending) {
        return
      }

      const now = Date.now()
      if (!force && pending.length < 70 && now - lastAssistantFlushAt < 700) {
        return
      }

      let remaining = pending
      while (remaining.length > 0) {
        const available = ASSISTANT_MESSAGE_LIMIT - assistantMessageText.length
        if (assistantMessageId && available > 0 && threadIdForFollowups) {
          const chunk = remaining.slice(0, available)
          const nextText = assistantMessageText + chunk
          const updated = await editThreadMessage(threadIdForFollowups, assistantMessageId, { content: nextText })
          if (updated) {
            assistantMessageText = nextText
            streamedLength += chunk.length
            remaining = remaining.slice(chunk.length)
            lastAssistantFlushAt = now
            assistantStreamStarted = true
            continue
          }
          assistantMessageId = undefined
          assistantMessageText = ""
        }

        const chunk = remaining.slice(0, ASSISTANT_MESSAGE_LIMIT)
        const messageId = await sendFollowup(
          run.applicationId,
          run.token,
          chunk,
          undefined,
          threadIdForFollowups,
        )
        assistantMessageId = messageId
        assistantMessageText = chunk
        streamedLength += chunk.length
        remaining = remaining.slice(chunk.length)
        lastAssistantFlushAt = now
        assistantStreamStarted = true
      }
    }

    const updateTodoProgressEmbed = async (
      raw: unknown,
      todosFromEvent?: Array<{ content: string; status: string; priority?: string }>,
    ): Promise<void> => {
      const todos = todosFromEvent && todosFromEvent.length > 0 ? todosFromEvent : parseTodoItems(raw)
      if (todos.length === 0) {
        return
      }

      const counts = { pending: 0, in_progress: 0, completed: 0, cancelled: 0 }
      for (const todo of todos) {
        if (todo.status in counts) {
          counts[todo.status as keyof typeof counts] += 1
        }
      }

      const listed = todos.slice(0, 12)
      const todoLines = listed.map((todo) => `${todoStatusIcon(todo.status)} ${todo.content}`)
      const embed = {
        title: "Todo Progress",
        description: [
          `Pending: ${counts.pending} | In Progress: ${counts.in_progress}`,
          `Completed: ${counts.completed} | Cancelled: ${counts.cancelled}`,
          "",
          ...todoLines,
          ...(todos.length > listed.length ? [`...and ${todos.length - listed.length} more`] : []),
        ].join("\n"),
      }

      if (threadIdForFollowups && todoProgressMessageId) {
        const updated = await editThreadMessage(threadIdForFollowups, todoProgressMessageId, {
          content: "",
          embeds: [embed],
        })
        if (updated) {
          return
        }
      }

      const messageId = await sendFollowup(
        run.applicationId,
        run.token,
        "",
        undefined,
        threadIdForFollowups,
        [embed],
      )
      if (messageId) {
        todoProgressMessageId = messageId
      }
    }

    const result = await executePromptForChannel(
      client,
      registry,
      credentials,
    threadRuntimeStore,
    conversationId,
    {
      providerId: selection.providerId,
      modelId: selection.modelId,
    },
    prompt,
    {
      onTextDelta: async (text) => {
        responseBuffer += text
        await flushAssistantStream(false)
      },
      onReasoningDelta: async ({ partId, text, completed }) => {
        if (assistantStreamStarted) {
          return
        }
        const key = partId || "unknown"
        reasoningBufferByPart.set(key, (reasoningBufferByPart.get(key) || "") + text)
        await flushReasoning(key, Boolean(completed))
      },
      onToolActivity: async () => {},
      onToolRequest: async (payload) => {
        toolEvents += 1
        toolSequence += 1
        const callKey = payload.toolCallId || `${payload.toolName}:${toolSequence}`
        const preview = formatToolPreview(payload.requestSummary)
        const messageId = await sendFollowup(
          run.applicationId,
          run.token,
          `> ⏳ Tool: ${payload.toolName}${preview}`,
          undefined,
          threadIdForFollowups,
        )
        if (messageId) {
          toolMessageByCall.set(callKey, messageId)
        }
        if (payload.toolName === "todowrite") {
          await updateTodoProgressEmbed(payload.requestRaw)
        }
      },
      onToolResult: async (payload) => {
        const callKey = payload.toolCallId || `${payload.toolName}:${toolSequence}`
        const doneIcon = payload.status === "error" ? "❌" : "✅"
        const preview = formatToolPreview(payload.resultSummary)
        const content = `> ${doneIcon} Tool: ${payload.toolName}${preview}`
        const existingMessageId = toolMessageByCall.get(callKey)
        if (threadIdForFollowups && existingMessageId) {
          const updated = await editThreadMessage(threadIdForFollowups, existingMessageId, { content })
          if (updated) {
            if (payload.toolName === "todowrite") {
              await updateTodoProgressEmbed(payload.resultRaw)
            }
            return
          }
        }
        await sendFollowup(run.applicationId, run.token, content, undefined, threadIdForFollowups)
        if (payload.toolName === "todowrite") {
          await updateTodoProgressEmbed(payload.resultRaw)
        }
      },
      onTodoUpdate: async (todos) => {
        await updateTodoProgressEmbed(undefined, todos)
      },
      onQuestion: async (questionMessage: string) => {
        await sendFollowup(run.applicationId, run.token, `> ${questionMessage}`, undefined, threadIdForFollowups)
      },
      onPermission: async (permissionMessage: string) => {
        await sendFollowup(run.applicationId, run.token, `> ${permissionMessage}`, undefined, threadIdForFollowups)
      },
      onError: async (errorMessage: string) => {
        await sendFollowup(run.applicationId, run.token, `> Error: ${errorMessage}`, undefined, threadIdForFollowups)
      },
    },
      {
        recoveryContext: recoveryContext || undefined,
        providerAuth,
        runtimeContext,
        cwd: sessionCwd,
      },
    )

    if (!result.ok) {
      logAskStage("prompt_flow_failed", {
        threadId: conversationId,
        interactionId: run.interactionId,
        message: result.message,
        elapsedMs: Date.now() - startedAt,
      })
      await sendFollowup(run.applicationId, run.token, result.message, undefined, threadIdForFollowups)
      return
    }
    logAskStage("prompt_flow_done", {
      threadId: conversationId,
      interactionId: run.interactionId,
      elapsedMs: Date.now() - startedAt,
      hadError: Boolean(result.hadError),
      filesEdited: result.filesEdited?.length || 0,
      hasUsage: Boolean(result.usage),
    })

    const usageFooter = formatUsageFooter(
      result.usage,
      registry.getModel(selection.providerId, selection.modelId)?.contextWindow,
    )

    if (!assistantStreamStarted) {
      for (const partId of reasoningBufferByPart.keys()) {
        await flushReasoning(partId, true)
      }
    }

    await flushAssistantStream(true)

    const text = enforceDiscordTextFormatting(stripInternalReasoningLeak(
      stripInjectedPromptScaffolding(responseBuffer.trim(), prompt, runtimeContext),
    ))
    if (result.hadError) {
    const helpMsg = "\n\nTo switch models, use `/use-provider` and `/use-model`"
    if (text && streamedLength === 0) {
      await sendFinalAskResponse(run.applicationId, run.token, threadIdForFollowups, text)
      await sendFollowup(run.applicationId, run.token, helpMsg.trim(), undefined, threadIdForFollowups)
    } else if (text) {
      await sendFollowup(run.applicationId, run.token, helpMsg.trim(), undefined, threadIdForFollowups)
    } else {
      await sendFinalAskResponse(run.applicationId, run.token, threadIdForFollowups, `Error occurred.${helpMsg}`)
    }
    } else if (!text) {
      const suffix = toolEvents > 0 ? ` (${toolEvents} tool${toolEvents > 1 ? "s" : ""})` : ""
      await sendFinalAskResponse(run.applicationId, run.token, threadIdForFollowups, `Done${suffix}.`)
    }

    const fileLines = (result.filesEdited || []).slice(0, 10).map((file) => `- \`${file}\``)
    const filesSummary = result.filesEdited && result.filesEdited.length > 0
      ? `${fileLines.join("\n")}${result.filesEdited.length > 10 ? `\n- and ${result.filesEdited.length - 10} more` : ""}`
      : "No file edits reported"

    await sendFollowup(
      run.applicationId,
      run.token,
      "",
      undefined,
      threadIdForFollowups,
      [
        {
          title: "Run Summary",
          description: usageFooter || "Usage not reported",
          fields: [
            {
              name: "Files Edited",
              value: clipEmbedDescription(filesSummary, 1024),
            },
          ],
        },
      ],
    )

    await updateOriginalResponse(
      run.applicationId,
      run.token,
      commandIsInThread ? "Done." : `Response posted in <#${threadIdForFollowups || channelId}>.`,
    )
    logAskStage("execute_done", {
      threadId: conversationId,
      interactionId: run.interactionId,
      elapsedMs: Date.now() - startedAt,
    })
  } catch (error) {
    logAskStage("execute_error", {
      threadId: run.channelId,
      interactionId: run.interactionId,
      elapsedMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    })
    console.error("executeQueuedAskRun failed:", error)
    const message = (error instanceof Error
      ? error.message
      : typeof error === "object" && error !== null
        ? JSON.stringify(error)
        : String(error)).slice(0, 1500)
    try {
      await updateOriginalResponse(run.applicationId, run.token, `Request failed: ${message}`)
    } catch (followupError) {
      console.error("Failed to send fallback followup:", followupError)
      await sendFollowup(run.applicationId, run.token, `Request failed: ${message}`)
    }
  }
}

async function processAskInteraction(interaction: Interaction, prompt: string, origin?: string): Promise<void> {
  try {
    let channelId = interaction.channel_id
    const userId = getInteractionUserId(interaction)

    if (!channelId || !userId) {
      await sendFollowup(
        interaction.application_id,
        interaction.token,
        !channelId ? "Missing channel ID." : "Missing user ID.",
      )
      return
    }

    const [{ ThreadRuntimeStore }] = await Promise.all([
      import("../../src/thread-runtime-store.js"),
    ])

    logAskStage("ask_start", {
      threadId: channelId,
      interactionId: interaction.id,
    })

    const runtimeStore = new ThreadRuntimeStore()
    let runtimeState = await runtimeStore.get(channelId)

    if (!runtimeState.sandboxId) {
      logAskStage("ask_no_session_autostart", { threadId: channelId, interactionId: interaction.id })
      const rawBaselineSnapshotId = await ensureRawBaselineSnapshot()
      const threadId = await createThreadFromChannel(channelId, "OpenCode Session")
      if (!threadId) {
        await sendFollowup(interaction.application_id, interaction.token, "Failed to create thread for /ask.")
        return
      }
      await startThreadSession(threadId, undefined, "main", {
        snapshotId: rawBaselineSnapshotId,
        resetSessions: true,
      })
      runtimeState = await runtimeStore.get(threadId)
      if (!runtimeState.sandboxId) {
        await sendFollowup(interaction.application_id, interaction.token, "Failed to start session for /ask.")
        return
      }
      channelId = threadId
    }

    const statusMessage = "Processing..."

    await updateOriginalResponse(interaction.application_id, interaction.token, statusMessage)
    logAskStage("ask_executing", { threadId: channelId, interactionId: interaction.id })
    await executeQueuedAskRun({
      interactionId: interaction.id,
      applicationId: interaction.application_id,
      token: interaction.token,
      channelId: channelId,
      userId: userId,
      prompt: prompt,
    })
    logAskStage("ask_done", { threadId: channelId, interactionId: interaction.id })
  } catch (error) {
    logAskStage("enqueue_error", {
      threadId: interaction.channel_id,
      interactionId: interaction.id,
      error: error instanceof Error ? error.message : String(error),
    })
    console.error("processAskInteraction failed:", error)
    const message = error instanceof Error ? error.message : "Unknown error"
    await updateOriginalResponse(interaction.application_id, interaction.token, `Request failed: ${message}`)
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
    const internalSignatureHeader = req.headers["x-opencode-internal-signature"]
    const internalTimestampHeader = req.headers["x-opencode-internal-timestamp"]
    const internalSignature = Array.isArray(internalSignatureHeader) ? internalSignatureHeader[0] || "" : internalSignatureHeader || ""
    const internalTimestamp = Array.isArray(internalTimestampHeader) ? internalTimestampHeader[0] || "" : internalTimestampHeader || ""

    if (internalSignature && internalTimestamp && verifyInternalDispatch(body, internalTimestamp, internalSignature)) {
      await sendNodeResponse(res, json({ ok: true }))
      return
    }

    const signatureHeader = req.headers["x-signature-ed25519"]
    const timestampHeader = req.headers["x-signature-timestamp"]
    const signature = Array.isArray(signatureHeader) ? signatureHeader[0] || "" : signatureHeader || ""
    const timestamp = Array.isArray(timestampHeader) ? timestampHeader[0] || "" : timestampHeader || ""
    const origin = getRequestOrigin(req)

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

    const [{ mapInteractionCommandToText }, { parseDiscordCommand }, { ChannelStateStore }, { CredentialStore }, { handleDiscordCommand }, { SelectionStore }, { OAuthTokenStore }] = await Promise.all([
      import("../../src/interaction-command-mapper.js"),
      import("../../src/command-parser.js"),
      import("../../src/channel-state-store.js"),
      import("../../src/credential-store.js"),
      import("../../src/discord-command-service.js"),
      import("../../src/selection-store.js"),
      import("../../src/oauth-token-store.js"),
    ])

    const mapped = mapInteractionCommandToText(interaction.data)
    const parsed = parseDiscordCommand(mapped.text)

    if (mapped.type === "prompt") {
      waitUntil(processAskInteraction(interaction, mapped.text, origin))
      await sendNodeResponse(res, json({ type: 5 }))
      return
    }

    if (parsed.type === "opencode") {
      waitUntil(processOpencodeCommandInteraction(interaction, parsed.project, parsed.prompt))
      await sendNodeResponse(res, json({ type: 5 }))
      return
    }

    if (mapped.text.startsWith("auth-connect") || mapped.text.startsWith("auth connect")) {
      waitUntil(processAuthConnectInteraction(interaction, mapped.text))
      await sendNodeResponse(res, json({ type: 5 }))
      return
    }

    if (mapped.text === "update") {
      waitUntil(processUpdateInteraction(interaction))
      await sendNodeResponse(res, json({ type: 5 }))
      return
    }

    const { loadProviderRegistry } = await import("../../src/provider-registry-store.js")
    const registry = await loadProviderRegistry()
    const stateStore = new ChannelStateStore()
    const credentials = new CredentialStore()
    const selectionStore = new SelectionStore()
    const oauthStore = new OAuthTokenStore()
    const userId = getInteractionUserId(interaction)
    const currentChannelId = interaction.channel_id || "dm"
    const inThread = interaction.channel_id ? await isThreadChannel(interaction.channel_id) : false

    if (parsed.type === "config") {
      if (!userId) {
        await sendChunkedInteractionResponse(interaction, res, "Missing user ID.")
        return
      }

      const userDefaults = await selectionStore.getUserDefaults(userId)
      const threadSelection = inThread ? await selectionStore.getThreadSelection(currentChannelId) : undefined
      const selection = await selectionStore.resolveSelection(userId, inThread ? currentChannelId : undefined)

      const providerId = selection?.providerId
      const modelId = selection?.modelId

      let authLine = "Auth: provider not set"
      if (providerId) {
        const oauthPayload = await oauthStore.getUserProviderAuth(userId, providerId)
        const provider = registry.getProvider(providerId)
        const supportsOAuth = Boolean(provider?.methods.some((method) => method.kind === "oauth"))

        if (oauthPayload) {
          authLine = "Auth: authenticated via OAuth"
        } else if (hasProviderApiKey(providerId)) {
          authLine = "Auth: API key configured in env"
        } else if (supportsOAuth) {
          authLine = `Auth: not authenticated (run /auth-connect ${providerId})`
        } else {
          authLine = `Auth: not configured (set ${providerId.toUpperCase().replace(/[^A-Z0-9]/g, "_")}_API_KEY)`
        }
      }

      const scopeLine = inThread
        ? `Scope: thread (${threadSelection?.providerId ? "thread override" : "inherits user default"})`
        : "Scope: user default"

      const lines = [
        "Current config:",
        `- Provider: ${providerId || "not set"}`,
        `- Model: ${modelId || "not set"}`,
        `- ${authLine}`,
        `- ${scopeLine}`,
      ]

      if (!providerId) {
        lines.push("- Next step: run /use-provider <provider>")
      } else if (!modelId) {
        lines.push("- Next step: run /use-model <model>")
      }

      if (inThread && userDefaults?.providerId) {
        lines.push(`- User default: ${userDefaults.providerId}/${userDefaults.modelId || "(model not set)"}`)
      }

      await sendChunkedInteractionResponse(interaction, res, lines.join("\n"))
      return
    }

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
      if (inThread && !userDefaults?.providerId) {
        await sendChunkedInteractionResponse(
          interaction,
          res,
          "No default provider configured. Run `/use-provider <provider>` in a normal channel first.",
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
      if (inThread && !userDefaults?.providerId) {
        await sendChunkedInteractionResponse(
          interaction,
          res,
          "No default provider configured. Run `/use-provider <provider>` in a normal channel first.",
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

    if (commandResult.message === "checkpoint:sandbox") {
      waitUntil(processCheckpointInteraction(interaction, currentChannelId, inThread))
      await sendNodeResponse(res, json({ type: 5 }))
      return
    }

    if (commandResult.message === "delete:sandbox") {
      waitUntil(processDeleteInteraction(interaction, currentChannelId, inThread))
      await sendNodeResponse(res, json({ type: 5 }))
      return
    }

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
