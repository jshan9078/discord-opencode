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

export function isTerminalSessionEvent(event: EventEnvelope): boolean {
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

  try {
    for await (const event of events.stream) {
      if (timeoutController.signal.aborted) {
        break
      }

      if (event.sessionID && event.sessionID !== sessionId) {
        continue
      }

      lastEventAt = Date.now()

      if (isTerminalSessionEvent(event)) {
        return {
          completed: true,
          timedOut: false,
          reason: "session_complete",
        }
      }

      if (event.type === "message.part.delta") {
        await sink.onTextDelta(asText(event.properties?.text))
        continue
      }

      if (event.type === "message.part.updated") {
        const tool = asText(
          firstDefined(
            event.properties?.toolName,
            event.properties?.name,
            event.properties?.tool,
          ),
        )
        if (tool) {
          await sink.onToolActivity(`Running tool: ${tool}`)

          const requestRaw = firstDefined(
            event.properties?.input,
            event.properties?.args,
            event.properties?.arguments,
            event.properties?.command,
          )
          const resultRaw = firstDefined(
            event.properties?.result,
            event.properties?.output,
            event.properties?.toolResult,
          )
          const toolCallId = asText(
            firstDefined(
              event.properties?.toolCallId,
              event.properties?.callId,
              event.properties?.id,
            ),
          )

          if (resultRaw !== undefined && sink.onToolResult) {
            await sink.onToolResult({
              toolCallId: toolCallId || undefined,
              toolName: tool,
              resultSummary: toSummary(resultRaw),
              resultRaw,
            })
          } else if (sink.onToolRequest) {
            await sink.onToolRequest({
              toolCallId: toolCallId || undefined,
              toolName: tool,
              requestSummary: toSummary(requestRaw),
              requestRaw,
            })
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
        await sink.onError(asText(event.properties?.error) || "Session error")
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
    }
  }

  return {
    completed: false,
    timedOut: false,
    reason: "aborted",
  }
}
