/**
 * Maps Discord Interactions payloads (slash command options) to text commands.
 * Converts /ask, /project, /providers, etc. into parseable command strings.
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

function subcommandOptions(data: InteractionCommandData, subcommandName: string): InteractionOption[] | undefined {
  const sub = data.options?.find((opt) => opt.name === subcommandName && opt.type === 1)
  return sub?.options
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
    case "project": {
      const setOpts = subcommandOptions(data, "set")
      const clearOpts = subcommandOptions(data, "clear")
      const showOpts = subcommandOptions(data, "show")
      const selectOpts = subcommandOptions(data, "select")

      if (selectOpts !== undefined) {
        return { type: "command", text: "project select" }
      }
      if (setOpts) {
        const repo = setOpts.find((o) => o.name === "repo")?.value as string | undefined
        const branch = setOpts.find((o) => o.name === "branch")?.value as string | undefined
        if (repo) {
          const branchPart = branch ? ` ${branch}` : ""
          return { type: "command", text: `project set ${repo}${branchPart}`.trim() }
        }
      }
      if (clearOpts !== undefined) {
        return { type: "command", text: "project clear" }
      }
      if (showOpts !== undefined) {
        return { type: "command", text: "project show" }
      }
      return { type: "command", text: "project" }
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
    case "stop": {
      return { type: "command", text: "stop" }
    }
    default:
      return { type: "command", text: "help" }
  }
}
