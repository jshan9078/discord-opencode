import { randomUUID } from "crypto"
import { del, get, put } from "@vercel/blob"

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

function threadLockPath(threadId: string): string {
  return `runtime/thread-locks/${threadId}.json`
}

async function readRunLock(threadId: string): Promise<ThreadRunLock | undefined> {
  try {
    const result = await get(threadLockPath(threadId), { access: "private" })
    if (!result || !("stream" in result)) {
      return undefined
    }

    const parsed = JSON.parse(await new Response(result.stream).text()) as Partial<ThreadRunLock>
    if (!parsed || typeof parsed !== "object") {
      return undefined
    }

    const runId = typeof parsed.runId === "string" ? parsed.runId : ""
    const startedAt = Number(parsed.startedAt || 0)
    const expiresAt = Number(parsed.expiresAt || 0)
    const interactionId = typeof parsed.interactionId === "string" ? parsed.interactionId : undefined
    if (!runId || !startedAt || !expiresAt) {
      return undefined
    }

    return { runId, interactionId, startedAt, expiresAt }
  } catch {
    return undefined
  }
}

async function writeRunLock(
  threadId: string,
  runLock: ThreadRunLock,
  caller: string,
): Promise<void> {
  requireBlobToken()
  const existingLock = await readRunLock(threadId).catch(() => undefined)
  console.info("lock.write", {
    threadId,
    caller,
    newRunId: runLock.runId,
    newExpiresAt: runLock.expiresAt,
    existingRunId: existingLock?.runId,
    existingExpiresAt: existingLock?.expiresAt,
  })
  await put(threadLockPath(threadId), JSON.stringify(runLock), {
    access: "private",
    allowOverwrite: true,
    contentType: "application/json",
    cacheControlMaxAge: 0,
  })
}

export class ThreadRuntimeStore {
  async get(threadId: string): Promise<ThreadRuntimeState> {
    requireBlobToken()

    try {
      const [result, separateRunLock] = await Promise.all([
        get(threadPath(threadId), { access: "private" }),
        readRunLock(threadId),
      ])
      if (!result || !("stream" in result)) {
        return { updatedAt: Date.now(), runLock: separateRunLock }
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
          runLock: separateRunLock ?? (parsed.runLock && typeof parsed.runLock === "object"
            ? {
                runId: String(parsed.runLock.runId || ""),
                startedAt: Number(parsed.runLock.startedAt || 0),
                expiresAt: Number(parsed.runLock.expiresAt || 0),
              }
            : undefined),
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
        sandboxId: state.sandboxId,
        opencodePassword: state.opencodePassword,
        sessionId: state.sessionId,
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

  async setSandbox(
    threadId: string,
    sandboxId: string,
    opencodePassword: string,
    options?: { clearSession?: boolean },
  ): Promise<void> {
    console.log(`[ThreadRuntimeStore] setSandbox threadId=${threadId}, sandboxId=${sandboxId}`)
    const next: Partial<ThreadRuntimeState> = {
      sandboxId,
      opencodePassword,
    }
    if (options?.clearSession) {
      next.sessionId = undefined
    }
    await this.patch(threadId, next)
    console.log(`[ThreadRuntimeStore] setSandbox completed for threadId=${threadId}`)
  }

  async clear(threadId: string): Promise<void> {
    requireBlobToken()
    await Promise.all([
      put(threadPath(threadId), JSON.stringify({}), {
        access: "private",
        allowOverwrite: true,
        contentType: "application/json",
      }),
      del(threadLockPath(threadId)).catch(() => undefined),
    ])
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
    console.info("lock.acquire_check", {
      threadId,
      hasExistingLock: Boolean(current.runLock),
      existingExpiresAt: current.runLock?.expiresAt,
      expiresAtThreshold: now,
      wouldBlock: current.runLock && current.runLock.expiresAt > now,
    })
    if (current.runLock && current.runLock.expiresAt > now) {
      if (interactionId && current.runLock.interactionId && current.runLock.interactionId === interactionId) {
        return { acquired: false, duplicate: true }
      }
      return { acquired: false }
    }

    const runId = randomUUID()
    await writeRunLock(threadId, {
      runId,
      interactionId,
      startedAt: now,
      expiresAt: now + ttlMs,
    }, "acquireRunLock")

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
    await writeRunLock(threadId, {
      ...current.runLock,
      startedAt: current.runLock.startedAt,
      expiresAt: now + ttlMs,
    }, "refreshRunLock")

    return true
  }

  async releaseRunLock(threadId: string, runId: string): Promise<void> {
    const current = await this.get(threadId)
    if (!current.runLock || current.runLock.runId !== runId) {
      return
    }

    console.info("lock.release", { threadId, runId })

    try {
      await put(threadLockPath(threadId), JSON.stringify({
        runId: "released",
        releasedAt: Date.now(),
        expiresAt: Date.now() - 1,
      }), {
        access: "private",
        allowOverwrite: true,
        contentType: "application/json",
        cacheControlMaxAge: 0,
      })
      console.info("lock.released_marker_written", { threadId, runId })
    } catch (err) {
      console.error("lock.release_failed", { threadId, runId, error: String(err) })
    }
  }
}
