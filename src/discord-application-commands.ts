/**
 * Defines Discord slash command structure (/ask, /project, /providers, etc.).
 * Used by register-commands.ts to register commands with Discord.
 */
export interface DiscordApplicationCommandOption {
  type: number
  name: string
  description: string
  required?: boolean
  autocomplete?: boolean
  options?: DiscordApplicationCommandOption[]
}

export interface DiscordApplicationCommand {
  name: string
  description: string
  type?: number
  options?: DiscordApplicationCommandOption[]
}

export function buildApplicationCommands(): DiscordApplicationCommand[] {
  return [
    {
      name: "ask",
      description: "Send a coding request to the agent",
      type: 1,
      options: [
        {
          type: 3,
          name: "prompt",
          description: "What should the agent do?",
          required: true,
        },
      ],
    },
    {
      name: "opencode",
      description: "Start or resume an OpenCode session",
      type: 1,
      options: [
        {
          type: 3,
          name: "project",
          description: "GitHub repo (owner/repo)",
          required: false,
          autocomplete: true,
        },
      ],
    },
    {
      name: "providers",
      description: "List providers and auth status",
      type: 1,
    },
    {
      name: "config",
      description: "Show current provider/model and auth status",
      type: 1,
    },
    {
      name: "health-check",
      description: "Fast bridge health check",
      type: 1,
    },
    {
      name: "update",
      description: "Refresh provider registry from models.dev",
      type: 1,
    },
    {
      name: "models",
      description: "List models for active or selected provider",
      type: 1,
      options: [
        {
          type: 3,
          name: "provider",
          description: "Optional provider id",
          required: false,
          autocomplete: true,
        },
      ],
    },
    {
      name: "use-provider",
      description: "Set active provider for this channel",
      type: 1,
      options: [
        {
          type: 3,
          name: "provider",
          description: "Provider id",
          required: true,
          autocomplete: true,
        },
      ],
    },
    {
      name: "use-model",
      description: "Set active model for this channel",
      type: 1,
      options: [
        {
          type: 3,
          name: "model",
          description: "Model id",
          required: true,
          autocomplete: true,
        },
      ],
    },
    {
      name: "project",
      description: "Manage project (repo/branch) for this channel",
      type: 1,
      options: [
        {
          type: 1,
          name: "select",
          description: "Select repo and branch from your GitHub repos",
        },
        {
          type: 1,
          name: "set",
          description: "Set project repo and branch manually",
          options: [
            {
              type: 3,
              name: "repo",
              description: "GitHub repo (user/repo or full URL)",
              required: true,
            },
            {
              type: 3,
              name: "branch",
              description: "Branch name (default: main)",
              required: false,
            },
          ],
        },
        {
          type: 1,
          name: "clear",
          description: "Clear project for this channel",
        },
        {
          type: 1,
          name: "show",
          description: "Show current project for this channel",
        },
      ],
    },
    {
      name: "auth-connect",
      description: "Show host-local OAuth setup command",
      type: 1,
      options: [
        {
          type: 3,
          name: "provider",
          description: "Provider id",
          required: true,
        },
        {
          type: 3,
          name: "method",
          description: "Optional auth method hint",
          required: false,
        },
      ],
    },
    {
      name: "auth-set-key",
      description: "Show host-local API key setup command",
      type: 1,
      options: [
        {
          type: 3,
          name: "provider",
          description: "Provider id",
          required: true,
        },
      ],
    },
    {
      name: "auth-disconnect",
      description: "Disconnect a provider",
      type: 1,
      options: [
        {
          type: 3,
          name: "provider",
          description: "Provider id",
          required: true,
        },
      ],
    },
    {
      name: "checkpoint",
      description: "Save thread state as a resumable checkpoint",
      type: 1,
    },
  ]
}
