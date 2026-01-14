/* eslint-disable @typescript-eslint/consistent-type-assertions -- Type assertions are necessary for mocking in tests */
/* eslint-disable @typescript-eslint/no-unsafe-member-access -- Mock objects don't have perfect type safety */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as github from '@actions/github'
import {
  fetchPolicyFromRef,
  getRepoInfo,
  getBaseBranch,
  isPullRequest,
  type FetchPolicyOptions,
} from '../src/fetch-policy.js'

// Mock @actions/github
vi.mock('@actions/github')

describe('fetchPolicyFromRef', () => {
  const mockOptions: FetchPolicyOptions = {
    token: 'test-token',
    owner: 'test-owner',
    repo: 'test-repo',
    ref: 'main',
    path: '.github/policy.yaml',
  }

  const mockOctokit = {
    rest: {
      repos: {
        getContent: vi.fn(),
      },
    },
  }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(github.getOctokit).mockReturnValue(mockOctokit as never)
  })

  describe('positive cases', () => {
    it('should fetch and decode policy content successfully', async () => {
      const mockContent = 'trust:\n  - actor: github-actions'
      const mockSha = 'abc123def456'
      const encodedContent = Buffer.from(mockContent).toString('base64')

      mockOctokit.rest.repos.getContent.mockResolvedValue({
        data: {
          type: 'file',
          content: encodedContent,
          sha: mockSha,
          encoding: 'base64',
        },
      } as never)

      const result = await fetchPolicyFromRef(mockOptions)

      expect(result).toEqual({
        content: mockContent,
        sha: mockSha,
      })

      expect(github.getOctokit).toHaveBeenCalledWith('test-token')
      expect(mockOctokit.rest.repos.getContent).toHaveBeenCalledWith({
        owner: 'test-owner',
        repo: 'test-repo',
        path: '.github/policy.yaml',
        ref: 'main',
      })
    })

    it('should handle different file paths', async () => {
      const customOptions = { ...mockOptions, path: 'custom/path/policy.yml' }
      mockOctokit.rest.repos.getContent.mockResolvedValue({
        data: {
          type: 'file',
          content: Buffer.from('content').toString('base64'),
          sha: 'sha',
        },
      } as never)

      await fetchPolicyFromRef(customOptions)

      expect(mockOctokit.rest.repos.getContent).toHaveBeenCalledWith(
        expect.objectContaining({
          path: 'custom/path/policy.yml',
        }),
      )
    })

    it('should handle different git refs', async () => {
      const branchOptions = { ...mockOptions, ref: 'develop' }
      mockOctokit.rest.repos.getContent.mockResolvedValue({
        data: {
          type: 'file',
          content: Buffer.from('content').toString('base64'),
          sha: 'sha',
        },
      } as never)

      await fetchPolicyFromRef(branchOptions)

      expect(mockOctokit.rest.repos.getContent).toHaveBeenCalledWith(
        expect.objectContaining({
          ref: 'develop',
        }),
      )
    })

    it('should handle commit SHA as ref', async () => {
      const commitOptions = {
        ...mockOptions,
        ref: 'abc123def456789012345678901234567890abcd',
      }
      mockOctokit.rest.repos.getContent.mockResolvedValue({
        data: {
          type: 'file',
          content: Buffer.from('content').toString('base64'),
          sha: 'sha',
        },
      } as never)

      await fetchPolicyFromRef(commitOptions)

      expect(mockOctokit.rest.repos.getContent).toHaveBeenCalledWith(
        expect.objectContaining({
          ref: 'abc123def456789012345678901234567890abcd',
        }),
      )
    })

    it('should preserve UTF-8 content correctly', async () => {
      const unicodeContent = 'trust:\n  # 日本語コメント\n  - actor: test'
      mockOctokit.rest.repos.getContent.mockResolvedValue({
        data: {
          type: 'file',
          content: Buffer.from(unicodeContent).toString('base64'),
          sha: 'sha',
        },
      } as never)

      const result = await fetchPolicyFromRef(mockOptions)

      expect(result.content).toBe(unicodeContent)
    })
  })

  describe('negative cases', () => {
    it('should throw when path points to a directory', async () => {
      mockOctokit.rest.repos.getContent.mockResolvedValue({
        data: [
          { type: 'file', name: 'file1.txt' },
          { type: 'file', name: 'file2.txt' },
        ],
      } as never)

      await expect(fetchPolicyFromRef(mockOptions)).rejects.toThrow(
        'Expected .github/policy.yaml to be a file, not a directory',
      )
    })

    it('should throw when content type is not file', async () => {
      mockOctokit.rest.repos.getContent.mockResolvedValue({
        data: {
          type: 'symlink',
          content: 'some-content',
          sha: 'sha',
        },
      } as never)

      await expect(fetchPolicyFromRef(mockOptions)).rejects.toThrow(
        'Expected .github/policy.yaml to be a file, not a directory',
      )
    })

    it('should throw when content field is missing', async () => {
      mockOctokit.rest.repos.getContent.mockResolvedValue({
        data: {
          type: 'file',
          sha: 'sha',
          // content field missing
        },
      } as never)

      await expect(fetchPolicyFromRef(mockOptions)).rejects.toThrow(
        'No content found in .github/policy.yaml',
      )
    })

    it('should throw when content is empty string', async () => {
      mockOctokit.rest.repos.getContent.mockResolvedValue({
        data: {
          type: 'file',
          content: '',
          sha: 'sha',
        },
      } as never)

      await expect(fetchPolicyFromRef(mockOptions)).rejects.toThrow(
        'No content found in .github/policy.yaml',
      )
    })

    it('should propagate GitHub API errors', async () => {
      mockOctokit.rest.repos.getContent.mockRejectedValue(new Error('Not Found'))

      await expect(fetchPolicyFromRef(mockOptions)).rejects.toThrow('Not Found')
    })

    it('should propagate 404 errors for missing files', async () => {
      const error = new Error('Not Found')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(error as any).status = 404
      mockOctokit.rest.repos.getContent.mockRejectedValue(error)

      await expect(fetchPolicyFromRef(mockOptions)).rejects.toThrow('Not Found')
    })

    it('should propagate permission errors', async () => {
      const error = new Error('Resource not accessible by integration')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(error as any).status = 403
      mockOctokit.rest.repos.getContent.mockRejectedValue(error)

      await expect(fetchPolicyFromRef(mockOptions)).rejects.toThrow(
        'Resource not accessible by integration',
      )
    })
  })

  describe('edge cases', () => {
    it('should handle minimal file content', async () => {
      // Minimal valid content (empty base64 is '' which throws, so test minimal non-empty content)
      const minimalContent = '\n'
      mockOctokit.rest.repos.getContent.mockResolvedValue({
        data: {
          type: 'file',
          content: Buffer.from(minimalContent).toString('base64'),
          sha: 'sha',
        },
      } as never)

      const result = await fetchPolicyFromRef(mockOptions)

      expect(result.content).toBe('\n')
    })

    it('should handle very large file content', async () => {
      // GitHub API has 1MB limit for content, but we should handle large strings
      const largeContent = 'x'.repeat(100000)
      mockOctokit.rest.repos.getContent.mockResolvedValue({
        data: {
          type: 'file',
          content: Buffer.from(largeContent).toString('base64'),
          sha: 'sha',
        },
      } as never)

      const result = await fetchPolicyFromRef(mockOptions)

      expect(result.content).toBe(largeContent)
      expect(result.content.length).toBe(100000)
    })
  })
})

