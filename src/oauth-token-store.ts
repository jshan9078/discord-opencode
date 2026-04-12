import { get, put } from "@vercel/blob"

export type ProviderAuthPayload = Record<string, unknown>

function blobPath(userId: string, providerId: string): string {
  return `auth/users/${userId}/providers/${providerId}.json`
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
}
