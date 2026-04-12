import { beforeEach, describe, expect, it } from "vitest"
import fs from "fs"
import path from "path"
import os from "os"
import { CredentialStore } from "../src/credential-store"

const TEST_BASE_DIR = path.join(os.tmpdir(), `discord-bridge-tests-${process.pid}`)
const SECRET = "test-secret-1234567890"

describe("CredentialStore", () => {
  beforeEach(() => {
    process.env.SESSION_BASE_DIR = TEST_BASE_DIR
    fs.rmSync(TEST_BASE_DIR, { recursive: true, force: true })
  })

  it("stores and loads provider auth", () => {
    const store = new CredentialStore(SECRET)
    store.setProviderAuth("openai", {
      type: "oauth",
      access: "a",
      refresh: "r",
      expires: 123,
    })

    const loaded = store.getProviderAuth("openai")
    expect(loaded).toBeDefined()
    expect(loaded?.type).toBe("oauth")
  })

  it("stores and clears github token", () => {
    const store = new CredentialStore(SECRET)
    store.setGithubToken("ghp_abc")
    expect(store.getGithubToken()).toBe("ghp_abc")
    expect(store.clearGithubToken()).toBe(true)
    expect(store.getGithubToken()).toBeUndefined()
  })

  it("cannot decrypt with wrong secret", () => {
    const store = new CredentialStore(SECRET)
    store.setProviderAuth("anthropic", { type: "api-key", key: "x" })

    const wrongStore = new CredentialStore("different-secret-123456")
    expect(() => wrongStore.load()).toThrow()
  })
})
