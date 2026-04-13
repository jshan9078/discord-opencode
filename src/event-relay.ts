/**
 * Streams SSE events from OpenCode session and relays to Discord sink.
 * Handles text deltas, tool activity, questions, permissions, errors.
 */
export interface EventEnvelope {
  type: string
  sessionID?: string
  properties?: Record<string, unknown>
}

export interface EventStreamClient {
  event: {
    subscribe(input?: { signal?: AbortSignal }): {
      stream: AsyncIterable<EventEnvelope>
    }
  }
}

export interface EventRelaySink {
  onTextDelta(text: string): Promise<void>
  onReasoningDelta?(payload: { partId: string; text: string; completed?: boolean }): Promise<void>
  onToolActivity(message: string): Promise<void>
  onToolRequest?(payload: {
    toolCallId?: string
    toolName: string
    requestSummary?: string
    requestRaw?: unknown
  }): Promise<void>
  onToolResult?(payload: {
    toolCallId?: string
    toolName: string
    status?: "completed" | "error"
    resultSummary?: string
    resultRaw?: unknown
  }): Promise<void>
  onQuestion(message: string): Promise<void>
  onPermission(message: string): Promise<void>
  onError(message: string): Promise<void>
}

export interface EventRelayOptions {
  signal?: AbortSignal
  maxIdleMs?: number
  maxTotalMs?: number
}

export interface EventRelayResult {
  completed: boolean
  timedOut: boolean
  reason: "session_complete" | "idle_timeout" | "total_timeout" | "aborted"
  hadError: boolean
  filesEdited?: string[]
  usage?: {
    providerId: string
    modelId: string
    cost: number
    tokens: {
      total?: number
      input: number
      output: number
      reasoning: number
      cache: {
        read: number
        write: number
      }
    }
  }
}

function asText(value: unknown): string {
  if (typeof value === "string") {
    return value
  }
  return ""
}

function asBoolean(value: unknown): boolean {
  return typeof value === "boolean" ? value : false
}

function asStatus(value: unknown): string {
  return typeof value === "string" ? value.toLowerCase() : ""
}

function toSummary(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value
  }
  if (value && typeof value === "object") {
    try {
      return JSON.stringify(value)
    } catch {
      return undefined
    }
  }
  return undefined
}

function firstDefined(...values: Array<unknown>): unknown {
  return values.find((value) => value !== undefined)
}

function asNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" ? value as Record<string, unknown> : undefined
}

function asUsage(value: unknown): EventRelayResult["usage"] | undefined {
  if (!value || typeof value !== "object") {
    return undefined
  }

  const info = value as Record<string, unknown>
  const providerId = asText(info.providerID)
  const modelId = asText(info.modelID)
  const tokensValue = info.tokens
  if (!providerId || !modelId || !tokensValue || typeof tokensValue !== "object") {
    return undefined
  }

  const tokens = tokensValue as Record<string, unknown>
  const cache = (tokens.cache && typeof tokens.cache === "object") ? tokens.cache as Record<string, unknown> : {}

  return {
    providerId,
    modelId,
    cost: asNumber(info.cost),
    tokens: {
      total: typeof tokens.total === "number" ? tokens.total : undefined,
      input: asNumber(tokens.input),
      output: asNumber(tokens.output),
      reasoning: asNumber(tokens.reasoning),
      cache: {
        read: asNumber(cache.read),
        write: asNumber(cache.write),
      },
    },
  }
}

function extractTextFromMessageUpdated(properties: Record<string, unknown> | undefined): string {
  if (!properties) {
    return ""
  }

  const direct = asText(firstDefined(properties.text, properties.content))
  if (direct) {
    return direct
  }

  const part = properties.part
  if (part && typeof part === "object") {
    const partText = asText((part as Record<string, unknown>).text)
    if (partText) {
      return partText
    }
  }

  const extractFromParts = (partsValue: unknown): string => {
    if (!Array.isArray(partsValue)) {
      return ""
    }
    const chunks = partsValue
      .map((item) => {
        if (!item || typeof item !== "object") {
          return ""
        }
        const row = item as Record<string, unknown>
        return row.type === "text" ? asText(row.text) : ""
      })
      .filter(Boolean)
    return chunks.join("")
  }

  const fromParts = extractFromParts(properties.parts)
  if (fromParts) {
    return fromParts
  }

  const message = properties.message
  if (message && typeof message === "object") {
    const msg = message as Record<string, unknown>
    const msgText = asText(firstDefined(msg.text, msg.content))
    if (msgText) {
      return msgText
    }
    return extractFromParts(msg.parts)
  }

  return ""
}

