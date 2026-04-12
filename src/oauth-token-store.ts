import { get, put } from "@vercel/blob"

export type ProviderAuthPayload = Record<string, unknown>

export type PendingOAuthPayload = {
  providerId: string
  deviceAuthId?: string
  sandboxId?: string
  opencodePassword?: string
  timestamp: number
}

function blobPath(userId: string, providerId: string): string {
  return `auth/users/${userId}/providers/${providerId}.json`
}

function pendingBlobPath(userId: string, providerId: string): string {
  return `auth/pending/users/${userId}/providers/${providerId}.json`
}

export class OAuthTokenStore {
  private enabled(): boolean {
    return Boolean(process.env.BLOB_READ_WRITE_TOKEN)
  }

  async getUserProviderAuth(userId: string, providerId: string): Promise<ProviderAuthPayload | undefined> {
    if (!this.enabled()) {
      return undefined
    }

    try {
      const result = await get(blobPath(userId, providerId), { access: "private" })
      if (!result || !("stream" in result)) {
        return undefined
      }
      const text = await new Response(result.stream).text()
      return JSON.parse(text) as ProviderAuthPayload
    } catch {
      return undefined
    }
  }

  async setUserProviderAuth(userId: string, providerId: string, payload: ProviderAuthPayload): Promise<void> {
    if (!this.enabled()) {
      return
    }

    await put(blobPath(userId, providerId), JSON.stringify(payload), {
      access: "private",
      allowOverwrite: true,
      contentType: "application/json",
    })
  }

  async getPendingOAuth(userId: string, providerId: string): Promise<PendingOAuthPayload | undefined> {
    if (!this.enabled()) {
      return undefined
    }

    try {
      const result = await get(pendingBlobPath(userId, providerId), { access: "private" })
      if (!result || !("stream" in result)) {
        return undefined
      }
      const text = await new Response(result.stream).text()
      const parsed = JSON.parse(text) as Partial<PendingOAuthPayload>
      if (parsed.providerId !== providerId) {
        return undefined
      }
      return {
        providerId,
        deviceAuthId: parsed.deviceAuthId,
        sandboxId: parsed.sandboxId,
        opencodePassword: parsed.opencodePassword,
        timestamp: parsed.timestamp || Date.now(),
      }
    } catch {
      return undefined
    }
  }

  async setPendingOAuth(userId: string, providerId: string, payload: PendingOAuthPayload): Promise<void> {
    if (!this.enabled()) {
      return
    }

    await put(pendingBlobPath(userId, providerId), JSON.stringify(payload), {
      access: "private",
      allowOverwrite: true,
      contentType: "application/json",
    })
  }

  async clearPendingOAuth(userId: string, providerId: string): Promise<void> {
    if (!this.enabled()) {
      return
    }

    await put(pendingBlobPath(userId, providerId), JSON.stringify({}), {
      access: "private",
      allowOverwrite: true,
      contentType: "application/json",
    })
  }
}
