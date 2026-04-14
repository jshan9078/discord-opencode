/**
 * Parses text commands (from slash command mapping) into structured types.
 * Handles providers, models, opencode, auth, and prompt commands.
 */
export type ParsedCommand =
  | { type: "providers" }
  | { type: "config" }
  | { type: "health_check" }
  | { type: "update" }
  | { type: "models"; providerId?: string }
  | { type: "use_provider"; providerId: string }
  | { type: "use_model"; modelId: string }
  | { type: "auth_connect"; providerId: string; methodHint?: string }
  | { type: "auth_set_key"; providerId: string }
  | { type: "auth_disconnect"; providerId: string }
  | { type: "opencode"; project?: string }
  | { type: "checkpoint" }
  | { type: "delete" }
  | { type: "help" }
  | { type: "invalid"; message: string }
  | { type: "prompt"; text: string }

function tokenize(input: string): string[] {
  const tokens: string[] = []
  const re = /"([^"]+)"|'([^']+)'|(\S+)/g
  let match: RegExpExecArray | null
  while ((match = re.exec(input)) !== null) {
    tokens.push(match[1] || match[2] || match[3])
  }
  return tokens
}

function normalizeAlias(tokens: string[]): string[] {
  if (tokens.length === 0) {
    return tokens
  }

  const lower = tokens.map((token) => token.toLowerCase())

  if (lower[0] === "list" && lower[1] === "providers") {
    return ["providers"]
  }
  if (lower[0] === "list" && lower[1] === "models") {
    return ["models", ...tokens.slice(2)]
  }
  if (lower[0] === "switch" && lower[1] === "provider") {
    return ["use", "provider", ...tokens.slice(2)]
  }
  if (lower[0] === "switch" && lower[1] === "model") {
    return ["use", "model", ...tokens.slice(2)]
  }
  if (lower[0] === "connect") {
    return ["auth", "connect", ...tokens.slice(1)]
  }
  if (lower[0] === "set" && lower[1] === "key") {
    return ["auth", "set-key", ...tokens.slice(2)]
  }

  return tokens
}

function isLikelyCommandWord(firstWord: string): boolean {
  return [
    "providers",
    "config",
    "health-check",
    "update",
    "models",
    "use",
    "auth",
    "opencode",
    "checkpoint",
    "delete",
    "help",
    "list",
    "switch",
    "connect",
    "set",
  ].includes(firstWord.toLowerCase())
}

export function parseDiscordCommand(input: string): ParsedCommand {
  const trimmed = input.trim()
  if (!trimmed) {
    return { type: "help" }
  }

  const initialTokens = tokenize(trimmed)
  if (initialTokens.length === 0) {
    return { type: "help" }
  }

  const tokens = normalizeAlias(initialTokens)
  const lower = tokens.map((token) => token.toLowerCase())

  if (lower[0] === "providers") {
    if (tokens.length > 1) {
      return { type: "invalid", message: "Usage: providers" }
    }
    return { type: "providers" }
  }

  if (lower[0] === "config") {
    if (tokens.length > 1) {
      return { type: "invalid", message: "Usage: config" }
    }
    return { type: "config" }
  }

  if (lower[0] === "health-check") {
    if (tokens.length > 1) {
      return { type: "invalid", message: "Usage: health-check" }
    }
    return { type: "health_check" }
  }

  if (lower[0] === "update") {
    if (tokens.length > 1) {
      return { type: "invalid", message: "Usage: update" }
    }
    return { type: "update" }
  }

  if (lower[0] === "models") {
    if (tokens.length === 1) {
      return { type: "models" }
    }
    if (tokens.length === 2) {
      return { type: "models", providerId: tokens[1] }
    }
    return { type: "invalid", message: "Usage: models [provider]" }
  }

  if (lower[0] === "use" && lower[1] === "provider") {
    if (tokens.length !== 3) {
      return { type: "invalid", message: "Usage: use provider <provider>" }
    }
    return { type: "use_provider", providerId: tokens[2] }
  }

  if (lower[0] === "use" && lower[1] === "model") {
    if (tokens.length !== 3) {
      return { type: "invalid", message: "Usage: use model <model>" }
    }
    return { type: "use_model", modelId: tokens[2] }
  }

  if (lower[0] === "auth" && lower[1] === "connect") {
    if (tokens.length < 3 || tokens.length > 4) {
      return { type: "invalid", message: "Usage: auth connect <provider> [method]" }
    }
    return {
      type: "auth_connect",
      providerId: tokens[2],
      methodHint: tokens[3],
    }
  }

  if (lower[0] === "auth" && lower[1] === "set-key") {
    if (tokens.length !== 3) {
      return { type: "invalid", message: "Usage: auth set-key <provider>" }
    }
    return { type: "auth_set_key", providerId: tokens[2] }
  }

  if (lower[0] === "auth" && lower[1] === "disconnect") {
    if (tokens.length !== 3) {
      return { type: "invalid", message: "Usage: auth disconnect <provider>" }
    }
    return { type: "auth_disconnect", providerId: tokens[2] }
  }

  if (lower[0] === "checkpoint") {
    return { type: "checkpoint" }
  }

  if (lower[0] === "delete") {
    if (tokens.length !== 1) {
      return { type: "invalid", message: "Usage: delete" }
    }
    return { type: "delete" }
  }

  if (lower[0] === "opencode") {
    if (tokens.length === 1) {
      return { type: "opencode" }
    }
    if (tokens.length === 2) {
      return { type: "opencode", project: tokens[1] }
    }
    return { type: "invalid", message: "Usage: opencode [project]" }
  }

  if (lower[0] === "help") {
    return { type: "help" }
  }

  if (isLikelyCommandWord(tokens[0])) {
    return { type: "invalid", message: "Unknown command. Try: help" }
  }

  return { type: "prompt", text: trimmed }
}

export function commandHelpText(): string {
  return [
    "Commands:",
    "- providers",
    "- config",
    "- health-check",
    "- update",
    "- models [provider]",
    "- use provider <provider>",
    "- use model <model>",
    "- auth connect <provider> [method]",
    "- auth set-key <provider>",
    "- auth disconnect <provider>",
    "- opencode [project]",
    "- checkpoint",
    "- delete",
  ].join("\n")
}
