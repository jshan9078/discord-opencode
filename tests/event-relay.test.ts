import { describe, expect, it } from "vitest"
import { isTerminalSessionEvent } from "../src/event-relay"

describe("isTerminalSessionEvent", () => {
  it("detects explicit terminal event types", () => {
    expect(isTerminalSessionEvent({ type: "session.completed" })).toBe(true)
    expect(isTerminalSessionEvent({ type: "session.idle" })).toBe(true)
    expect(isTerminalSessionEvent({ type: "response.completed" })).toBe(true)
  })

  it("detects completed status on message.updated", () => {
    expect(
      isTerminalSessionEvent({
        type: "message.updated",
        properties: { status: "completed" },
      }),
    ).toBe(true)

    expect(
      isTerminalSessionEvent({
        type: "message.updated",
        properties: { done: true },
      }),
    ).toBe(true)
  })

  it("ignores non-terminal events", () => {
    expect(isTerminalSessionEvent({ type: "message.part.delta" })).toBe(false)
    expect(
      isTerminalSessionEvent({
        type: "message.updated",
        properties: { status: "in_progress" },
      }),
    ).toBe(false)
  })
})
