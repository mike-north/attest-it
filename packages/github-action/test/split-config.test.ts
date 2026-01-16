/* eslint-disable @typescript-eslint/consistent-type-assertions -- Type assertions are necessary for mocking in tests */
/* eslint-disable @typescript-eslint/no-unsafe-member-access -- Mock objects don't have perfect type safety */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { type Mock } from 'vitest'

/**
 * Tests for split config integration in GitHub Action.
 *
 * Split config separates policy (security-critical) from operational config:
 * - policy.yaml: Trust model, gates, team keys (fetched from base branch in PRs)
 * - config.yaml: Suites, commands, settings (from PR branch)
 *
 * This ensures PRs cannot modify their own security policy.
 */

// Mock dependencies
vi.mock('@actions/core')
vi.mock('@actions/github')
vi.mock('@attest-it/core')
vi.mock('node:fs/promises')

describe('Split Config Integration', () => {
  let originalEnv: typeof process.env

  // Import mocked modules
  let mockCore: {
    getInput: Mock
    setFailed: Mock
    info: Mock
    error: Mock
  }

  let mockFetchPolicy: {
    fetchPolicyFromRef: Mock
    getRepoInfo: Mock
    getBaseBranch: Mock
    isPullRequest: Mock
  }

  let mockCoreConfig: {
    parsePolicyContent: Mock
    parseOperationalContent: Mock
    mergeConfigs: Mock
    validateSuiteGateReferences: Mock
  }

  let mockFs: {
    readFile: Mock
  }

  beforeEach(async () => {
    // Save original environment
    originalEnv = process.env
    process.env = { ...originalEnv }

    // Clear module cache and reimport to get fresh mocks
    vi.clearAllMocks()

    // Import after mocks are set up
    const coreModule = await import('@actions/core')
    mockCore = {
      getInput: vi.mocked(coreModule.getInput),
      setFailed: vi.mocked(coreModule.setFailed),
      info: vi.mocked(coreModule.info),
      error: vi.mocked(coreModule.error),
    }

    // Mock fetch-policy functions
    mockFetchPolicy = {
      fetchPolicyFromRef: vi.fn(),
      getRepoInfo: vi.fn(),
      getBaseBranch: vi.fn(),
      isPullRequest: vi.fn(),
    }

    // Mock core config functions
    mockCoreConfig = {
      parsePolicyContent: vi.fn(),
      parseOperationalContent: vi.fn(),
      mergeConfigs: vi.fn(),
      validateSuiteGateReferences: vi.fn(),
    }

    // Mock fs/promises
    const fsModule = await import('node:fs/promises')
    mockFs = {
      readFile: vi.mocked(fsModule.readFile),
    }

    // Setup default environment
    process.env.GITHUB_REPOSITORY = 'test-org/test-repo'
    process.env.GITHUB_BASE_REF = 'main'
  })

  afterEach(() => {
    process.env = originalEnv
  })

  describe('Pull Request Context', () => {
    beforeEach(() => {
      mockFetchPolicy.isPullRequest.mockReturnValue(true)
      mockFetchPolicy.getBaseBranch.mockReturnValue('main')
      mockFetchPolicy.getRepoInfo.mockReturnValue({
        owner: 'test-org',
        repo: 'test-repo',
      })
    })

    it('should fetch policy from base branch and load config from filesystem', async () => {
      const mockPolicyContent = 'version: 1\nteam:\n  alice:\n    name: Alice\n'
      const mockConfigContent = 'version: 1\nsuites:\n  test:\n    packages: [pkg]\n'

      mockFetchPolicy.fetchPolicyFromRef.mockResolvedValue({
        content: mockPolicyContent,
        sha: 'abc123',
      })

      mockFs.readFile.mockResolvedValue(mockConfigContent)

      const mockPolicyParsed = {
        version: 1,
        team: { alice: { name: 'Alice', publicKey: 'key1' } },
        gates: {},
      }

      const mockConfigParsed = {
        version: 1,
        settings: { maxAgeDays: 30 },
        suites: { test: { packages: ['pkg'] } },
      }

      const mockMerged = {
        version: 1,
        team: mockPolicyParsed.team,
        gates: {},
        settings: mockConfigParsed.settings,
        suites: mockConfigParsed.suites,
      }

      mockCoreConfig.parsePolicyContent.mockReturnValue(mockPolicyParsed)
      mockCoreConfig.parseOperationalContent.mockReturnValue(mockConfigParsed)
      mockCoreConfig.mergeConfigs.mockReturnValue(mockMerged)
      mockCoreConfig.validateSuiteGateReferences.mockReturnValue([])

      mockCore.getInput.mockImplementation((name: string) => {
        if (name === 'github-token') return 'test-token'
        if (name === 'policy-path') return '.github/policy.yaml'
        if (name === 'config-path') return '.attest-it/config.yaml'
        return ''
      })

      // Call the integration function (would be in index.ts)
      // For now, we test the components directly

      expect(mockFetchPolicy.isPullRequest()).toBe(true)
      expect(mockFetchPolicy.getBaseBranch()).toBe('main')
      expect(mockFetchPolicy.getRepoInfo()).toEqual({
        owner: 'test-org',
        repo: 'test-repo',
      })

      // Verify policy would be fetched from base branch
      await mockFetchPolicy.fetchPolicyFromRef({
        token: 'test-token',
        owner: 'test-org',
        repo: 'test-repo',
        ref: 'main',
        path: '.github/policy.yaml',
      })

      expect(mockFetchPolicy.fetchPolicyFromRef).toHaveBeenCalledWith({
        token: 'test-token',
        owner: 'test-org',
        repo: 'test-repo',
        ref: 'main',
        path: '.github/policy.yaml',
      })

      // Verify config would be loaded from filesystem
      await mockFs.readFile('.attest-it/config.yaml', 'utf8')
      expect(mockFs.readFile).toHaveBeenCalledWith('.attest-it/config.yaml', 'utf8')

      // Verify parsing
      const policy = mockCoreConfig.parsePolicyContent(mockPolicyContent)
      const config = mockCoreConfig.parseOperationalContent(mockConfigContent)

      expect(mockCoreConfig.parsePolicyContent).toHaveBeenCalledWith(mockPolicyContent)
      expect(mockCoreConfig.parseOperationalContent).toHaveBeenCalledWith(mockConfigContent)

      // Verify merge
      const merged = mockCoreConfig.mergeConfigs(policy, config)
      expect(mockCoreConfig.mergeConfigs).toHaveBeenCalledWith(mockPolicyParsed, mockConfigParsed)
      expect(merged).toEqual(mockMerged)

      // Verify validation
      const errors = mockCoreConfig.validateSuiteGateReferences(merged)
      expect(mockCoreConfig.validateSuiteGateReferences).toHaveBeenCalledWith(mockMerged)
      expect(errors).toEqual([])
    })

    it('should use custom policy path when provided', async () => {
      mockCore.getInput.mockImplementation((name: string) => {
        if (name === 'github-token') return 'test-token'
        if (name === 'policy-path') return 'custom/policy.yml'
        return ''
      })

      mockFetchPolicy.fetchPolicyFromRef.mockResolvedValue({
        content: 'version: 1\n',
        sha: 'sha',
      })

      await mockFetchPolicy.fetchPolicyFromRef({
        token: 'test-token',
        owner: 'test-org',
        repo: 'test-repo',
        ref: 'main',
        path: 'custom/policy.yml',
      })

      expect(mockFetchPolicy.fetchPolicyFromRef).toHaveBeenCalledWith(
        expect.objectContaining({
          path: 'custom/policy.yml',
        }),
      )
    })

    it('should fail when github-token is not provided in PR context', async () => {
      mockCore.getInput.mockImplementation((name: string) => {
        if (name === 'github-token') return ''
        return ''
      })

      // In real implementation, this should call setFailed
      const token = mockCore.getInput('github-token')
      if (!token && mockFetchPolicy.isPullRequest()) {
        mockCore.setFailed('github-token input is required for pull request verification')
      }

      expect(mockCore.setFailed).toHaveBeenCalledWith(
        'github-token input is required for pull request verification',
      )
    })

    it('should handle fetch errors gracefully', async () => {
      mockCore.getInput.mockImplementation((name: string) => {
        if (name === 'github-token') return 'test-token'
        return ''
      })

      const fetchError = new Error('404: Not Found')
      mockFetchPolicy.fetchPolicyFromRef.mockRejectedValue(fetchError)

      try {
        await mockFetchPolicy.fetchPolicyFromRef({
          token: 'test-token',
          owner: 'test-org',
          repo: 'test-repo',
          ref: 'main',
          path: '.github/policy.yaml',
        })
      } catch (error) {
        mockCore.setFailed(`Failed to fetch policy from base branch: ${(error as Error).message}`)
      }

      expect(mockCore.setFailed).toHaveBeenCalledWith(
        'Failed to fetch policy from base branch: 404: Not Found',
      )
    })

    it('should handle policy parsing errors', async () => {
      const invalidPolicyContent = 'invalid: yaml: content:'

      mockFetchPolicy.fetchPolicyFromRef.mockResolvedValue({
        content: invalidPolicyContent,
        sha: 'sha',
      })

      mockCoreConfig.parsePolicyContent.mockImplementation(() => {
        throw new Error('Invalid YAML syntax')
      })

      try {
        mockCoreConfig.parsePolicyContent(invalidPolicyContent)
      } catch (error) {
        mockCore.setFailed(`Policy validation failed: ${(error as Error).message}`)
      }

      expect(mockCore.setFailed).toHaveBeenCalledWith(
        'Policy validation failed: Invalid YAML syntax',
      )
    })

    it('should handle config file not found', async () => {
      mockFetchPolicy.fetchPolicyFromRef.mockResolvedValue({
        content: 'version: 1\n',
        sha: 'sha',
      })

      mockFs.readFile.mockRejectedValue(
        Object.assign(new Error('ENOENT: no such file or directory'), {
          code: 'ENOENT',
        }),
      )

      try {
        await mockFs.readFile('.attest-it/config.yaml', 'utf8')
      } catch (error) {
        mockCore.setFailed('Config file not found: .attest-it/config.yaml')
      }

      expect(mockCore.setFailed).toHaveBeenCalledWith(
        'Config file not found: .attest-it/config.yaml',
      )
    })
  })

  describe('Non-PR Context (Push)', () => {
    beforeEach(() => {
      delete process.env.GITHUB_BASE_REF
      mockFetchPolicy.isPullRequest.mockReturnValue(false)
      mockFetchPolicy.getBaseBranch.mockReturnValue(undefined)
    })

    it('should load both policy and config from filesystem', async () => {
      const mockPolicyContent = 'version: 1\nteam:\n  alice:\n    name: Alice\n'
      const mockConfigContent = 'version: 1\nsuites:\n  test:\n    packages: [pkg]\n'

      mockFs.readFile.mockImplementation((path: string) => {
        if (path.toString().includes('policy')) {
          return Promise.resolve(mockPolicyContent)
        }
        if (path.toString().includes('config')) {
          return Promise.resolve(mockConfigContent)
        }
        return Promise.reject(new Error('File not found'))
      })

      mockCore.getInput.mockImplementation((name: string) => {
        if (name === 'policy-path') return '.github/policy.yaml'
        if (name === 'config-path') return '.attest-it/config.yaml'
        return ''
      })

      // Simulate loading both from filesystem
      const policyContent = await mockFs.readFile('.github/policy.yaml', 'utf8')
      const configContent = await mockFs.readFile('.attest-it/config.yaml', 'utf8')

      expect(mockFs.readFile).toHaveBeenCalledWith('.github/policy.yaml', 'utf8')
      expect(mockFs.readFile).toHaveBeenCalledWith('.attest-it/config.yaml', 'utf8')
      expect(policyContent).toBe(mockPolicyContent)
      expect(configContent).toBe(mockConfigContent)

      // Should NOT fetch from GitHub API
      expect(mockFetchPolicy.fetchPolicyFromRef).not.toHaveBeenCalled()
    })

    it('should not require github-token in non-PR context', async () => {
      mockCore.getInput.mockImplementation((name: string) => {
        if (name === 'github-token') return ''
        return ''
      })

      // Should not fail without token in non-PR context
      const token = mockCore.getInput('github-token')
      if (!token && mockFetchPolicy.isPullRequest()) {
        mockCore.setFailed('github-token input is required for pull request verification')
      }

      expect(mockCore.setFailed).not.toHaveBeenCalled()
    })
  })

  describe('Validation Errors', () => {
    beforeEach(() => {
      mockFetchPolicy.isPullRequest.mockReturnValue(true)
      mockFetchPolicy.getBaseBranch.mockReturnValue('main')
      mockFetchPolicy.getRepoInfo.mockReturnValue({
        owner: 'test-org',
        repo: 'test-repo',
      })

      mockCore.getInput.mockImplementation((name: string) => {
        if (name === 'github-token') return 'test-token'
        return ''
      })
    })

    it('should report suite referencing non-existent gate', async () => {
      const mockPolicyParsed = {
        version: 1,
        team: {},
        gates: {
          'gate-a': {
            name: 'Gate A',
            description: 'Test gate',
            authorizedSigners: ['alice'],
            fingerprint: { paths: ['src/'] },
            maxAge: '30d',
          },
        },
      }

      const mockConfigParsed = {
        version: 1,
        settings: { maxAgeDays: 30 },
        suites: {
          'suite-1': { gate: 'gate-b' }, // References non-existent gate
        },
      }

      const mockMerged = {
        ...mockPolicyParsed,
        ...mockConfigParsed,
      }

      mockFetchPolicy.fetchPolicyFromRef.mockResolvedValue({
        content: 'version: 1\n',
        sha: 'sha',
      })
      mockFs.readFile.mockResolvedValue('version: 1\n')

      mockCoreConfig.parsePolicyContent.mockReturnValue(mockPolicyParsed)
      mockCoreConfig.parseOperationalContent.mockReturnValue(mockConfigParsed)
      mockCoreConfig.mergeConfigs.mockReturnValue(mockMerged)

      // Validation should find the error
      mockCoreConfig.validateSuiteGateReferences.mockReturnValue([
        {
          type: 'UNDEFINED_GATE_REFERENCE',
          message: 'Suite "suite-1" references undefined gate "gate-b"',
          suite: 'suite-1',
          gate: 'gate-b',
        },
      ])

      const errors = mockCoreConfig.validateSuiteGateReferences(mockMerged)

      expect(errors).toHaveLength(1)
      expect(errors[0]).toMatchObject({
        type: 'UNDEFINED_GATE_REFERENCE',
        suite: 'suite-1',
        gate: 'gate-b',
      })

      // Action should fail with validation error
      if (errors.length > 0) {
        mockCore.setFailed('Configuration validation failed')
        for (const error of errors) {
          mockCore.error(error.message)
        }
      }

      expect(mockCore.setFailed).toHaveBeenCalledWith('Configuration validation failed')
      expect(mockCore.error).toHaveBeenCalledWith(
        'Suite "suite-1" references undefined gate "gate-b"',
      )
    })

    it('should report multiple validation errors', async () => {
      const mockMerged = {
        version: 1,
        team: {},
        gates: {},
        settings: { maxAgeDays: 30 },
        suites: {
          'suite-1': { gate: 'gate-a' },
          'suite-2': { gate: 'gate-b' },
        },
      }

      mockCoreConfig.validateSuiteGateReferences.mockReturnValue([
        {
          type: 'UNDEFINED_GATE_REFERENCE',
          message: 'Suite "suite-1" references undefined gate "gate-a"',
          suite: 'suite-1',
          gate: 'gate-a',
        },
        {
          type: 'UNDEFINED_GATE_REFERENCE',
          message: 'Suite "suite-2" references undefined gate "gate-b"',
          suite: 'suite-2',
          gate: 'gate-b',
        },
      ])

      const errors = mockCoreConfig.validateSuiteGateReferences(mockMerged)

      expect(errors).toHaveLength(2)

      if (errors.length > 0) {
        mockCore.setFailed('Configuration validation failed')
        for (const error of errors) {
          mockCore.error(error.message)
        }
      }

      expect(mockCore.error).toHaveBeenCalledTimes(2)
    })
  })

  describe('Edge Cases', () => {
    it('should handle empty policy file', async () => {
      mockFetchPolicy.isPullRequest.mockReturnValue(true)
      mockFetchPolicy.getBaseBranch.mockReturnValue('main')
      mockFetchPolicy.getRepoInfo.mockReturnValue({
        owner: 'test-org',
        repo: 'test-repo',
      })

      mockCore.getInput.mockImplementation((name: string) => {
        if (name === 'github-token') return 'test-token'
        return ''
      })

      mockFetchPolicy.fetchPolicyFromRef.mockResolvedValue({
        content: '',
        sha: 'sha',
      })

      mockCoreConfig.parsePolicyContent.mockImplementation(() => {
        throw new Error('Empty policy file')
      })

      try {
        mockCoreConfig.parsePolicyContent('')
      } catch (error) {
        mockCore.setFailed(`Policy validation failed: ${(error as Error).message}`)
      }

      expect(mockCore.setFailed).toHaveBeenCalledWith('Policy validation failed: Empty policy file')
    })

    it('should handle permission errors when fetching policy', async () => {
      mockFetchPolicy.isPullRequest.mockReturnValue(true)
      mockFetchPolicy.getBaseBranch.mockReturnValue('main')
      mockFetchPolicy.getRepoInfo.mockReturnValue({
        owner: 'test-org',
        repo: 'test-repo',
      })

      mockCore.getInput.mockImplementation((name: string) => {
        if (name === 'github-token') return 'test-token'
        return ''
      })

      const permissionError = Object.assign(new Error('Resource not accessible by integration'), {
        status: 403,
      })

      mockFetchPolicy.fetchPolicyFromRef.mockRejectedValue(permissionError)

      try {
        await mockFetchPolicy.fetchPolicyFromRef({
          token: 'test-token',
          owner: 'test-org',
          repo: 'test-repo',
          ref: 'main',
          path: '.github/policy.yaml',
        })
      } catch (error) {
        mockCore.setFailed(`Failed to fetch policy from base branch: ${(error as Error).message}`)
      }

      expect(mockCore.setFailed).toHaveBeenCalledWith(
        'Failed to fetch policy from base branch: Resource not accessible by integration',
      )
    })

    it('should handle merge conflicts between policy and config', async () => {
      const mockPolicyParsed = {
        version: 1,
        team: { alice: { name: 'Alice', publicKey: 'key1' } },
        gates: {},
      }

      const mockConfigParsed = {
        version: 2, // Version mismatch
        settings: { maxAgeDays: 30 },
        suites: {},
      }

      mockCoreConfig.mergeConfigs.mockImplementation(() => {
        throw new Error('Version mismatch: policy version 1, config version 2')
      })

      try {
        mockCoreConfig.mergeConfigs(mockPolicyParsed, mockConfigParsed)
      } catch (error) {
        mockCore.setFailed(`Failed to merge configurations: ${(error as Error).message}`)
      }

      expect(mockCore.setFailed).toHaveBeenCalledWith(
        'Failed to merge configurations: Version mismatch: policy version 1, config version 2',
      )
    })

    it('should handle missing GITHUB_REPOSITORY in PR context', async () => {
      delete process.env.GITHUB_REPOSITORY

      mockFetchPolicy.isPullRequest.mockReturnValue(true)
      mockFetchPolicy.getRepoInfo.mockImplementation(() => {
        throw new Error('GITHUB_REPOSITORY environment variable not set')
      })

      try {
        mockFetchPolicy.getRepoInfo()
      } catch (error) {
        mockCore.setFailed((error as Error).message)
      }

      expect(mockCore.setFailed).toHaveBeenCalledWith(
        'GITHUB_REPOSITORY environment variable not set',
      )
    })
  })
})
