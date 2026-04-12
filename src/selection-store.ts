/**
 * Stores user default provider/model selections and thread overrides in Vercel Blob.
 */
import { get, put } from "@vercel/blob"

export interface SelectionConfig {
  providerId?: string
  modelId?: string
}

function requireBlobToken(): void {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    throw new Error("BLOB_READ_WRITE_TOKEN is required for provider/model selection storage.")
  }
}

function userPath(userId: string): string {
  return `preferences/users/${userId}.json`
}

function threadPath(threadId: string): string {
  return `preferences/threads/${threadId}.json`
}

async function readJson(path: string): Promise<SelectionConfig | undefined> {
  requireBlobToken()
  try {
    const result = await get(path, { access: "private" })
    if (!result) {
      return undefined
    }

    const hasStream = typeof result === "object" && "stream" in result
    if (!hasStream) {
      return undefined
    }

    const typedResult = result as { stream: ReadableStream<Uint8Array> }
    const text = await new Response(typedResult.stream).text()
    return JSON.parse(text) as SelectionConfig
  } catch {
    return undefined
  }
}

async function writeJson(path: string, value: SelectionConfig): Promise<void> {
  requireBlobToken()
  await put(path, JSON.stringify(value), {
    access: "private",
    allowOverwrite: true,
    contentType: "application/json",
  })
}

export class SelectionStore {
  async getUserDefaults(userId: string): Promise<SelectionConfig | undefined> {
    return readJson(userPath(userId))
  }

  async setUserDefaults(userId: string, selection: SelectionConfig): Promise<void> {
    await writeJson(userPath(userId), selection)
  }

  async getThreadSelection(threadId: string): Promise<SelectionConfig | undefined> {
    return readJson(threadPath(threadId))
  }

  async setThreadSelection(threadId: string, selection: SelectionConfig): Promise<void> {
    await writeJson(threadPath(threadId), selection)
  }

  async initializeThreadFromUser(threadId: string, userId: string): Promise<SelectionConfig | undefined> {
    const existing = await this.getThreadSelection(threadId)
    if (existing?.providerId && existing?.modelId) {
      return existing
    }

    const defaults = await this.getUserDefaults(userId)
    if (!defaults?.providerId || !defaults?.modelId) {
      return undefined
    }

    await this.setThreadSelection(threadId, defaults)
    return defaults
  }

  async resolveSelection(userId: string, threadId?: string): Promise<SelectionConfig | undefined> {
    if (threadId) {
      const threadSelection = await this.getThreadSelection(threadId)
      if (threadSelection?.providerId) {
        return threadSelection
      }
      return this.initializeThreadFromUser(threadId, userId)
    }

    const defaults = await this.getUserDefaults(userId)
    if (defaults?.providerId) {
      return defaults
    }
    return undefined
  }
}
