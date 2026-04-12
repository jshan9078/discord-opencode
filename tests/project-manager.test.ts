import { describe, it, expect, beforeEach } from "vitest"
import fs from "fs"
import path from "path"
import { projectManager, normalizeRepoUrl, extractRepoName, generateProjectId } from "../src/project-manager"
import { getConfigDir } from "../src/storage-paths"

describe("project-manager", () => {
  beforeEach(() => {
    const configPath = path.join(getConfigDir(), "projects.json")
    if (fs.existsSync(configPath)) {
      fs.unlinkSync(configPath)
    }
  })

  describe("normalizeRepoUrl", () => {
    it("should handle HTTPS URLs", () => {
      expect(normalizeRepoUrl("https://github.com/user/repo")).toBe("https://github.com/user/repo")
      expect(normalizeRepoUrl("https://github.com/user/repo.git")).toBe("https://github.com/user/repo")
    })

    it("should handle SSH URLs", () => {
      expect(normalizeRepoUrl("git@github.com:user/repo")).toBe("https://github.com/user/repo")
      expect(normalizeRepoUrl("git@github.com:user/repo.git")).toBe("https://github.com/user/repo")
    })

    it("should handle short format", () => {
      expect(normalizeRepoUrl("user/repo")).toBe("https://github.com/user/repo")
    })

    it("should handle URLs with github.com but no protocol", () => {
      expect(normalizeRepoUrl("github.com/user/repo")).toBe("https://github.com/user/repo")
    })

    it("should throw on empty URL", () => {
      expect(() => normalizeRepoUrl("")).toThrow()
    })

    it("should throw on invalid format", () => {
      expect(() => normalizeRepoUrl("not-a-valid-url")).toThrow()
    })
  })

  describe("extractRepoName", () => {
    it("should extract name from HTTPS URL", () => {
      expect(extractRepoName("https://github.com/user/my-project")).toBe("My Project")
      expect(extractRepoName("https://github.com/user/repo-name")).toBe("Repo Name")
    })

    it("should extract name from SSH URL", () => {
      expect(extractRepoName("git@github.com:user/test-repo")).toBe("Test Repo")
    })

    it("should extract name from short format", () => {
      expect(extractRepoName("user/my-cool-repo")).toBe("My Cool Repo")
    })
  })

  describe("generateProjectId", () => {
    it("should generate unique IDs", () => {
      const id1 = generateProjectId()
      const id2 = generateProjectId()
      expect(id1).not.toBe(id2)
      expect(id1).toMatch(/^proj_\d+_[a-z0-9]+$/)
    })
  })

  describe("projectManager", () => {
    describe("addProject", () => {
      it("should add a new project", () => {
        const project = projectManager.addProject("user/repo")
        expect(project.name).toBe("Repo")
        expect(project.repoUrl).toBe("https://github.com/user/repo")
        expect(project.id).toMatch(/^proj_/)
      })

      it("should use custom name when provided", () => {
        const project = projectManager.addProject("user/repo", "My Custom Name")
        expect(project.name).toBe("My Custom Name")
      })

      it("should not add duplicate projects", () => {
        const project1 = projectManager.addProject("user/repo")
        const project2 = projectManager.addProject("user/repo")
        expect(project1.id).toBe(project2.id)
      })

      it("should reject invalid URLs", () => {
        expect(() => projectManager.addProject("")).toThrow()
      })
    })

    describe("getProjects", () => {
      it("should return empty array when no projects", () => {
        const projects = projectManager.getProjects()
        expect(projects).toEqual([])
      })

      it("should return all added projects", () => {
        projectManager.addProject("user/repo1")
        projectManager.addProject("user/repo2")
        const projects = projectManager.getProjects()
        expect(projects.length).toBe(2)
      })
    })

    describe("getProject", () => {
      it("should return project by ID", () => {
        const project = projectManager.addProject("user/repo")
        const found = projectManager.getProject(project.id)
        expect(found?.name).toBe("Repo")
      })

      it("should return undefined for unknown ID", () => {
        const found = projectManager.getProject("unknown")
        expect(found).toBeUndefined()
      })
    })

    describe("setChannelProject / getChannelProject", () => {
      it("should set and get channel project", () => {
        const project = projectManager.addProject("user/repo")
        projectManager.setChannelProject("channel-123", project.id)
        
        const found = projectManager.getChannelProject("channel-123")
        expect(found?.id).toBe(project.id)
      })

      it("should return undefined for unknown channel", () => {
        const found = projectManager.getChannelProject("unknown-channel")
        expect(found).toBeUndefined()
      })

      it("should clear channel project", () => {
        const project = projectManager.addProject("user/repo")
        projectManager.setChannelProject("channel-123", project.id)
        projectManager.clearChannelProject("channel-123")
        
        const found = projectManager.getChannelProject("channel-123")
        expect(found).toBeUndefined()
      })
    })

    describe("removeProject", () => {
      it("should remove project and clear channel mappings", () => {
        const project = projectManager.addProject("user/repo")
        projectManager.setChannelProject("channel-123", project.id)
        
        const removed = projectManager.removeProject(project.id)
        expect(removed).toBe(true)
        
        const found = projectManager.getProject(project.id)
        expect(found).toBeUndefined()
        
        const channelProject = projectManager.getChannelProject("channel-123")
        expect(channelProject).toBeUndefined()
      })

      it("should return false for unknown project", () => {
        const removed = projectManager.removeProject("unknown")
        expect(removed).toBe(false)
      })
    })
  })
})
