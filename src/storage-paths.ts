/**
 * Provides paths for config/storage files (credentials, channel state, etc.).
 * Uses SESSION_BASE_DIR env var or default ~/.cache/opencode-chat-bridge.
 */
import path from "path"
import { homedir } from "os"

export function getBaseDir(): string {
  return process.env.SESSION_BASE_DIR || path.join(homedir(), ".cache", "opencode-chat-bridge")
}

export function getConfigDir(): string {
  return path.join(getBaseDir(), "config")
}

export function getConfigPath(fileName: string): string {
  return path.join(getConfigDir(), fileName)
}