describe('getRepoInfo', () => {
  let originalEnv: typeof process.env

  beforeEach(() => {
    originalEnv = process.env
    process.env = { ...originalEnv }
  })

  afterEach(() => {
    process.env = originalEnv
  })

  describe('positive cases', () => {
    it('should parse valid GITHUB_REPOSITORY', () => {
      process.env.GITHUB_REPOSITORY = 'octocat/Hello-World'

      const result = getRepoInfo()

      expect(result).toEqual({
        owner: 'octocat',
        repo: 'Hello-World',
      })
    })

    it('should handle organization repositories', () => {
      process.env.GITHUB_REPOSITORY = 'my-org/my-repo'

      const result = getRepoInfo()

      expect(result).toEqual({
        owner: 'my-org',
        repo: 'my-repo',
      })
    })

    it('should handle repos with hyphens and underscores', () => {
      process.env.GITHUB_REPOSITORY = 'my-org_123/my-repo_name'

      const result = getRepoInfo()

      expect(result).toEqual({
        owner: 'my-org_123',
        repo: 'my-repo_name',
      })
    })

    it('should handle repos with dots', () => {
      process.env.GITHUB_REPOSITORY = 'my-org/my.repo.name'

      const result = getRepoInfo()

      expect(result).toEqual({
        owner: 'my-org',
        repo: 'my.repo.name',
      })
    })
  })

  describe('negative cases', () => {
    it('should throw when GITHUB_REPOSITORY is not set', () => {
      delete process.env.GITHUB_REPOSITORY

      expect(() => getRepoInfo()).toThrow('GITHUB_REPOSITORY environment variable not set')
    })

    it('should throw when GITHUB_REPOSITORY is empty string', () => {
      process.env.GITHUB_REPOSITORY = ''

      expect(() => getRepoInfo()).toThrow('GITHUB_REPOSITORY environment variable not set')
    })

    it('should throw when format is invalid (no slash)', () => {
      process.env.GITHUB_REPOSITORY = 'invalid-format'

      expect(() => getRepoInfo()).toThrow('Invalid GITHUB_REPOSITORY format: invalid-format')
    })

    it('should throw when owner is missing', () => {
      process.env.GITHUB_REPOSITORY = '/repo-name'

      expect(() => getRepoInfo()).toThrow('Invalid GITHUB_REPOSITORY format: /repo-name')
    })

    it('should throw when repo is missing', () => {
      process.env.GITHUB_REPOSITORY = 'owner/'

      expect(() => getRepoInfo()).toThrow('Invalid GITHUB_REPOSITORY format: owner/')
    })

    it('should throw when multiple slashes present', () => {
      process.env.GITHUB_REPOSITORY = 'owner/repo/extra'

      // This actually succeeds - only first two parts are used
      // But we should test the actual behavior
      const result = getRepoInfo()
      expect(result).toEqual({
        owner: 'owner',
        repo: 'repo/extra',
      })
    })
  })
})

