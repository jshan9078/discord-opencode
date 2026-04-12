/**
 * GitHub API client for listing repos and branches.
 * Used by /project select to show interactive repo/branch pickers.
 */
export interface GitHubRepo {
  name: string
  fullName: string
  defaultBranch: string
}

export interface GitHubBranch {
  name: string
}

export class GitHubClient {
  private readonly token: string

  constructor(token: string) {
    this.token = token
  }

  private async fetch<T>(path: string): Promise<T> {
    const response = await fetch(`https://api.github.com${path}`, {
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: "application/vnd.github.v3+json",
        "User-Agent": "discord-bridge",
      },
    })

    if (!response.ok) {
      throw new Error(`GitHub API error: ${response.status}`)
    }

    return response.json() as Promise<T>
  }

  async listRepos(): Promise<GitHubRepo[]> {
    const repos: Array<{ name: string; full_name: string; default_branch: string }> = await this.fetch(
      "/user/repos?sort=updated&per_page=50",
    )

    return repos.map((r) => ({
      name: r.name,
      fullName: r.full_name,
      defaultBranch: r.default_branch,
    }))
  }

  async listBranches(owner: string, repo: string): Promise<GitHubBranch[]> {
    const branches: Array<{ name: string }> = await this.fetch(`/repos/${owner}/${repo}/branches`)

    return branches.map((b) => ({ name: b.name }))
  }
}

export function getGitHubClient(): GitHubClient | null {
  const token = process.env.GITHUB_TOKEN
  if (!token) {
    return null
  }
  return new GitHubClient(token)
}