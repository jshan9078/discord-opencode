import { describe, expect, it } from "vitest"
import { classifyAction } from "../src/recovery-log"

describe("classifyAction", () => {
  it("prioritizes write/edit style actions", () => {
    expect(classifyAction("bash", "apply_patch src/app.ts")).toBe("write")
    expect(classifyAction("edit", "update file")).toBe("write")
    expect(classifyAction("bash", "git add . && git commit -m x")).toBe("write")
  })

  it("classifies read actions", () => {
    expect(classifyAction("read", "read src/index.ts")).toBe("read")
    expect(classifyAction("bash", "ls -la")).toBe("read")
  })
})
