import { describe, expect, it } from "vitest"
import { mapInteractionCommandToText } from "../src/interaction-command-mapper"

describe("mapInteractionCommandToText", () => {
  it("maps ask to prompt", () => {
    const mapped = mapInteractionCommandToText({
      name: "ask",
      options: [{ name: "prompt", type: 3, value: "add tests" }],
    })
    expect(mapped).toEqual({ type: "prompt", text: "add tests" })
  })

  it("maps provider commands", () => {
    expect(mapInteractionCommandToText({ name: "providers" })).toEqual({
      type: "command",
      text: "providers",
    })

    expect(
      mapInteractionCommandToText({
        name: "use-provider",
        options: [{ name: "provider", type: 3, value: "openai" }],
      }),
    ).toEqual({
      type: "command",
      text: "use provider openai",
    })
  })
})
