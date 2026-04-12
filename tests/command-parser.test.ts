import { describe, expect, it } from "vitest"
import { parseDiscordCommand } from "../src/command-parser"

describe("parseDiscordCommand", () => {
  it("parses provider and model commands", () => {
    expect(parseDiscordCommand("providers")).toEqual({ type: "providers" })
    expect(parseDiscordCommand("models")).toEqual({ type: "models" })
    expect(parseDiscordCommand("use provider openai")).toEqual({
      type: "use_provider",
      providerId: "openai",
    })
    expect(parseDiscordCommand('use model "openai/gpt-5.1-mini"')).toEqual({
      type: "use_model",
      modelId: "openai/gpt-5.1-mini",
    })
  })

  it("supports aliases", () => {
    expect(parseDiscordCommand("list providers")).toEqual({ type: "providers" })
    expect(parseDiscordCommand("switch provider anthropic")).toEqual({
      type: "use_provider",
      providerId: "anthropic",
    })
    expect(parseDiscordCommand("connect openai device")).toEqual({
      type: "auth_connect",
      providerId: "openai",
      methodHint: "device",
    })
  })

  it("returns prompt for non-command text", () => {
    expect(parseDiscordCommand("add a login screen with tests")).toEqual({
      type: "prompt",
      text: "add a login screen with tests",
    })
  })

  it("returns invalid for malformed command", () => {
    const parsed = parseDiscordCommand("use provider")
    expect(parsed.type).toBe("invalid")
  })
})
