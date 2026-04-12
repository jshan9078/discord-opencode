#!/usr/bin/env node

import dotenv from "dotenv"
import { put } from "@vercel/blob"
import { readdir, readFile, stat } from "fs/promises"
import { join } from "path"
import { homedir } from "os"

dotenv.config({ path: ".env.local" })

const CONFIG_DIR = join(homedir(), ".config", "opencode")
const DEFAULT_BLOB_PATH = "opencode-config/config-bundle.json"

function sanitizeOpenCodeConfigContent(content: string): string {
  return content
    .replace(/^\s*["']?projectId["']?\s*:\s*.*?,?\s*$/gm, "")
    .replace(/^\s*["']?orgId["']?\s*:\s*.*?,?\s*$/gm, "")
    .replace(/^\s*["']?projectName["']?\s*:\s*.*?,?\s*$/gm, "")
}

function ensurePermissionAllow(content: string): string {
  if (/^\s*["']?permission["']?\s*:/m.test(content)) {
    return content
  }

  const start = content.indexOf("{")
  if (start === -1) {
    return '{\n  "permission": "allow"\n}\n'
  }

  return `${content.slice(0, start + 1)}\n  "permission": "allow",${content.slice(start + 1)}`
}

async function readDirRecursive(dir: string, baseDir: string): Promise<Map<string, string>> {
  const files = new Map<string, string>()
  const skipDirs = new Set(["node_modules", ".git"])

  const entries = await readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    const fullPath = join(dir, entry.name)
    const relativePath = fullPath.replace(baseDir + "/", "")

    if (entry.isDirectory()) {
      if (skipDirs.has(entry.name)) {
        continue
      }
      const nested = await readDirRecursive(fullPath, baseDir)
      for (const [k, v] of nested) {
        files.set(k, v)
      }
      continue
    }

    if (entry.name === ".DS_Store") {
      continue
    }

    const content = await readFile(fullPath, "utf-8")
    files.set(relativePath, content)
  }

  return files
}

async function main(): Promise<void> {
  const token = process.env.BLOB_READ_WRITE_TOKEN
  if (!token) {
    throw new Error("BLOB_READ_WRITE_TOKEN is required. Run `vercel env pull` first.")
  }

  await stat(CONFIG_DIR)

  const files = await readDirRecursive(CONFIG_DIR, CONFIG_DIR)
  const payloadFiles: Record<string, string> = {}
  let foundMainConfig = false

  for (const [relativePath, content] of files) {
    if (relativePath.endsWith("opencode.json") || relativePath.endsWith("opencode.jsonc")) {
      foundMainConfig = true
      const sanitized = sanitizeOpenCodeConfigContent(content)
      payloadFiles[relativePath] = ensurePermissionAllow(sanitized)
    } else {
      payloadFiles[relativePath] = content
    }
  }

  if (!foundMainConfig) {
    payloadFiles["opencode.jsonc"] = '{\n  "permission": "allow"\n}\n'
  }

  const path = process.env.OPENCODE_CONFIG_BLOB_PATH || DEFAULT_BLOB_PATH
  await put(path, JSON.stringify({ files: payloadFiles }, null, 2), {
    access: "private",
    allowOverwrite: true,
    contentType: "application/json",
    token,
  })

  console.log(`Synced ${Object.keys(payloadFiles).length} config files to Blob path: ${path}`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
