/**
 * Provides paths for config/storage files (credentials, channel state, etc.).
 * Uses SESSION_BASE_DIR env var or default ~/.cache/opencode-chat-bridge.
 */
import path from "path"
import { homedir } from "os"

export function getBaseDir(): string {
  if (process.env.SESSION_BASE_DIR) {
    return process.env.SESSION_BASE_DIR
  }

  const tempRoot = process.env.TMPDIR || process.env.TEMP || process.env.TMP
  if (tempRoot) {
    return path.join(tempRoot, "opencode-chat-bridge")
  }

  if (process.platform !== "win32") {
    return "/tmp/opencode-chat-bridge"
  }

  return path.join(homedir(), ".cache", "opencode-chat-bridge")
}

export function getConfigDir(): string {
  return path.join(getBaseDir(), "config")
}

export function getConfigPath(fileName: string): string {
  return path.join(getConfigDir(), fileName)
}