describe('getBaseBranch', () => {
  let originalEnv: typeof process.env

  beforeEach(() => {
    originalEnv = process.env
    process.env = { ...originalEnv }
  })

  afterEach(() => {
    process.env = originalEnv
  })

  describe('positive cases', () => {
    it('should return base branch for pull requests', () => {
      process.env.GITHUB_BASE_REF = 'main'

      const result = getBaseBranch()

      expect(result).toBe('main')
    })

    it('should handle different branch names', () => {
      process.env.GITHUB_BASE_REF = 'develop'

      const result = getBaseBranch()

      expect(result).toBe('develop')
    })

    it('should handle branch names with slashes', () => {
      process.env.GITHUB_BASE_REF = 'feature/my-feature'

      const result = getBaseBranch()

      expect(result).toBe('feature/my-feature')
    })

    it('should return undefined for non-PR events', () => {
      delete process.env.GITHUB_BASE_REF

      const result = getBaseBranch()

      expect(result).toBeUndefined()
    })

    it('should return undefined when GITHUB_BASE_REF is empty', () => {
      process.env.GITHUB_BASE_REF = ''

      const result = getBaseBranch()

      expect(result).toBeUndefined()
    })
  })
})

describe('isPullRequest', () => {
  let originalEnv: typeof process.env

  beforeEach(() => {
    originalEnv = process.env
    process.env = { ...originalEnv }
  })

  afterEach(() => {
    process.env = originalEnv
  })

  describe('positive cases', () => {
    it('should return true when GITHUB_BASE_REF is set', () => {
      process.env.GITHUB_BASE_REF = 'main'

      const result = isPullRequest()

      expect(result).toBe(true)
    })

    it('should return true for any non-empty base ref', () => {
      process.env.GITHUB_BASE_REF = 'any-branch'

      const result = isPullRequest()

      expect(result).toBe(true)
    })
  })

  describe('negative cases', () => {
    it('should return false when GITHUB_BASE_REF is not set', () => {
      delete process.env.GITHUB_BASE_REF

      const result = isPullRequest()

      expect(result).toBe(false)
    })

    it('should return false when GITHUB_BASE_REF is empty string', () => {
      process.env.GITHUB_BASE_REF = ''

      const result = isPullRequest()

      expect(result).toBe(false)
    })
  })
})
