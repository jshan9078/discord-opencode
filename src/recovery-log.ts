/**
 * Logs write/edit actions per channel for session recovery prioritization.
 * Used to reconstruct context from channel history on session expiry.
 */
import fs from "fs"
import { getConfigPath, getConfigDir } from "./storage-paths"

export type RecoveryActionKind = "write" | "read" | "other"

export interface RecoveryAction {
  channelId: string
  timestamp: number
  toolName: string
  kind: RecoveryActionKind
  summary: string
}

interface RecoveryLogFile {
  actions: RecoveryAction[]
}

function recoveryLogPath(): string {
  return getConfigPath("recovery-log.json")
}

function ensureConfigDir(): void {
  const dir = getConfigDir()
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
}

function load(): RecoveryLogFile {
  ensureConfigDir()
  const file = recoveryLogPath()
  if (!fs.existsSync(file)) {
    return { actions: [] }
  }
  return JSON.parse(fs.readFileSync(file, "utf-8")) as RecoveryLogFile
}

function save(data: RecoveryLogFile): void {
  ensureConfigDir()
  fs.writeFileSync(recoveryLogPath(), JSON.stringify(data, null, 2))
}

function normalizeSummary(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, 280)
}

const WRITE_HINTS = [
  "write",
  "edit",
  "update",
  "create",
  "delete",
  "rename",
  "apply_patch",
  "insert",
  "replace",
  "commit",
  "git add",
  "git commit",
  "mv ",
  "cp ",
  "rm ",
  "mkdir",
  "touch",
  ">",
]

const READ_HINTS = ["read", "ls", "pwd", "cat ", "grep", "glob", "find", "status"]

export function classifyAction(toolName: string, summary: string): RecoveryActionKind {
  const text = `${toolName} ${summary}`.toLowerCase()
  if (WRITE_HINTS.some((hint) => text.includes(hint))) {
    return "write"
  }
  if (READ_HINTS.some((hint) => text.includes(hint))) {
    return "read"
  }
  return "other"
}

export class RecoveryLogStore {
  append(channelId: string, toolName: string, summary: string): void {
    const trimmed = normalizeSummary(summary)
    if (!trimmed) {
      return
    }

    const data = load()
    data.actions.push({
      channelId,
      timestamp: Date.now(),
      toolName,
      kind: classifyAction(toolName, trimmed),
      summary: trimmed,
    })

    if (data.actions.length > 3000) {
      data.actions = data.actions.slice(data.actions.length - 3000)
    }

    save(data)
  }

  recentWrites(channelId: string, limit = 25): RecoveryAction[] {
    const data = load()
    return data.actions
      .filter((action) => action.channelId === channelId && action.kind === "write")
      .slice(-limit)
  }
}
