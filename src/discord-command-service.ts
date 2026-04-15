/**
 * Executes parsed commands against channel state, providers, and credentials.
 * Handles /providers, /models, /use-provider, /use-model, /opencode, /auth, etc.
 */
import { commandHelpText, parseDiscordCommand } from "./command-parser.js"
import type { ChannelStateStore } from "./channel-state-store.js"
import type { CredentialStore } from "./credential-store.js"
import type { ProviderRegistry } from "./provider-registry.js"

export interface CommandContext {
  channelId: string
}

export interface CommandResult {
  handled: boolean
  isPrompt: boolean
  promptText?: string
  message?: string
}

const DISCORD_MESSAGE_LIMIT = 1800

function joinWithinLimit(header: string, lines: string[], emptyMessage: string): string {
  if (lines.length === 0) {
    return emptyMessage
  }

  const output = [header]
  let used = header.length
  let included = 0

  for (const line of lines) {
    const addition = `\n${line}`
    if (used + addition.length > DISCORD_MESSAGE_LIMIT) {
      break
    }
    output.push(line)
    used += addition.length
    included += 1
  }

  if (included < lines.length) {
    output.push(`...and ${lines.length - included} more`)
  }

  return output.join("\n")
}

function formatHealthCheck(registry: ProviderRegistry, credentials: CredentialStore): string {
  const checks = [
    `time=${new Date().toISOString()}`,
    `providers=${registry.listProviders().length}`,
    `configuredProviders=${credentials.listProviders().length}`,
    `githubToken=${credentials.getGithubToken() ? "present" : "missing"}`,
    `discordBotToken=${process.env.DISCORD_BOT_TOKEN ? "present" : "missing"}`,
  ]

  return ["Bridge OK", ...checks.map((check) => `- ${check}`)].join("\n")
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

  return joinWithinLimit("Available providers:", lines, "No providers available yet.")
}

function formatModels(registry: ProviderRegistry, providerId: string): string {
  const models = registry.getModels(providerId)
  if (models.length === 0) {
    return `No models found for provider '${providerId}'.`
  }

  return joinWithinLimit(
    `Models for ${providerId}:`,
    models.map((model) => `- ${model.id}${model.label ? ` (${model.label})` : ""}`),
    `No models found for provider '${providerId}'.`,
  )
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

  if (parsed.type === "health_check") {
    return {
      handled: true,
      isPrompt: false,
      message: formatHealthCheck(registry, credentials),
    }
  }

  if (parsed.type === "models") {
    const state = stateStore.get(context.channelId)
    const providerId = parsed.providerId || state.activeProviderId
    if (!providerId) {
      return {
        handled: true,
        isPrompt: false,
        message: "No active provider. Run: /models <provider> or /use-provider <provider>",
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
        message: "No active provider. Run: /use-provider <provider> first.",
      }
    }

    if (!registry.hasModel(state.activeProviderId, parsed.modelId)) {
      const matchingProviders = registry.findProvidersForModel(parsed.modelId)
      if (matchingProviders.length > 0) {
        return {
          handled: true,
          isPrompt: false,
          message:
            `Model '${parsed.modelId}' does not belong to active provider '${state.activeProviderId}'. ` +
            `It is available under: ${matchingProviders.join(", ")}. Run: /use-provider <provider> first.`,
        }
      }

      return {
        handled: true,
        isPrompt: false,
        message: `Unknown model '${parsed.modelId}' for provider '${state.activeProviderId}'. Run: /models ${state.activeProviderId}`,
      }
    }

    stateStore.setActiveModel(context.channelId, parsed.modelId)
    return {
      handled: true,
      isPrompt: false,
      message: `Active model set to '${parsed.modelId}'.`,
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
    const envVarName = `${parsed.providerId.toUpperCase().replace(/[^A-Z0-9]/g, "_")}_API_KEY`
    return {
      handled: true,
      isPrompt: false,
      message:
        `API keys are never entered via Discord.\n` +
        `Set this environment variable in your Vercel project:\n` +
        `\`${envVarName}\``,
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

  if (parsed.type === "checkpoint") {
    return {
      handled: true,
      isPrompt: false,
      message: "checkpoint:sandbox",
    }
  }

  if (parsed.type === "delete") {
    return {
      handled: true,
      isPrompt: false,
      message: "delete:sandbox",
    }
  }

  if (parsed.type === "opencode") {
    return {
      handled: true,
      isPrompt: false,
      message: parsed.project ? `opencode:start:${parsed.project}` : "opencode:start",
    }
  }

  return {
    handled: false,
    isPrompt: true,
    promptText: input,
  }
}
