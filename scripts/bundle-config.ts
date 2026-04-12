#!/usr/bin/env bun

/**
 * Bundle user OpenCode config into a GitHub gist.
 * 
 * Usage:
 *   pnpm exec bun scripts/bundle-config.ts
 *   # or with GitHub token:
 *   GITHUB_TOKEN=ghp_xxx pnpm exec bun scripts/bundle-config.ts
 */

import { readdir, readFile, stat } from "fs/promises"
import { join, isAbsolute, resolve } from "path"
import { homedir } from "os"

const CONFIG_DIR = join(homedir(), ".config", "opencode")

interface GistFile {
  content: string
  filename: string
}

interface BundledConfig {
  opencode?: Record<string, unknown>
  files: Map<string, string>
}

async function findConfigFiles(dir: string): Promise<string[]> {
  const files: string[] = []
  
  try {
    const entries = await readdir(dir, { withFileTypes: true })
    
    for (const entry of entries) {
      const fullPath = join(dir, entry.name)
      
      if (entry.isDirectory()) {
        // Skip node_modules, .git, etc.
        if (entry.name !== "node_modules" && entry.name !== ".git") {
          const subFiles = await findConfigFiles(fullPath)
          files.push(...subFiles)
        }
      } else if (entry.name.endsWith(".json") || entry.name.endsWith(".jsonc") || entry.name.endsWith(".md")) {
        files.push(fullPath)
      }
    }
  } catch {
    // Directory doesn't exist
  }
  
  return files
}

async function resolveLocalPaths(configContent: string, configDir: string): Promise<string[]> {
  const paths: Set<string> = new Set()
  
  // Simple regex to find local path references
  // Matches: "path": "./skills", 'path': '../scripts', etc.
  const pathPatterns = [
    /"path":\s*"([^"]+)"/g,
    /'path':\s*'([^']+)'/g,
    /"paths":\s*\[([^\]]+)\]/g,
  ]
  
  for (const pattern of pathPatterns) {
    let match
    while ((match = pattern.exec(configContent)) !== null) {
      const path = match[1]
      // Skip URLs and absolute paths
      if (path && !path.startsWith("http") && !isAbsolute(path)) {
        paths.add(path)
      }
    }
  }
  
  // Also look for skill folders, agent files, etc.
  const commonDirs = ["skills", "agents", "commands", "glossary"]
  for (const dir of commonDirs) {
    const fullPath = join(configDir, dir)
    try {
      await stat(fullPath)
      paths.add(dir)
    } catch {
      // Doesn't exist
    }
  }
  
  return Array.from(paths)
}

async function readDirRecursive(dir: string, baseDir: string): Promise<Map<string, string>> {
  const files = new Map<string, string>()
  
  try {
    const entries = await readdir(dir, { withFileTypes: true })
    
    for (const entry of entries) {
      const fullPath = join(dir, entry.name)
      const relativePath = fullPath.replace(baseDir + "/", "")
      
      if (entry.isDirectory()) {
        if (entry.name !== "node_modules" && entry.name !== ".git") {
          const subFiles = await readDirRecursive(fullPath, baseDir)
          for (const [k, v] of subFiles) {
            files.set(k, v)
          }
        }
      } else {
        // Skip package files
        if (!entry.name.includes("package") && !entry.name.includes("lock")) {
          files.set(relativePath, await readFile(fullPath, "utf-8"))
        }
      }
    }
  } catch {
    // Ignore errors
  }
  
  return files
}

async function createGist(token: string, files: Record<string, string>): Promise<string> {
  const response = await fetch("https://api.github.com/gists", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github.v3+json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      description: "OpenCode user config - Discord Bridge",
      public: false,
      files,
    }),
  })
  
  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Failed to create gist: ${response.status} - ${error}`)
  }
  
  const gist = (await response.json()) as { html_url: string; id: string }
  return gist.html_url
}

async function main() {
  console.log("📦 OpenCode Config Bundler")
  console.log("===========================\n")
  
  // Get GitHub token
  let token = process.env.GITHUB_TOKEN
  
  if (!token) {
    console.log("Enter your GitHub Personal Access Token (with 'gist' scope):")
    const readline = await import("readline").then(m => m.createInterface({
      input: process.stdin,
      output: process.stdout,
    }))
    
    token = await new Promise<string>(resolve => {
      readline.question("> ", answer => {
        readline.close()
        resolve(answer.trim())
      })
    })
  }
  
  if (!token) {
    console.error("❌ GitHub token is required")
    process.exit(1)
  }
  
  console.log("\n📁 Reading config from:", CONFIG_DIR)
  
  // Check if config dir exists
  try {
    await stat(CONFIG_DIR)
  } catch {
    console.error("❌ Config directory not found:", CONFIG_DIR)
    process.exit(1)
  }
  
  // Find opencode.json or opencode.jsonc
  const configFiles = await findConfigFiles(CONFIG_DIR)
  const mainConfigFile = configFiles.find(f => f.includes("opencode.json")) || configFiles[0]
  
  if (!mainConfigFile) {
    console.error("❌ No config files found in", CONFIG_DIR)
    process.exit(1)
  }
  
  console.log("📄 Found config file:", mainConfigFile.split("/").pop())
  
  // Read main config
  const configContent = await readFile(mainConfigFile, "utf-8")
  
  // Find local paths referenced in config
  const localPaths = await resolveLocalPaths(configContent, CONFIG_DIR)
  console.log("🔗 Found local references:", localPaths.length > 0 ? localPaths.join(", ") : "none")
  
  // Bundle all files
  const gistFiles: Record<string, string> = {}
  
  // Add opencode.jsonc
  gistFiles["opencode.jsonc"] = configContent
  
  // Add referenced local paths
  for (const localPath of localPaths) {
    const fullPath = resolve(CONFIG_DIR, localPath)
    const files = await readDirRecursive(fullPath, CONFIG_DIR)
    
    for (const [filename, content] of files) {
      // Skip if already added
      if (!gistFiles[filename]) {
        gistFiles[filename] = content
      }
    }
  }
  
  // Also include AGENTS.md if exists
  const agentsPath = join(CONFIG_DIR, "AGENTS.md")
  try {
    gistFiles["AGENTS.md"] = await readFile(agentsPath, "utf-8")
  } catch {
    // Doesn't exist
  }
  
  console.log(`\n📤 Bundling ${Object.keys(gistFiles).length} files...`)
  
  try {
    const gistUrl = await createGist(token, gistFiles)
    
    console.log("\n✅ Success!")
    console.log("🌐 Gist URL:", gistUrl)
    console.log("\n📋 Add this to your Vercel environment variables:")
    console.log(`   OPENCODE_GIST_URL=${gistUrl}`)
    console.log("\n💡 The bridge will automatically fetch this config when creating sandboxes.")
  } catch (error) {
    console.error("\n❌ Error:", error instanceof Error ? error.message : "Unknown error")
    process.exit(1)
  }
}

main()