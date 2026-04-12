/**
 * Persists state per Discord channel (provider, model, repo, branch, sessions).
 * Used by the interactions endpoint to maintain conversation context across requests.
 */
import fs from "fs"
import { getConfigDir, getConfigPath } from "./storage-paths"

export interface ChannelState {
  channelId: string
  sandboxName?: string
  activeProviderId?: string
  activeModelId?: string
  sessionByProfile?: Record<string, string>
  repoUrl?: string
  branch?: string
  projectName?: string
}

interface ChannelStateConfig {
  channels: Record<string, ChannelState>
}

function stateFilePath(): string {
  return getConfigPath("channel-state.json")
}

function ensureConfigDir(): void {
  const dir = getConfigDir()
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
}

function loadAll(): ChannelStateConfig {
  ensureConfigDir()
  const file = stateFilePath()
  if (!fs.existsSync(file)) {
    return { channels: {} }
  }
  return JSON.parse(fs.readFileSync(file, "utf-8")) as ChannelStateConfig
}

function saveAll(config: ChannelStateConfig): void {
  ensureConfigDir()
  fs.writeFileSync(stateFilePath(), JSON.stringify(config, null, 2))
}

export class ChannelStateStore {
  get(channelId: string): ChannelState {
    const config = loadAll()
    return config.channels[channelId] || { channelId, sessionByProfile: {} }
  }

  set(state: ChannelState): void {
    const config = loadAll()
    config.channels[state.channelId] = {
      ...state,
      sessionByProfile: state.sessionByProfile || {},
    }
    saveAll(config)
  }

  setActiveProvider(channelId: string, providerId: string): ChannelState {
    const state = this.get(channelId)
    state.activeProviderId = providerId
    if (state.activeModelId && !state.sessionByProfile) {
      state.sessionByProfile = {}
    }
    this.set(state)
    return state
  }

  setActiveModel(channelId: string, modelId: string): ChannelState {
    const state = this.get(channelId)
    state.activeModelId = modelId
    this.set(state)
    return state
  }

  setProject(channelId: string, repoUrl: string, branch: string, projectName?: string): ChannelState {
    const state = this.get(channelId)
    state.repoUrl = repoUrl
    state.branch = branch
    state.projectName = projectName
    this.set(state)
    return state
  }

  clearProject(channelId: string): ChannelState {
    const state = this.get(channelId)
    delete state.repoUrl
    delete state.branch
    delete state.projectName
    this.set(state)
    return state
  }

  getProfileKey(state: ChannelState): string | undefined {
    if (!state.activeProviderId || !state.activeModelId) {
      return undefined
    }
    return `${state.activeProviderId}:${state.activeModelId}`
  }

  setSessionForActiveProfile(channelId: string, sessionId: string): ChannelState {
    const state = this.get(channelId)
    const key = this.getProfileKey(state)
    if (!key) {
      throw new Error("Cannot set session without active provider and model")
    }
    state.sessionByProfile ||= {}
    state.sessionByProfile[key] = sessionId
    this.set(state)
    return state
  }

  getSessionForActiveProfile(channelId: string): string | undefined {
    const state = this.get(channelId)
    const key = this.getProfileKey(state)
    if (!key) {
      return undefined
    }
    return state.sessionByProfile?.[key]
  }

  clearSessionForActiveProfile(channelId: string): boolean {
    const state = this.get(channelId)
    const key = this.getProfileKey(state)
    if (!key || !state.sessionByProfile?.[key]) {
      return false
    }

    delete state.sessionByProfile[key]
    this.set(state)
    return true
  }
}