/**
 * Encrypted storage for provider auth tokens and GitHub credentials.
 * Keys are derived from BRIDGE_SECRET - credentials never leave the host.
 * 
 * Supports two sources:
 * 1. Env vars: {PROVIDER}_API_KEY (e.g., OPENAI_API_KEY, ANTHROPIC_API_KEY)
 * 2. Env var: PROVIDER_AUTH_BUNDLE (encrypted JSON from auth.ts export)
 */
import fs from "fs"
import crypto from "crypto"
import { getConfigDir, getConfigPath } from "./storage-paths"

export type ProviderAuthPayload = Record<string, unknown>

export interface EncryptedCredentialRecord {
  version: 1
  iv: string
  tag: string
  ciphertext: string
}

export interface CredentialBundle {
  providers: Record<string, ProviderAuthPayload>
  githubToken?: string
  updatedAt: number
}

function credentialFilePath(): string {
  return getConfigPath("credentials.enc.json")
}

function ensureConfigDir(): void {
  const configDir = getConfigDir()
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true })
  }
}

function deriveKey(secret: string): Buffer {
  return crypto.scryptSync(secret, "discord-bridge-credential-store", 32)
}

function encrypt(secret: string, bundle: CredentialBundle): EncryptedCredentialRecord {
  const iv = crypto.randomBytes(12)
  const key = deriveKey(secret)
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv)

  const plaintext = Buffer.from(JSON.stringify(bundle), "utf-8")
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()])
  const tag = cipher.getAuthTag()

  return {
    version: 1,
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  }
}

function decrypt(secret: string, record: EncryptedCredentialRecord): CredentialBundle {
  if (record.version !== 1) {
    throw new Error(`Unsupported credential file version: ${record.version}`)
  }

  const key = deriveKey(secret)
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(record.iv, "base64"),
  )
  decipher.setAuthTag(Buffer.from(record.tag, "base64"))

  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(record.ciphertext, "base64")),
    decipher.final(),
  ])

  return JSON.parse(plaintext.toString("utf-8")) as CredentialBundle
}

function defaultBundle(): CredentialBundle {
  return {
    providers: {},
    updatedAt: Date.now(),
  }
}

export class CredentialStore {
  constructor(private readonly secret?: string) {
    // secret is optional - env vars are checked first for API keys
  }

  load(): CredentialBundle {
    ensureConfigDir()
    const file = credentialFilePath()
    if (fs.existsSync(file) && this.secret) {
      const raw = fs.readFileSync(file, "utf-8")
      const record = JSON.parse(raw) as EncryptedCredentialRecord
      const bundle = decrypt(this.secret, record)
      bundle.providers ||= {}
      bundle.updatedAt ||= Date.now()
      return bundle
    }

    // No file or no secret - return empty bundle (env vars will be checked at read time)
    return defaultBundle()
  }

  save(bundle: CredentialBundle): void {
    if (!this.secret) {
      return // Can't save without secret
    }
    ensureConfigDir()
    const normalized: CredentialBundle = {
      providers: bundle.providers || {},
      githubToken: bundle.githubToken,
      updatedAt: Date.now(),
    }
    const encrypted = encrypt(this.secret, normalized)
    fs.writeFileSync(credentialFilePath(), JSON.stringify(encrypted, null, 2))
  }

  getProviderAuth(providerId: string): ProviderAuthPayload | undefined {
    // First check env var for API key
    const envApiKey = process.env[`${providerId.toUpperCase()}_API_KEY`]
    if (envApiKey) {
      return { type: "api-key", api_key: envApiKey }
    }

    // Fall back to stored credentials
    const bundle = this.load()
    return bundle.providers[providerId]
  }

  setProviderAuth(providerId: string, payload: ProviderAuthPayload): void {
    const bundle = this.load()
    bundle.providers[providerId] = payload
    this.save(bundle)
  }

  removeProviderAuth(providerId: string): boolean {
    const bundle = this.load()
    if (!bundle.providers[providerId]) {
      return false
    }
    delete bundle.providers[providerId]
    this.save(bundle)
    return true
  }

  listProviders(): string[] {
    return Object.keys(this.load().providers).sort()
  }

  getGithubToken(): string | undefined {
    // First check env var
    if (process.env.GITHUB_TOKEN) {
      return process.env.GITHUB_TOKEN
    }
    // Fall back to stored
    return this.load().githubToken
  }

  setGithubToken(token: string): void {
    const normalized = token.trim()
    if (!normalized) {
      throw new Error("GitHub token cannot be empty")
    }
    const bundle = this.load()
    bundle.githubToken = normalized
    this.save(bundle)
  }

  clearGithubToken(): boolean {
    const bundle = this.load()
    if (!bundle.githubToken) {
      return false
    }
    delete bundle.githubToken
    this.save(bundle)
    return true
  }
}
