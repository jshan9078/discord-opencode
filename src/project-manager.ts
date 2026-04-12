/**
 * Manages saved projects (repo URLs) and per-channel project mappings.
 * Used for project selection and tracking.
 */

import fs from "fs"
import path from "path"
import { getConfigDir } from "./storage-paths"

export interface Project {
  id: string
  name: string
  repoUrl: string
  addedAt: number
}

export interface ProjectConfig {
  projects: Project[]
  channelProjects: Record<string, string> // channelId -> projectId
}

const CONFIG_DIR = getConfigDir()
const CONFIG_FILE = path.join(CONFIG_DIR, "projects.json")

function ensureConfigDir(): void {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true })
  }
}

function loadConfig(): ProjectConfig {
  ensureConfigDir()
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      return JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8"))
    }
  } catch (e) {
    console.error("Failed to load project config:", e)
  }
  return { projects: [], channelProjects: {} }
}

function saveConfig(config: ProjectConfig): void {
  ensureConfigDir()
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2))
}

export function generateProjectId(): string {
  return `proj_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
}

export function extractRepoName(url: string): string {
  // Handle various GitHub URL formats
  // https://github.com/user/repo
  // git@github.com:user/repo
  // user/repo
  const patterns = [
    /github\.com[/:]([^\/]+)\/([^\/]+?)(?:\.git)?$/,
    /^([^\/]+)\/([^\/]+)$/,
  ]
  
  for (const pattern of patterns) {
    const match = url.match(pattern)
    if (match) {
      const name = match[2]
      return name.replace(/[-_]/g, " ").replace(/\b\w/g, c => c.toUpperCase())
    }
  }
  return "Unnamed Project"
}

export function normalizeRepoUrl(url: string): string {
  // Convert various formats to HTTPS URL
  let normalized = url.trim()
  
  if (!normalized) {
    throw new Error("Repository URL is required")
  }
  
  // Already HTTPS
  if (normalized.startsWith("https://")) {
    return normalized.replace(/\.git$/, "")
  }
  
  // SSH format: git@github.com:user/repo
  if (normalized.startsWith("git@")) {
    const sshMatch = normalized.match(/^git@github\.com:(.+)$/)
    if (!sshMatch) {
      throw new Error("Invalid SSH GitHub URL. Use format: git@github.com:user/repo")
    }
    return `https://github.com/${sshMatch[1]}`.replace(/\.git$/, "")
  }
  
  // Short format: user/repo
  if (normalized.includes("/") && !normalized.includes("github.com")) {
    return `https://github.com/${normalized}`
  }
  
  // Check if it looks like a valid URL without protocol
  if (normalized.includes("github.com")) {
    return `https://${normalized.replace(/^https?:\/\//, "")}`.replace(/\.git$/, "")
  }
  
  throw new Error("Invalid repository URL. Use format: user/repo or https://github.com/user/repo")
}

// =============================================================================
// Public API
// =============================================================================

export const projectManager = {
  /**
   * Get all projects
   */
  getProjects(): Project[] {
    return loadConfig().projects
  },

  /**
   * Get a specific project by ID
   */
  getProject(id: string): Project | undefined {
    return loadConfig().projects.find(p => p.id === id)
  },

  /**
   * Get a project by repo URL
   */
  getProjectByUrl(repoUrl: string): Project | undefined {
    const normalized = normalizeRepoUrl(repoUrl)
    return loadConfig().projects.find(p => normalizeRepoUrl(p.repoUrl) === normalized)
  },

  /**
   * Add a new project
   */
  addProject(repoUrl: string, name?: string): Project {
    const config = loadConfig()
    
    // Check if already exists
    const existing = config.projects.find(p => normalizeRepoUrl(p.repoUrl) === normalizeRepoUrl(repoUrl))
    if (existing) {
      return existing
    }
    
    const project: Project = {
      id: generateProjectId(),
      name: name || extractRepoName(repoUrl),
      repoUrl: normalizeRepoUrl(repoUrl),
      addedAt: Date.now(),
    }
    
    config.projects.push(project)
    saveConfig(config)
    
    return project
  },

  /**
   * Remove a project
   */
  removeProject(id: string): boolean {
    const config = loadConfig()
    const index = config.projects.findIndex(p => p.id === id)
    
    if (index === -1) {
      return false
    }
    
    config.projects.splice(index, 1)
    
    // Remove channel mappings to this project
    for (const channelId of Object.keys(config.channelProjects)) {
      if (config.channelProjects[channelId] === id) {
        delete config.channelProjects[channelId]
      }
    }
    
    saveConfig(config)
    return true
  },

  /**
   * Set current project for a channel
   */
  setChannelProject(channelId: string, projectId: string): boolean {
    const config = loadConfig()
    const project = config.projects.find(p => p.id === projectId)
    
    if (!project) {
      return false
    }
    
    config.channelProjects[channelId] = projectId
    saveConfig(config)
    return true
  },

  /**
   * Get current project for a channel
   */
  getChannelProject(channelId: string): Project | undefined {
    const config = loadConfig()
    const projectId = config.channelProjects[channelId]
    
    if (!projectId) {
      return undefined
    }
    
    return config.projects.find(p => p.id === projectId)
  },

  /**
   * Clear current project for a channel
   */
  clearChannelProject(channelId: string): boolean {
    const config = loadConfig()
    
    if (!config.channelProjects[channelId]) {
      return false
    }
    
    delete config.channelProjects[channelId]
    saveConfig(config)
    return true
  },

  /**
   * Get all projects for select menu format
   */
  getSelectOptions(): { label: string; value: string; description?: string }[] {
    const config = loadConfig()
    return config.projects.map(p => ({
      label: p.name,
      value: p.id,
      description: p.repoUrl,
    }))
  },

  /**
   * Check if a project is set up in a directory
   */
  isProjectSetUp(projectId: string, sessionDir: string): boolean {
    const project = this.getProject(projectId)
    if (!project) {
      return false
    }
    
    // Check if directory exists and has files
    if (!fs.existsSync(sessionDir)) {
      return false
    }
    
    // Check for .git (cloned) and optionally package.json (deps installed)
    return fs.existsSync(path.join(sessionDir, ".git"))
  },
}
