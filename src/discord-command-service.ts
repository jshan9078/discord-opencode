/**
 * Executes parsed commands against channel state, providers, and credentials.
 * Handles /providers, /models, /use-provider, /use-model, /project, /auth, etc.
 */
import { commandHelpText, parseDiscordCommand } from "./command-parser"
import type { ChannelStateStore } from "./channel-state-store"
import type { CredentialStore } from "./credential-store"
import type { ProviderRegistry } from "./provider-registry"

export interface CommandContext {
  channelId: string
}

export interface CommandResult {
  handled: boolean
  isPrompt: boolean
  promptText?: string
  message?: string
}

function formatProviders(
  registry: ProviderRegistry,
  credentials: CredentialStore,
): string {
  const configured = credentials.listProviders()
  const lines = registry.toStatusView(configured).map((provider) => {
    const methods = provider.methods.map((method) => method.label).join(", ") || "none"
    const status = provider.isConfigured ? "configured" : "not configured"
    return `- ${provider.id} (${status}) [${methods}]`
  })

  if (lines.length === 0) {
    return "No providers available yet."
  }

  return ["Available providers:", ...lines].join("\n")
}

function formatModels(registry: ProviderRegistry, providerId: string): string {
  const models = registry.getModels(providerId)
  if (models.length === 0) {
    return `No models found for provider '${providerId}'.`
  }

  return [
    `Models for ${providerId}:`,
    ...models.map((model) => `- ${model.id}${model.label ? ` (${model.label})` : ""}`),
  ].join("\n")
}

function extractRepoName(url: string): string {
  const patterns = [
    /github\.com[/:]([^\/]+)\/([^\/]+?)(?:\.git)?$/,
    /^([^\/]+)\/([^\/]+)$/,
  ]

  for (const pattern of patterns) {
    const match = url.match(pattern)
    if (match) {
      const name = match[2]
      return name.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
    }
  }
  return "Project"
}

export function handleDiscordCommand(
  input: string,
  context: CommandContext,
  stateStore: ChannelStateStore,
  registry: ProviderRegistry,
  credentials: CredentialStore,
): CommandResult {
  const parsed = parseDiscordCommand(input)

  if (parsed.type === "prompt") {
    return {
      handled: false,
      isPrompt: true,
      promptText: parsed.text,
    }
  }

  if (parsed.type === "invalid") {
    return {
      handled: true,
      isPrompt: false,
      message: `${parsed.message}\n\n${commandHelpText()}`,
    }
  }

  if (parsed.type === "help") {
    return {
      handled: true,
      isPrompt: false,
      message: commandHelpText(),
    }
  }

  if (parsed.type === "providers") {
    return {
      handled: true,
      isPrompt: false,
      message: formatProviders(registry, credentials),
    }
  }

  if (parsed.type === "models") {
    const state = stateStore.get(context.channelId)
    const providerId = parsed.providerId || state.activeProviderId
    if (!providerId) {
      return {
        handled: true,
        isPrompt: false,
        message: "No active provider. Run: use provider <provider>",
      }
    }
    return {
      handled: true,
      isPrompt: false,
      message: formatModels(registry, providerId),
    }
  }

  if (parsed.type === "use_provider") {
    if (!registry.hasProvider(parsed.providerId)) {
      return {
        handled: true,
        isPrompt: false,
        message: `Unknown provider '${parsed.providerId}'. Run: providers`,
      }
    }

    const state = stateStore.setActiveProvider(context.channelId, parsed.providerId)
    if (state.activeModelId && !registry.hasModel(parsed.providerId, state.activeModelId)) {
      state.activeModelId = undefined
      stateStore.set(state)
    }

    return {
      handled: true,
      isPrompt: false,
      message: `Active provider set to '${parsed.providerId}'. Run: models`,
    }
  }

  if (parsed.type === "use_model") {
    const state = stateStore.get(context.channelId)
    if (!state.activeProviderId) {
      return {
        handled: true,
        isPrompt: false,
        message: "No active provider. Run: use provider <provider>",
      }
    }

    if (!registry.hasModel(state.activeProviderId, parsed.modelId)) {
      return {
        handled: true,
        isPrompt: false,
        message: `Unknown model '${parsed.modelId}' for provider '${state.activeProviderId}'. Run: models`,
      }
    }

    stateStore.setActiveModel(context.channelId, parsed.modelId)
    return {
      handled: true,
      isPrompt: false,
      message: `Active model set to '${parsed.modelId}'.`,
    }
  }

  if (parsed.type === "project_select") {
    return {
      handled: true,
      isPrompt: false,
      message: "project_select:show_repo_menu",
    }
  }

  if (parsed.type === "project_set") {
    const projectName = extractRepoName(parsed.repo)
    stateStore.setProject(context.channelId, parsed.repo, parsed.branch || "main", projectName)
    return {
      handled: true,
      isPrompt: false,
      message: `Project set to **${projectName}** (${parsed.repo}, branch: ${parsed.branch || "main"})`,
    }
  }

  if (parsed.type === "project_clear") {
    stateStore.clearProject(context.channelId)
    return {
      handled: true,
      isPrompt: false,
      message: "Project cleared for this channel.",
    }
  }

  if (parsed.type === "project_show") {
    const state = stateStore.get(context.channelId)
    if (!state.repoUrl) {
      return {
        handled: true,
        isPrompt: false,
        message: "No project set for this channel. Run: project select or project set <repo> [branch]",
      }
    }
    return {
      handled: true,
      isPrompt: false,
      message: `Current project: **${state.projectName || "Project"}**\n${state.repoUrl}\nBranch: ${state.branch || "main"}`,
    }
  }

  if (parsed.type === "auth_connect") {
    return {
      handled: true,
      isPrompt: false,
      message:
        `Auth must be completed on the bridge host.\n` +
        `Run locally: bridge auth connect ${parsed.providerId}${parsed.methodHint ? ` ${parsed.methodHint}` : ""}`,
    }
  }

  if (parsed.type === "auth_set_key") {
    return {
      handled: true,
      isPrompt: false,
      message:
        `API keys are never entered via Discord.\n` +
        `Run locally: bridge auth set-key ${parsed.providerId} --stdin`,
    }
  }

  if (parsed.type === "auth_disconnect") {
    const removed = credentials.removeProviderAuth(parsed.providerId)
    return {
      handled: true,
      isPrompt: false,
      message: removed
        ? `Disconnected provider '${parsed.providerId}'.`
        : `Provider '${parsed.providerId}' was not connected.`,
    }
  }

  return {
    handled: false,
    isPrompt: true,
    promptText: input,
  }
}