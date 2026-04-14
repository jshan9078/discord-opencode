import { randomUUID } from "crypto"
import { get, put } from "@vercel/blob"

export interface WorkspaceEntry {
  id: string
  name: string
  project: string
  repoUrl: string
  branch: string
  threadId?: string
  snapshotId?: string
  createdAt: number
  updatedAt: number
}

export interface ThreadBinding {
  threadId: string
  userId: string
  project?: string
  workspaceEntryId?: string
  hasCustomName?: boolean
  updatedAt: number
}

function requireBlobToken(): void {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    throw new Error("BLOB_READ_WRITE_TOKEN is required for workspace entry storage.")
  }
}

function safeKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9._-]/g, "-")
}

function projectEntriesPath(userId: string, project: string): string {
  return `runtime/workspaces/users/${safeKey(userId)}/${safeKey(project)}.json`
}

function threadBindingPath(threadId: string): string {
  return `runtime/workspaces/threads/${safeKey(threadId)}.json`
}

function rawBaselinePath(): string {
  return "runtime/workspaces/raw-baseline.json"
}

async function readJson<T>(path: string, fallback: T): Promise<T> {
  requireBlobToken()

  try {
    const result = await get(path, { access: "private" })
    if (!result || !("stream" in result)) {
      return fallback
    }

    const text = await new Response(result.stream).text()
    if (!text || text.trim() === "") {
      console.warn("workspace: empty blob, returning fallback", { path })
      return fallback
    }

    const parsed = JSON.parse(text)
    if (!parsed || typeof parsed !== "object") {
      console.warn("workspace: invalid JSON structure, returning fallback", { path })
      return fallback
    }

    return parsed as T
  } catch (err) {
    console.warn("workspace: read failed, returning fallback", { path, error: String(err) })
    return fallback
  }
}

async function writeJson(path: string, value: unknown): Promise<void> {
  requireBlobToken()

  const jsonStr = JSON.stringify(value)
  if (!jsonStr) {
    throw new Error("workspace: empty write prevented")
  }

  try {
    await put(path, jsonStr, {
      access: "private",
      allowOverwrite: true,
      contentType: "application/json",
      cacheControlMaxAge: 0,
    })

    const verify = await get(path, { access: "private" })
    if (!verify || !("stream" in verify)) {
      console.error("workspace: write succeeded but read back nothing", { path })
    }
  } catch (err) {
    console.error("workspace: write failed", { path, error: String(err) })
    throw err
  }
}

export class WorkspaceEntryStore {
  async listEntries(userId: string, project: string): Promise<WorkspaceEntry[]> {
    return await readJson<WorkspaceEntry[]>(projectEntriesPath(userId, project), [])
  }

  async getEntry(userId: string, project: string, entryId: string): Promise<WorkspaceEntry | undefined> {
    const entries = await this.listEntries(userId, project)
    return entries.find((entry) => entry.id === entryId)
  }

  async createEntry(input: {
    userId: string
    project: string
    repoUrl: string
    branch: string
    name: string
    threadId?: string
    snapshotId?: string
  }): Promise<WorkspaceEntry> {
    const entries = await this.listEntries(input.userId, input.project)
    const now = Date.now()
    const entry: WorkspaceEntry = {
      id: randomUUID(),
      name: input.name,
      project: input.project,
      repoUrl: input.repoUrl,
      branch: input.branch,
      threadId: input.threadId,
      snapshotId: input.snapshotId,
      createdAt: now,
      updatedAt: now,
    }
    entries.unshift(entry)
    await writeJson(projectEntriesPath(input.userId, input.project), entries)
    return entry
  }

  async updateEntry(
    userId: string,
    project: string,
    entryId: string,
    patch: Partial<WorkspaceEntry>,
  ): Promise<WorkspaceEntry | undefined> {
    const entries = await this.listEntries(userId, project)
    const next = entries.map((entry) => {
      if (entry.id !== entryId) {
        return entry
      }
      return {
        ...entry,
        ...patch,
        id: entry.id,
        project: entry.project,
        updatedAt: Date.now(),
      }
    })
    await writeJson(projectEntriesPath(userId, project), next)
    return next.find((entry) => entry.id === entryId)
  }

  async deleteEntry(userId: string, project: string, entryId: string): Promise<boolean> {
    const entries = await this.listEntries(userId, project)
    const next = entries.filter((entry) => entry.id !== entryId)
    await writeJson(projectEntriesPath(userId, project), next)
    return next.length !== entries.length
  }

  async getThreadBinding(threadId: string): Promise<ThreadBinding | undefined> {
    const value = await readJson<unknown>(threadBindingPath(threadId), undefined)
    if (!value || typeof value !== "object") {
      return undefined
    }

    const raw = value as Record<string, unknown>
    if (typeof raw.threadId !== "string" || typeof raw.userId !== "string") {
      return undefined
    }

    return {
      threadId: raw.threadId,
      userId: raw.userId,
      project: typeof raw.project === "string" ? raw.project : undefined,
      workspaceEntryId: typeof raw.workspaceEntryId === "string" ? raw.workspaceEntryId : undefined,
      hasCustomName: raw.hasCustomName === true,
      updatedAt: typeof raw.updatedAt === "number" ? raw.updatedAt : Date.now(),
    }
  }

  async setThreadBinding(binding: ThreadBinding): Promise<void> {
    await writeJson(threadBindingPath(binding.threadId), {
      ...binding,
      updatedAt: Date.now(),
    })
  }

  async clearThreadBinding(threadId: string): Promise<void> {
    await writeJson(threadBindingPath(threadId), {})
  }

  async getRawBaseline(): Promise<{ snapshotId?: string; updatedAt?: number }> {
    return await readJson(rawBaselinePath(), {})
  }

  async setRawBaseline(snapshotId: string): Promise<void> {
    await writeJson(rawBaselinePath(), {
      snapshotId,
      updatedAt: Date.now(),
    })
  }
}
