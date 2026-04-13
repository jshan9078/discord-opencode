#!/usr/bin/env node

import dotenv from "dotenv"
import { put } from "@vercel/blob"
import { readdir, readFile, stat } from "fs/promises"
import { join } from "path"
import { homedir } from "os"

dotenv.config({ path: ".env.local" })

const CONFIG_DIR = join(homedir(), ".config", "opencode")
const DEFAULT_BLOB_PATH = "opencode-config/config-bundle.json"
function buildGithubPolicyBlock(defaultLogin?: string): string {
  const lines = [
    "## GitHub CLI Policy",
    "",
    "- You are running in a sandboxed environment.",
    "- You are running in a Vercel sandbox; do not assume user repositories already exist in the local filesystem.",
    "- Treat GitHub as the source of truth for user projects.",
  ]

  if (defaultLogin) {
    lines.push(`- Default authenticated GitHub login for this deployment: ${defaultLogin}.`)
  }

  lines.push(
    "- The GitHub CLI (`gh`) is available.",
    "- For any GitHub-related task (GitHub URLs, repositories, pull requests, issues, comments, checks, releases), use `gh` commands first.",
    "- GitHub CLI/API list operations are often paginated by default and may return partial results.",
    "- When reporting totals or complete lists, request a sufficiently high `--limit` and paginate as needed before finalizing the answer.",
    "- If you are not sure the result set is complete, state that clearly and continue pagination.",
    "- Do not use generic web fetching for GitHub content unless `gh` cannot access the resource.",
    "- For read-only repository questions (README, files, metadata), use `gh` without cloning when possible.",
    "- If the task requires editing files, running code, tests, or builds, clone the repository into the sandbox first and then work locally.",
    "",
  )

  return lines.join("\n")
}

const DISCORD_OUTPUT_POLICY_BLOCK = [
  "## Discord Message Rendering",
  "",
  "Your responses are delivered to Discord chat messages.",
  "",
  "Use only these formatting features:",
  "",
  "Text Formatting",
  "- Italics: `*italics*` or `_italics_`",
  "- Underline italics: `__*underline italics*__`",
  "- Bold: `**bold**`",
  "- Underline bold: `__**underline bold**__`",
  "- Bold italics: `***bold italics***`",
  "- Underline bold italics: `__***underline bold italics***__`",
  "- Underline: `__underline__`",
  "- Strikethrough: `~~strikethrough~~`",
  "",
  "Organizational Formatting",
  "- Headers: `# Header`, `## Header`, `### Header` (include a space after `#`)",
  "- Subtext: `-# subtext` (include a space after `#`)",
  "- Masked links: `[label](https://example.com)`",
  "- Lists: `- item`, `* item`, or `1. item` (include a space after bullet/number)",
  "- Code blocks: `` `inline` `` and triple backticks for multiline",
  "- Block quotes: `> quote` and `>>> multiline quote`",
  "",
  "YOU MUST NOT USE MARKDOWN TABLES.",
  "",
].join("\n")

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

function upsertSection(content: string, title: string, block: string): string {
  const escaped = title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const sectionRegex = new RegExp(`(^## ${escaped}[\\s\\S]*?)(?=^## |\\Z)`, "m")

  if (sectionRegex.test(content)) {
    return content.replace(sectionRegex, block)
  }

  return `${block}${content}`
}

function upsertAgentsPolicies(content: string, defaultLogin?: string): string {
  const withGithub = upsertSection(content, "GitHub CLI Policy", buildGithubPolicyBlock(defaultLogin))
  return upsertSection(withGithub, "Discord Message Rendering", DISCORD_OUTPUT_POLICY_BLOCK)
}

async function resolveGithubLoginFromToken(): Promise<string | undefined> {
  const githubToken = process.env.GITHUB_TOKEN
  if (!githubToken) {
    return undefined
  }

  try {
    const response = await fetch("https://api.github.com/user", {
      headers: {
        Authorization: `Bearer ${githubToken}`,
        Accept: "application/vnd.github.v3+json",
        "User-Agent": "discord-bridge-sync",
      },
    })

    if (!response.ok) {
      return undefined
    }

    const data = await response.json() as { login?: string }
    return typeof data.login === "string" && data.login.trim() ? data.login : undefined
  } catch {
    return undefined
  }
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
  let foundAgentsFile = false
  const defaultGithubLogin = await resolveGithubLoginFromToken()

  for (const [relativePath, content] of files) {
    if (relativePath === "AGENTS.md") {
      foundAgentsFile = true
      payloadFiles[relativePath] = upsertAgentsPolicies(content, defaultGithubLogin)
    } else if (relativePath.endsWith("opencode.json") || relativePath.endsWith("opencode.jsonc")) {
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

  if (!foundAgentsFile) {
    payloadFiles["AGENTS.md"] = upsertAgentsPolicies("", defaultGithubLogin)
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
