import { randomUUID } from "crypto"
import { get, put } from "@vercel/blob"

export interface ThreadRunLock {
  runId: string
  interactionId?: string
  startedAt: number
  expiresAt: number
}

export interface ThreadRuntimeState {
  sandboxId?: string
  opencodePassword?: string
  sessionId?: string
  runLock?: ThreadRunLock
  updatedAt: number
}

function requireBlobToken(): void {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    throw new Error("BLOB_READ_WRITE_TOKEN is required for thread runtime storage.")
  }
}

function threadPath(threadId: string): string {
  return `runtime/threads/${threadId}.json`
}

export class ThreadRuntimeStore {
  async get(threadId: string): Promise<ThreadRuntimeState> {
    requireBlobToken()

    try {
      const result = await get(threadPath(threadId), { access: "private" })
      if (!result || !("stream" in result)) {
        return { updatedAt: Date.now() }
      }

      const text = await new Response(result.stream).text()
      const parsed = JSON.parse(text) as Partial<ThreadRuntimeState> & { sessionByProfile?: Record<string, string> }
      const legacySessionId = parsed.sessionByProfile && typeof parsed.sessionByProfile === "object"
        ? Object.values(parsed.sessionByProfile).find((value): value is string => typeof value === "string" && value.length > 0)
        : undefined

      return {
        sandboxId: typeof parsed.sandboxId === "string" ? parsed.sandboxId : undefined,
        opencodePassword: typeof parsed.opencodePassword === "string" ? parsed.opencodePassword : undefined,
        sessionId: typeof parsed.sessionId === "string" ? parsed.sessionId : legacySessionId,
        runLock: parsed.runLock && typeof parsed.runLock === "object"
          ? {
              runId: String(parsed.runLock.runId || ""),
              startedAt: Number(parsed.runLock.startedAt || 0),
              expiresAt: Number(parsed.runLock.expiresAt || 0),
            }
          : undefined,
        updatedAt: Number(parsed.updatedAt || Date.now()),
      }
    } catch {
      return { updatedAt: Date.now() }
    }
  }

  async set(threadId: string, state: ThreadRuntimeState): Promise<void> {
    requireBlobToken()
    await put(
      threadPath(threadId),
      JSON.stringify({
        ...state,
        updatedAt: Date.now(),
      }),
      {
        access: "private",
        allowOverwrite: true,
        contentType: "application/json",
      },
    )
  }

  async patch(threadId: string, patch: Partial<ThreadRuntimeState>): Promise<ThreadRuntimeState> {
    const current = await this.get(threadId)
    const next: ThreadRuntimeState = {
      ...current,
      ...patch,
      updatedAt: Date.now(),
    }
    await this.set(threadId, next)
    return next
  }

  async setSandbox(threadId: string, sandboxId: string, opencodePassword: string): Promise<void> {
    await this.patch(threadId, { sandboxId, opencodePassword })
  }

  async clear(threadId: string): Promise<void> {
    requireBlobToken()
    await put(threadPath(threadId), JSON.stringify({}), {
      access: "private",
      allowOverwrite: true,
      contentType: "application/json",
    })
  }

  async getSession(threadId: string): Promise<string | undefined> {
    const state = await this.get(threadId)
    return state.sessionId
  }

  async setSession(threadId: string, sessionId: string): Promise<void> {
    const state = await this.get(threadId)
    await this.set(threadId, {
      ...state,
      sessionId,
      updatedAt: Date.now(),
    })
  }

  async clearSession(threadId: string): Promise<void> {
    const state = await this.get(threadId)
    await this.set(threadId, {
      ...state,
      sessionId: undefined,
      updatedAt: Date.now(),
    })
  }

  async acquireRunLock(
    threadId: string,
    ttlMs = 15 * 60_000,
    interactionId?: string,
  ): Promise<{ acquired: boolean; runId?: string; duplicate?: boolean }> {
    const current = await this.get(threadId)
    const now = Date.now()
    if (current.runLock && current.runLock.expiresAt > now) {
      if (interactionId && current.runLock.interactionId && current.runLock.interactionId === interactionId) {
        return { acquired: false, duplicate: true }
      }
      return { acquired: false }
    }

    const runId = randomUUID()
    await this.set(threadId, {
      ...current,
      runLock: {
        runId,
        interactionId,
        startedAt: now,
        expiresAt: now + ttlMs,
      },
      updatedAt: now,
    })

    const confirmed = await this.get(threadId)
    if (confirmed.runLock?.runId !== runId) {
      return { acquired: false }
    }

    return { acquired: true, runId }
  }

  async refreshRunLock(threadId: string, runId: string, ttlMs = 90_000): Promise<boolean> {
    const current = await this.get(threadId)
    if (!current.runLock || current.runLock.runId !== runId) {
      return false
    }

    const now = Date.now()
    await this.set(threadId, {
      ...current,
      runLock: {
        ...current.runLock,
        startedAt: current.runLock.startedAt,
        expiresAt: now + ttlMs,
      },
      updatedAt: now,
    })

    return true
  }

  async releaseRunLock(threadId: string, runId: string): Promise<void> {
    const current = await this.get(threadId)
    if (!current.runLock || current.runLock.runId !== runId) {
      return
    }

    await this.set(threadId, {
      ...current,
      runLock: undefined,
      updatedAt: Date.now(),
    })
  }
}
