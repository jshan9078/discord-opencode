#!/usr/bin/env bun

import { buildApplicationCommands } from "../src/discord-application-commands"

function usage(): string {
  return [
    "Usage:",
    "  DISCORD_APPLICATION_ID=... DISCORD_BOT_TOKEN=... bun scripts/register-commands.ts",
    "  DISCORD_APPLICATION_ID=... DISCORD_BOT_TOKEN=... DISCORD_GUILD_ID=... bun scripts/register-commands.ts",
  ].join("\n")
}

async function main(): Promise<void> {
  const appId = process.env.DISCORD_APPLICATION_ID
  const botToken = process.env.DISCORD_BOT_TOKEN
  const guildId = process.env.DISCORD_GUILD_ID

  if (!appId || !botToken) {
    throw new Error(`Missing DISCORD_APPLICATION_ID or DISCORD_BOT_TOKEN\n\n${usage()}`)
  }

  const route = guildId
    ? `https://discord.com/api/v10/applications/${appId}/guilds/${guildId}/commands`
    : `https://discord.com/api/v10/applications/${appId}/commands`

  const commands = buildApplicationCommands()

  const response = await fetch(route, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bot ${botToken}`,
    },
    body: JSON.stringify(commands),
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Failed to register commands: ${response.status} ${text}`)
  }

  console.log(
    guildId
      ? `Registered ${commands.length} guild command(s) to ${guildId}.`
      : `Registered ${commands.length} global command(s).`,
  )
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
