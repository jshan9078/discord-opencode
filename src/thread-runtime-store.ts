import { randomUUID } from "crypto"
import { get, put } from "@vercel/blob"

export interface ThreadRunLock {
  runId: string
  startedAt: number
  expiresAt: number
}

export interface ThreadRuntimeState {
  sandboxId?: string
  opencodePassword?: string
  sessionByProfile?: Record<string, string>
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

function profileKey(providerId: string, modelId: string): string {
  return `${providerId}:${modelId}`
}

export class ThreadRuntimeStore {
  async get(threadId: string): Promise<ThreadRuntimeState> {
    requireBlobToken()

    try {
      const result = await get(threadPath(threadId), { access: "private" })
      if (!result || !("stream" in result)) {
        return { updatedAt: Date.now(), sessionByProfile: {} }
      }

      const text = await new Response(result.stream).text()
      const parsed = JSON.parse(text) as Partial<ThreadRuntimeState>

      return {
        sandboxId: typeof parsed.sandboxId === "string" ? parsed.sandboxId : undefined,
        opencodePassword: typeof parsed.opencodePassword === "string" ? parsed.opencodePassword : undefined,
        sessionByProfile: parsed.sessionByProfile && typeof parsed.sessionByProfile === "object"
          ? parsed.sessionByProfile
          : {},
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
      return { updatedAt: Date.now(), sessionByProfile: {} }
    }
  }

  async set(threadId: string, state: ThreadRuntimeState): Promise<void> {
    requireBlobToken()
    await put(
      threadPath(threadId),
      JSON.stringify({
        ...state,
        sessionByProfile: state.sessionByProfile || {},
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
      sessionByProfile: patch.sessionByProfile || current.sessionByProfile || {},
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

  async getSessionForProfile(threadId: string, providerId: string, modelId: string): Promise<string | undefined> {
    const state = await this.get(threadId)
    return state.sessionByProfile?.[profileKey(providerId, modelId)]
  }

  async setSessionForProfile(
    threadId: string,
    providerId: string,
    modelId: string,
    sessionId: string,
  ): Promise<void> {
    const state = await this.get(threadId)
    const key = profileKey(providerId, modelId)
    await this.set(threadId, {
      ...state,
      sessionByProfile: {
        ...(state.sessionByProfile || {}),
        [key]: sessionId,
      },
      updatedAt: Date.now(),
    })
  }

  async clearSessions(threadId: string): Promise<void> {
    const state = await this.get(threadId)
    await this.set(threadId, {
      ...state,
      sessionByProfile: {},
      updatedAt: Date.now(),
    })
  }

  async acquireRunLock(threadId: string, ttlMs = 15 * 60_000): Promise<{ acquired: boolean; runId?: string }> {
    const current = await this.get(threadId)
    const now = Date.now()
    if (current.runLock && current.runLock.expiresAt > now) {
      return { acquired: false }
    }

    const runId = randomUUID()
    await this.set(threadId, {
      ...current,
      runLock: {
        runId,
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
