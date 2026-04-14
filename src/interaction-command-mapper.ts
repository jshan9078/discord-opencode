/**
 * Maps Discord Interactions payloads (slash command options) to text commands.
 * Converts /ask, /opencode, /providers, etc. into parseable command strings.
 */
interface InteractionOption {
  name: string
  type: number
  value?: string | number | boolean
  options?: InteractionOption[]
}

interface InteractionCommandData {
  name: string
  options?: InteractionOption[]
}

function optionValue(data: InteractionCommandData, name: string): string | undefined {
  const option = data.options?.find((item) => item.name === name)
  if (!option || option.value === undefined || option.value === null) {
    return undefined
  }
  return String(option.value)
}

export function mapInteractionCommandToText(
  data: InteractionCommandData,
): { type: "command" | "prompt"; text: string } {
  const commandName = data.name
  switch (commandName) {
    case "ask": {
      const prompt = optionValue(data, "prompt") || ""
      return { type: "prompt", text: prompt }
    }
    case "providers":
      return { type: "command", text: "providers" }
    case "config":
      return { type: "command", text: "config" }
    case "health-check":
      return { type: "command", text: "health-check" }
    case "update":
      return { type: "command", text: "update" }
    case "models": {
      const provider = optionValue(data, "provider")
      return { type: "command", text: provider ? `models ${provider}` : "models" }
    }
    case "use-provider": {
      const provider = optionValue(data, "provider") || ""
      return { type: "command", text: `use provider ${provider}`.trim() }
    }
    case "use-model": {
      const model = optionValue(data, "model") || ""
      return { type: "command", text: `use model ${model}`.trim() }
    }
    case "auth-connect": {
      const provider = optionValue(data, "provider") || ""
      const method = optionValue(data, "method")
      return {
        type: "command",
        text: `auth connect ${provider}${method ? ` ${method}` : ""}`.trim(),
      }
    }
    case "auth-set-key": {
      const provider = optionValue(data, "provider") || ""
      return { type: "command", text: `auth set-key ${provider}`.trim() }
    }
    case "auth-disconnect": {
      const provider = optionValue(data, "provider") || ""
      return { type: "command", text: `auth disconnect ${provider}`.trim() }
    }
    case "opencode": {
      const project = optionValue(data, "project")
      return { type: "command", text: project ? `opencode ${project}` : "opencode" }
    }
    case "checkpoint": {
      return { type: "command", text: "checkpoint" }
    }
    case "delete": {
      return { type: "command", text: "delete" }
    }
    default:
      return { type: "command", text: "help" }
  }
}