export function isTerminalSessionEvent(event: EventEnvelope, hadError = false): boolean {
  if (event.type === "session.completed" || event.type === "session.idle") {
    return true
  }

  if (event.type === "message.updated") {
    const status = asStatus(event.properties?.status)
    if (["complete", "completed", "done", "finished"].includes(status)) {
      return true
    }
    if (asBoolean(event.properties?.done)) {
      return true
    }
  }

  if (event.type === "response.completed" || event.type === "prompt.completed") {
    return true
  }

  if (hadError && (event.type === "message.updated" || event.type === "response.completed")) {
    return true
  }

  return false
}

export async function relaySessionEvents(
  client: EventStreamClient,
  sink: EventRelaySink,
  sessionId: string,
  options: EventRelayOptions = {},
): Promise<EventRelayResult> {
  const maxIdleMs = options.maxIdleMs ?? 45_000
  const maxTotalMs = options.maxTotalMs ?? 10 * 60_000

  const startedAt = Date.now()
  let lastEventAt = startedAt

  const timeoutController = new AbortController()
  const externalSignal = options.signal

  const abort = () => timeoutController.abort()
  if (externalSignal) {
    if (externalSignal.aborted) {
      abort()
    } else {
      externalSignal.addEventListener("abort", abort, { once: true })
    }
  }

  let timeoutReason: EventRelayResult["reason"] | null = null

  const watchdog = setInterval(() => {
    const now = Date.now()
    if (now - startedAt >= maxTotalMs) {
      timeoutReason = "total_timeout"
      timeoutController.abort()
      return
    }
    if (now - lastEventAt >= maxIdleMs) {
      timeoutReason = "idle_timeout"
      timeoutController.abort()
    }
  }, 500)

  const events = client.event.subscribe({ signal: timeoutController.signal })

  let hadError = false
  let usage: EventRelayResult["usage"]
  const filesEdited = new Set<string>()
  let sawTextDelta = false
  let emittedFallbackText = false
  const lastTextByPart = new Map<string, string>()
  const partTypeById = new Map<string, string>()
  const pendingDeltaByPart = new Map<string, string[]>()
  const toolStatusByPart = new Map<string, string>()

  try {
    for await (const event of events.stream) {
      if (timeoutController.signal.aborted) {
        break
      }

      if (event.sessionID && event.sessionID !== sessionId) {
        continue
      }

      lastEventAt = Date.now()

      if (isTerminalSessionEvent(event, hadError)) {
        return {
          completed: true,
          timedOut: false,
          reason: "session_complete",
          hadError,
          filesEdited: [...filesEdited],
          usage,
        }
      }

      if (event.type === "message.part.delta") {
        const partId = asText(event.properties?.partID)
        const delta = asText(event.properties?.delta)
        if (!delta) {
          continue
        }

        const partType = partId ? partTypeById.get(partId) : undefined
        if (partType === "reasoning") {
          if (sink.onReasoningDelta) {
            await sink.onReasoningDelta({ partId: partId || "", text: delta })
          }
          if (partId) {
            const key = `reasoning:${partId}`
            lastTextByPart.set(key, (lastTextByPart.get(key) || "") + delta)
          }
          continue
        }

        if (partType === "text") {
          sawTextDelta = true
          await sink.onTextDelta(delta)
          continue
        }

        if (partId) {
          const pending = pendingDeltaByPart.get(partId) || []
          pending.push(delta)
          pendingDeltaByPart.set(partId, pending)
        }
        continue
      }

      if (event.type === "message.part.updated") {
        const part = (event.properties?.part && typeof event.properties.part === "object")
          ? event.properties.part as Record<string, unknown>
          : undefined
        const partId = asText(firstDefined(part?.id, part?.partID, event.properties?.partID))
        const partType = asText(part?.type)

        if (partId && partType) {
          partTypeById.set(partId, partType)
        }

        if (partId) {
          const pending = pendingDeltaByPart.get(partId)
          if (pending && pending.length > 0) {
            if (partType === "text") {
              sawTextDelta = true
              await sink.onTextDelta(pending.join(""))
            } else if (partType === "reasoning" && sink.onReasoningDelta) {
              await sink.onReasoningDelta({ partId, text: pending.join("") })
            }
            pendingDeltaByPart.delete(partId)
          }
        }

        if (part?.type === "text") {
          const nextText = asText(part.text)
          if (nextText) {
            if (sawTextDelta) {
              lastTextByPart.set(partId || "", nextText)
            } else {
              const previous = lastTextByPart.get(partId || "") || ""
              if (nextText.length > previous.length && nextText.startsWith(previous)) {
                await sink.onTextDelta(nextText.slice(previous.length))
              } else if (nextText !== previous) {
                await sink.onTextDelta(nextText)
              }
              lastTextByPart.set(partId || "", nextText)
            }
          }
        }

        if (part?.type === "reasoning" && sink.onReasoningDelta && partId) {
          const nextText = asText(part.text)
          const previous = lastTextByPart.get(`reasoning:${partId}`) || ""

          if (nextText.length > previous.length && nextText.startsWith(previous)) {
            const delta = nextText.slice(previous.length)
            if (delta) {
              await sink.onReasoningDelta({ partId, text: delta })
            }
          } else if (nextText && nextText !== previous) {
            await sink.onReasoningDelta({ partId, text: nextText })
          }

          lastTextByPart.set(`reasoning:${partId}`, nextText)

          const time = part.time && typeof part.time === "object" ? part.time as Record<string, unknown> : undefined
          if (typeof time?.end === "number") {
            await sink.onReasoningDelta({ partId, text: "", completed: true })
          }
        }

        if (part?.type === "patch") {
          const files = Array.isArray(part.files) ? part.files : []
          for (const file of files) {
            if (typeof file === "string" && file.trim()) {
              filesEdited.add(file)
            }
          }
        }

        const tool = asText(
          firstDefined(
            part?.tool,
            event.properties?.toolName,
            event.properties?.name,
            event.properties?.tool,
          ),
        )
        if (tool) {
          const toolPartId = asText(part?.id)
          const toolCallId = asText(
            firstDefined(
              part?.callID,
              event.properties?.toolCallId,
              event.properties?.callId,
              event.properties?.id,
            ),
          )
          const state = asRecord(part?.state)
          const status = asText(state?.status)
          const previousStatus = toolPartId ? toolStatusByPart.get(toolPartId) : undefined

          if (toolPartId && status) {
            toolStatusByPart.set(toolPartId, status)
          }

          if (status === "running") {
            if (status !== previousStatus) {
              await sink.onToolActivity(`Running tool: ${tool}`)
              if (sink.onToolRequest) {
                const requestRaw = firstDefined(
                  state?.input,
                  state?.raw,
                  event.properties?.input,
                  event.properties?.args,
                  event.properties?.arguments,
                  event.properties?.command,
                )
                await sink.onToolRequest({
                  toolCallId: toolCallId || undefined,
                  toolName: tool,
                  requestSummary: toSummary(requestRaw),
                  requestRaw,
                })
              }
            }
          } else if (status === "completed" || status === "error") {
            if (status !== previousStatus) {
              if (sink.onToolResult) {
                const resultRaw = status === "completed"
                  ? firstDefined(state?.output, state?.title, event.properties?.result, event.properties?.output)
                  : firstDefined(state?.error, event.properties?.error)
                await sink.onToolResult({
                  toolCallId: toolCallId || undefined,
                  toolName: tool,
                  status,
                  resultSummary: toSummary(resultRaw),
                  resultRaw,
                })
              }
            }
          } else {
            await sink.onToolActivity(`Running tool: ${tool}`)
          }
        }
        continue
      }

      if (event.type === "question.asked") {
        await sink.onQuestion(asText(event.properties?.message) || "Agent asked a question.")
        continue
      }

      if (event.type === "permission.asked") {
        await sink.onPermission(asText(event.properties?.message) || "Agent requested permission.")
        continue
      }

      if (event.type === "session.error") {
        const errorMsg = asText(event.properties?.error) || "Session error"
        await sink.onError(errorMsg)
        hadError = true
        continue
      }

      if (event.type === "message.updated") {
        const status = asStatus(event.properties?.status)
        if (!sawTextDelta && !emittedFallbackText && ["complete", "completed", "done", "finished"].includes(status)) {
          const finalText = extractTextFromMessageUpdated(event.properties)
          if (finalText) {
            emittedFallbackText = true
            await sink.onTextDelta(finalText)
          }
        }

        const nextUsage = asUsage(firstDefined(event.properties?.info, (event as unknown as Record<string, unknown>).info))
        if (nextUsage) {
          usage = nextUsage
        }
      }
    }
  } finally {
    clearInterval(watchdog)
    if (externalSignal) {
      externalSignal.removeEventListener("abort", abort)
    }
  }

  if (timeoutReason === "idle_timeout" || timeoutReason === "total_timeout") {
    return {
      completed: false,
      timedOut: true,
      reason: timeoutReason,
      hadError,
      filesEdited: [...filesEdited],
      usage,
    }
  }

  return {
    completed: false,
    timedOut: false,
    reason: "aborted",
    hadError,
    filesEdited: [...filesEdited],
    usage,
  }
}
