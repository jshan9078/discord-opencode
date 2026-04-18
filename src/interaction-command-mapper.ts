/**
 * Maps Discord Interactions payloads (slash command options) to text commands.
 * Converts /ask, /opencode, /providers, etc. into parseable command strings.
 */
interface InteractionOption {
  name: string
  type: number
  value?: string | number | boolean
  options?: InteractionOption[]
  attachments?: Array<{
    id: string
    filename: string
    content_type?: string
    url: string
  }>
}

interface InteractionCommandData {
  name: string
  options?: InteractionOption[]
  attachments?: Array<{
    id: string
    filename: string
    content_type?: string
    url: string
  }>
}

function optionValue(data: InteractionCommandData, name: string): string | undefined {
  const option = data.options?.find((item) => item.name === name)
  if (!option || option.value === undefined || option.value === null) {
    return undefined
  }
  return String(option.value)
}

function extractAttachmentsFromOptions(options: InteractionOption[] | undefined): Array<{ url: string; filename: string; content_type?: string }> | undefined {
  if (!options) return undefined

  const attachmentOptions = options.filter((opt) => opt.type === 11 && opt.attachments && opt.attachments.length > 0)
  if (attachmentOptions.length === 0) return undefined

  const allAttachments: Array<{ url: string; filename: string; content_type?: string }> = []
  for (const opt of attachmentOptions) {
    if (opt.attachments) {
      for (const att of opt.attachments) {
        allAttachments.push({
          url: att.url,
          filename: att.filename,
          content_type: att.content_type,
        })
      }
    }
  }
  return allAttachments.length > 0 ? allAttachments : undefined
}

export function mapInteractionCommandToText(
  data: InteractionCommandData,
): { type: "command" | "prompt"; text: string; attachments?: Array<{ url: string; filename: string; content_type?: string }> } {
  const commandName = data.name
  switch (commandName) {
    case "ask": {
      const prompt = optionValue(data, "prompt") || ""
      const images = extractAttachmentsFromOptions(data.options) ?? data.attachments
      return { type: "prompt", text: prompt, attachments: images }
    }
    case "project": {
      const repo = optionValue(data, "repo") || ""
      const branch = optionValue(data, "branch")
      return {
        type: "command",
        text: branch ? `project ${repo} ${branch}` : `project ${repo}`,
      }
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
      const prompt = optionValue(data, "prompt")
      if (project && prompt) {
        return { type: "command", text: `opencode ${project} ${prompt}` }
      }
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
