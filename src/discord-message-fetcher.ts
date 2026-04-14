/**
 * Fetches Discord thread messages for session recovery.
 * Used when sandbox expires to reconstruct conversation context.
 */
import type { ChannelStateStore } from "./channel-state-store.js"

export interface DiscordMessage {
  id: string
  content: string
  author: {
    id: string
    username: string
    bot: boolean
  }
  timestamp: string
  attachments: Array<{ id: string; filename: string }>
  embeds: unknown[]
}

export async function fetchThreadMessages(
  channelId: string,
  threadId: string,
  botToken: string,
  limit = 50,
): Promise<DiscordMessage[]> {
  const url = `https://discord.com/api/v10/channels/${threadId}/messages?limit=${limit}`

  const response = await fetch(url, {
    headers: {
      Authorization: `Bot ${botToken}`,
    },
  })

  if (!response.ok) {
    console.error(`Failed to fetch thread messages: ${response.status}`)
    return []
  }

  const messages = (await response.json()) as DiscordMessage[]
  return messages
}

export function buildRecoveryContext(messages: DiscordMessage[], currentPrompt: string): string {
  const lines: string[] = []

  // Filter to only relevant messages (exclude bot control messages, keep user prompts and assistant responses)
  const relevantMessages = messages.filter((msg) => {
    // Skip our own tool notifications
    if (msg.content.startsWith("> ") && !msg.content.includes("Tool:")) {
      return false
    }
    // Skip empty messages
    if (!msg.content.trim()) {
      return false
    }
    return true
  })

  // Build conversation history in reverse (oldest first)
  for (const msg of relevantMessages.slice().reverse()) {
    const isBot = msg.author.bot
    const role = isBot ? "Assistant" : "User"
    const time = new Date(msg.timestamp).toLocaleTimeString()
    const prefix = msg.content.split("\n")[0].slice(0, 100)
    lines.push(`[${time}] ${role}: ${prefix}${msg.content.length > 100 ? "..." : ""}`)
  }

  return lines.join("\n")
}

export async function getRecoveryContext(
  stateStore: ChannelStateStore,
  channelId: string,
  currentPrompt: string,
): Promise<string | undefined> {
  const state = stateStore.get(channelId)
  const threadId = state.threadId || channelId
  const botToken = process.env.DISCORD_BOT_TOKEN

  if (!threadId || !botToken) {
    return undefined
  }

  const messages = await fetchThreadMessages(channelId, threadId, botToken)
  if (messages.length === 0) {
    return undefined
  }

  return buildRecoveryContext(messages, currentPrompt)
}
