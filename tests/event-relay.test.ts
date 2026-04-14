import { describe, expect, it } from "vitest"
import { isTerminalSessionEvent, relaySessionEvents } from "../src/event-relay"

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

  it("does not relay reasoning deltas as output text", async () => {
    async function* stream() {
      yield {
        type: "message.part.updated",
        sessionID: "s1",
        properties: {
          sessionID: "s1",
          part: {
            id: "p-reason",
            sessionID: "s1",
            messageID: "m1",
            type: "reasoning",
            text: "",
            time: { start: Date.now() },
          },
          time: Date.now(),
        },
      }
      yield {
        type: "message.part.delta",
        sessionID: "s1",
        properties: {
          sessionID: "s1",
          messageID: "m1",
          partID: "p-reason",
          field: "text",
          delta: "internal thought ",
        },
      }
      yield {
        type: "message.part.updated",
        sessionID: "s1",
        properties: {
          sessionID: "s1",
          part: {
            id: "p-text",
            sessionID: "s1",
            messageID: "m1",
            type: "text",
            text: "",
            time: { start: Date.now() },
          },
          time: Date.now(),
        },
      }
      yield {
        type: "message.part.delta",
        sessionID: "s1",
        properties: {
          sessionID: "s1",
          messageID: "m1",
          partID: "p-text",
          field: "text",
          delta: "public answer",
        },
      }
      yield {
        type: "session.idle",
        sessionID: "s1",
        properties: {},
      }
    }

    const deltas: string[] = []

    const result = await relaySessionEvents(
      {
        event: {
          subscribe: async () => ({ stream: stream() }),
        },
      },
      {
        onTextDelta: async (text) => {
          deltas.push(text)
        },
        onToolActivity: async () => {},
        onQuestion: async () => {},
        onPermission: async () => {},
        onError: async () => {},
      },
      "s1",
    )

    expect(result.completed).toBe(true)
    expect(deltas.join("")).toBe("public answer")
  })

  it("emits tool request and result from tool part state transitions", async () => {
    async function* stream() {
      yield {
        type: "message.part.updated",
        sessionID: "s1",
        properties: {
          sessionID: "s1",
          part: {
            id: "tool-1",
            sessionID: "s1",
            messageID: "m1",
            type: "tool",
            callID: "call-1",
            tool: "bash",
            state: { status: "running", input: { command: "pwd" }, time: { start: Date.now() } },
          },
          time: Date.now(),
        },
      }
      yield {
        type: "message.part.updated",
        sessionID: "s1",
        properties: {
          sessionID: "s1",
          part: {
            id: "tool-1",
            sessionID: "s1",
            messageID: "m1",
            type: "tool",
            callID: "call-1",
            tool: "bash",
            state: {
              status: "completed",
              input: { command: "pwd" },
              output: "/tmp",
              title: "Done",
              metadata: {},
              time: { start: Date.now(), end: Date.now() },
            },
          },
          time: Date.now(),
        },
      }
      yield {
        type: "session.idle",
        sessionID: "s1",
        properties: {},
      }
    }

    const requests: string[] = []
    const results: string[] = []

    await relaySessionEvents(
      {
        event: {
          subscribe: async () => ({ stream: stream() }),
        },
      },
      {
        onTextDelta: async () => {},
        onToolActivity: async () => {},
        onToolRequest: async (payload) => {
          requests.push(payload.toolName)
        },
        onToolResult: async (payload) => {
          results.push(payload.toolName)
        },
        onQuestion: async () => {},
        onPermission: async () => {},
        onError: async () => {},
      },
      "s1",
    )

    expect(requests).toEqual(["bash"])
    expect(results).toEqual(["bash"])
  })

  it("captures files from session.diff and forwards todo.updated", async () => {
    async function* stream() {
      yield {
        type: "todo.updated",
        sessionID: "s1",
        properties: {
          sessionID: "s1",
          todos: [
            { content: "Task A", status: "pending", priority: "high" },
            { content: "Task B", status: "completed", priority: "medium" },
          ],
        },
      }
      yield {
        type: "session.diff",
        sessionID: "s1",
        properties: {
          sessionID: "s1",
          diff: [
            { file: "src/a.ts", patch: "", additions: 1, deletions: 0, status: "modified" },
            { file: "README.md", patch: "", additions: 2, deletions: 1, status: "modified" },
          ],
        },
      }
      yield {
        type: "session.idle",
        sessionID: "s1",
        properties: {},
      }
    }

    const todoBatches: Array<Array<{ content: string; status: string; priority?: string }>> = []

    const result = await relaySessionEvents(
      {
        event: {
          subscribe: async () => ({ stream: stream() }),
        },
      },
      {
        onTextDelta: async () => {},
        onToolActivity: async () => {},
        onQuestion: async () => {},
        onPermission: async () => {},
        onError: async () => {},
        onTodoUpdate: async (todos) => {
          todoBatches.push(todos)
        },
      },
      "s1",
    )

    expect(todoBatches.length).toBe(1)
    expect(todoBatches[0]?.map((todo) => todo.content)).toEqual(["Task A", "Task B"])
    expect(result.filesEdited).toEqual(["src/a.ts", "README.md"])
  })
})
