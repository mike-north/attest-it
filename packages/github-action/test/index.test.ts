/* eslint-disable @typescript-eslint/consistent-type-assertions -- Type assertions are necessary for mocking in tests */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createMockVerifyResult, createMockSuiteStatus, createMockConfig } from './test-helpers.js'

// Mock @actions/core
vi.mock('@actions/core', () => ({
  getInput: vi.fn(),
  setOutput: vi.fn(),
  setFailed: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
  startGroup: vi.fn(),
  endGroup: vi.fn(),
}))

// Mock @attest-it/core
vi.mock('@attest-it/core', () => ({
  loadConfig: vi.fn(),
  verifyAttestations: vi.fn(),
  toAttestItConfig: vi.fn(),
  parsePolicyContent: vi.fn(),
  parseOperationalContent: vi.fn(),
  mergeConfigs: vi.fn(),
  validateSuiteGateReferences: vi.fn(),
  PolicyValidationError: class PolicyValidationError extends Error {
    constructor(message: string) {
      super(message)
      this.name = 'PolicyValidationError'
    }
  },
  OperationalValidationError: class OperationalValidationError extends Error {
    constructor(message: string) {
      super(message)
      this.name = 'OperationalValidationError'
    }
  },
}))

// Mock fetch-policy module
vi.mock('../src/fetch-policy.js', () => ({
  fetchPolicyFromRef: vi.fn(),
  getRepoInfo: vi.fn(),
  getBaseBranch: vi.fn(),
  isPullRequest: vi.fn(),
}))

// Mock node:fs/promises
vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
}))

// Import after mocks are set up
const { run } = await import('../src/index.js')
const mockCoreModule = await import('@actions/core')
const mockAttestItCoreModule = await import('@attest-it/core')
const mockFetchPolicyModule = await import('../src/fetch-policy.js')
const mockFsModule = await import('node:fs/promises')

// Use vi.mocked to get properly typed mocks
const mockCore = {
  getInput: vi.mocked(mockCoreModule.getInput),
  setOutput: vi.mocked(mockCoreModule.setOutput),
  setFailed: vi.mocked(mockCoreModule.setFailed),
  info: vi.mocked(mockCoreModule.info),
  error: vi.mocked(mockCoreModule.error),
  warning: vi.mocked(mockCoreModule.warning),
  startGroup: vi.mocked(mockCoreModule.startGroup),
  endGroup: vi.mocked(mockCoreModule.endGroup),
}

const mockVerifyAttestations = vi.mocked(mockAttestItCoreModule.verifyAttestations)
const mockParsePolicyContent = vi.mocked(mockAttestItCoreModule.parsePolicyContent)
const mockParseOperationalContent = vi.mocked(mockAttestItCoreModule.parseOperationalContent)
const mockMergeConfigs = vi.mocked(mockAttestItCoreModule.mergeConfigs)
const mockValidateSuiteGateReferences = vi.mocked(
  mockAttestItCoreModule.validateSuiteGateReferences,
)

const mockFetchPolicy = {
  fetchPolicyFromRef: vi.mocked(mockFetchPolicyModule.fetchPolicyFromRef),
  getRepoInfo: vi.mocked(mockFetchPolicyModule.getRepoInfo),
  getBaseBranch: vi.mocked(mockFetchPolicyModule.getBaseBranch),
  isPullRequest: vi.mocked(mockFetchPolicyModule.isPullRequest),
}

const mockReadFile = vi.mocked(mockFsModule.readFile)

describe('GitHub Action', () => {
  let originalEnv: typeof process.env
  let originalCwd: string

  beforeEach(() => {
    // Reset all mocks
    vi.clearAllMocks()

    // Save environment
    originalEnv = process.env
    process.env = { ...originalEnv }
    originalCwd = process.cwd()

    // Default input values
    mockCore.getInput.mockImplementation((name: string) => {
      const defaults: Record<string, string> = {
        'working-directory': '.',
        'config-path': '',
        'github-token': 'test-token',
        'policy-path': '.attest-it/policy.yaml',
        'policy-ref': '',
        suite: '',
        'fail-on-missing': 'true',
        strict: 'false',
      }
      return defaults[name] ?? ''
    })

    // Default: non-PR context (simpler to test)
    mockFetchPolicy.isPullRequest.mockReturnValue(false)
    mockFetchPolicy.getBaseBranch.mockReturnValue(undefined)
  })

  afterEach(() => {
    process.env = originalEnv
    try {
      process.chdir(originalCwd)
    } catch {
      // Ignore if directory doesn't exist
    }
  })

  describe('Successful verification', () => {
    beforeEach(() => {
      // Setup valid config and verification
      const mockPolicy = { version: 1, team: {}, gates: {} }
      const mockOperational = {
        version: 1,
        settings: { maxAgeDays: 30 },
        suites: { 'unit-tests': { packages: ['src'] } },
      }
      const mockConfig = createMockConfig()

      mockReadFile.mockResolvedValue('version: 1')
      mockParsePolicyContent.mockReturnValue(mockPolicy as never)
      mockParseOperationalContent.mockReturnValue(mockOperational as never)
      mockMergeConfigs.mockReturnValue(mockConfig)
      mockValidateSuiteGateReferences.mockReturnValue([])
    })

    it('should succeed when all attestations are valid', async () => {
      const mockResult = createMockVerifyResult({
        success: true,
        signatureValid: true,
        suites: [createMockSuiteStatus({ suite: 'unit-tests', status: 'VALID', age: 5 })],
      })

      mockVerifyAttestations.mockResolvedValue(mockResult)

      await run()

      expect(mockCore.setOutput).toHaveBeenCalledWith('valid', 'true')
      expect(mockCore.setFailed).not.toHaveBeenCalled()
      expect(mockCore.info).toHaveBeenCalledWith('✓ All attestations valid')
    })

    it('should set suite output as JSON', async () => {
      const suites = [createMockSuiteStatus({ suite: 'unit-tests', status: 'VALID', age: 5 })]
      const mockResult = createMockVerifyResult({
        success: true,
        signatureValid: true,
        suites,
      })

      mockVerifyAttestations.mockResolvedValue(mockResult)

      await run()

      expect(mockCore.setOutput).toHaveBeenCalledWith('suites', JSON.stringify(suites))
    })
  })

  describe('Suite filtering', () => {
    beforeEach(() => {
      const mockPolicy = { version: 1, team: {}, gates: {} }
      const mockOperational = {
        version: 1,
        settings: { maxAgeDays: 30 },
        suites: {
          'unit-tests': { packages: ['src'] },
          'integration-tests': { packages: ['tests'] },
        },
      }
      const mockConfig = createMockConfig({
        suites: {
          'unit-tests': { packages: ['src'] },
          'integration-tests': { packages: ['tests'] },
        },
      })

      mockReadFile.mockResolvedValue('version: 1')
      mockParsePolicyContent.mockReturnValue(mockPolicy as never)
      mockParseOperationalContent.mockReturnValue(mockOperational as never)
      mockMergeConfigs.mockReturnValue(mockConfig)
      mockValidateSuiteGateReferences.mockReturnValue([])
    })

    it('should filter to specific suite when requested', async () => {
      mockCore.getInput.mockImplementation((name: string) => {
        if (name === 'suite') return 'unit-tests'
        if (name === 'github-token') return 'test-token'
        return ''
      })

      const mockResult = createMockVerifyResult({
        success: true,
        signatureValid: true,
        suites: [createMockSuiteStatus({ suite: 'unit-tests', status: 'VALID' })],
      })

      mockVerifyAttestations.mockResolvedValue(mockResult)

      await run()

      // Verify that verifyAttestations was called
      expect(mockVerifyAttestations).toHaveBeenCalled()
      expect(mockCore.setFailed).not.toHaveBeenCalled()
    })

    it('should fail when requested suite does not exist', async () => {
      mockCore.getInput.mockImplementation((name: string) => {
        if (name === 'suite') return 'nonexistent'
        if (name === 'github-token') return 'test-token'
        return ''
      })

      await run()

      expect(mockCore.setFailed).toHaveBeenCalledWith('Suite "nonexistent" not found in config')
    })
  })

  describe('Failure cases', () => {
    beforeEach(() => {
      const mockPolicy = { version: 1, team: {}, gates: {} }
      const mockOperational = {
        version: 1,
        settings: { maxAgeDays: 30 },
        suites: { 'unit-tests': { packages: ['src'] } },
      }
      const mockConfig = createMockConfig()

      mockReadFile.mockResolvedValue('version: 1')
      mockParsePolicyContent.mockReturnValue(mockPolicy as never)
      mockParseOperationalContent.mockReturnValue(mockOperational as never)
      mockMergeConfigs.mockReturnValue(mockConfig)
      mockValidateSuiteGateReferences.mockReturnValue([])
    })

    it('should fail when signature is invalid', async () => {
      const mockResult = createMockVerifyResult({
        success: false,
        signatureValid: false,
        suites: [createMockSuiteStatus({ suite: 'unit-tests', status: 'INVALID' })],
      })

      mockVerifyAttestations.mockResolvedValue(mockResult)

      await run()

      expect(mockCore.setFailed).toHaveBeenCalledWith('Attestation signature verification failed')
    })

    it('should fail when attestation is missing and fail-on-missing is true', async () => {
      mockCore.getInput.mockImplementation((name: string) => {
        if (name === 'fail-on-missing') return 'true'
        if (name === 'github-token') return 'test-token'
        return ''
      })

      const mockResult = createMockVerifyResult({
        success: false,
        signatureValid: true,
        suites: [
          createMockSuiteStatus({
            suite: 'unit-tests',
            status: 'MISSING',
            message: 'No attestation found',
          }),
        ],
      })

      mockVerifyAttestations.mockResolvedValue(mockResult)

      await run()

      expect(mockCore.setFailed).toHaveBeenCalledWith('1 suite(s) have invalid attestations')
    })

    it('should not fail when attestation is missing and fail-on-missing is false', async () => {
      mockCore.getInput.mockImplementation((name: string) => {
        if (name === 'fail-on-missing') return 'false'
        if (name === 'github-token') return 'test-token'
        return ''
      })

      const mockResult = createMockVerifyResult({
        success: false,
        signatureValid: true,
        suites: [createMockSuiteStatus({ suite: 'unit-tests', status: 'MISSING' })],
      })

      mockVerifyAttestations.mockResolvedValue(mockResult)

      await run()

      expect(mockCore.setFailed).not.toHaveBeenCalled()
    })
  })

  describe('Strict mode', () => {
    beforeEach(() => {
      const mockPolicy = { version: 1, team: {}, gates: {} }
      const mockOperational = {
        version: 1,
        settings: { maxAgeDays: 30 },
        suites: { 'unit-tests': { packages: ['src'] } },
      }
      const mockConfig = createMockConfig({ settings: { maxAgeDays: 30 } })

      mockReadFile.mockResolvedValue('version: 1')
      mockParsePolicyContent.mockReturnValue(mockPolicy as never)
      mockParseOperationalContent.mockReturnValue(mockOperational as never)
      mockMergeConfigs.mockReturnValue(mockConfig)
      mockValidateSuiteGateReferences.mockReturnValue([])
    })

    it('should fail in strict mode when attestation is approaching expiry', async () => {
      mockCore.getInput.mockImplementation((name: string) => {
        if (name === 'strict') return 'true'
        if (name === 'github-token') return 'test-token'
        return ''
      })

      // Age of 25 with maxAgeDays of 30 is within 7-day warning threshold
      const mockResult = createMockVerifyResult({
        success: true,
        signatureValid: true,
        suites: [createMockSuiteStatus({ suite: 'unit-tests', status: 'VALID', age: 25 })],
      })

      mockVerifyAttestations.mockResolvedValue(mockResult)

      await run()

      expect(mockCore.setFailed).toHaveBeenCalledWith(
        'Attestations approaching expiry (strict mode)',
      )
    })

    it('should not fail in strict mode when attestation is fresh', async () => {
      mockCore.getInput.mockImplementation((name: string) => {
        if (name === 'strict') return 'true'
        if (name === 'github-token') return 'test-token'
        return ''
      })

      const mockResult = createMockVerifyResult({
        success: true,
        signatureValid: true,
        suites: [createMockSuiteStatus({ suite: 'unit-tests', status: 'VALID', age: 5 })],
      })

      mockVerifyAttestations.mockResolvedValue(mockResult)

      await run()

      expect(mockCore.setFailed).not.toHaveBeenCalled()
    })
  })

  describe('PR context', () => {
    beforeEach(() => {
      mockFetchPolicy.isPullRequest.mockReturnValue(true)
      mockFetchPolicy.getBaseBranch.mockReturnValue('main')
      mockFetchPolicy.getRepoInfo.mockReturnValue({ owner: 'test-org', repo: 'test-repo' })

      const mockPolicy = { version: 1, team: {}, gates: {} }
      const mockOperational = {
        version: 1,
        settings: { maxAgeDays: 30 },
        suites: { 'unit-tests': { packages: ['src'] } },
      }
      const mockConfig = createMockConfig()

      mockFetchPolicy.fetchPolicyFromRef.mockResolvedValue({
        content: 'version: 1',
        sha: 'abc123',
      })
      mockReadFile.mockResolvedValue('version: 1')
      mockParsePolicyContent.mockReturnValue(mockPolicy as never)
      mockParseOperationalContent.mockReturnValue(mockOperational as never)
      mockMergeConfigs.mockReturnValue(mockConfig)
      mockValidateSuiteGateReferences.mockReturnValue([])
    })

    it('should fetch policy from base branch in PR context', async () => {
      const mockResult = createMockVerifyResult({
        success: true,
        signatureValid: true,
        suites: [createMockSuiteStatus({ suite: 'unit-tests', status: 'VALID' })],
      })

      mockVerifyAttestations.mockResolvedValue(mockResult)

      await run()

      expect(mockFetchPolicy.fetchPolicyFromRef).toHaveBeenCalledWith({
        token: 'test-token',
        owner: 'test-org',
        repo: 'test-repo',
        ref: 'main',
        path: '.attest-it/policy.yaml',
      })
      expect(mockCore.setFailed).not.toHaveBeenCalled()
    })

    it('should fail when base branch cannot be detected in PR context', async () => {
      mockFetchPolicy.getBaseBranch.mockReturnValue(undefined)

      await run()

      expect(mockCore.setFailed).toHaveBeenCalledWith(
        'Running in PR context but base branch not detected',
      )
    })
  })

  describe('Validation errors', () => {
    beforeEach(() => {
      const mockPolicy = { version: 1, team: {}, gates: {} }
      const mockOperational = {
        version: 1,
        settings: { maxAgeDays: 30 },
        suites: { 'unit-tests': { gate: 'nonexistent' } },
      }

      mockReadFile.mockResolvedValue('version: 1')
      mockParsePolicyContent.mockReturnValue(mockPolicy as never)
      mockParseOperationalContent.mockReturnValue(mockOperational as never)
    })

    it('should fail when suite references non-existent gate', async () => {
      mockValidateSuiteGateReferences.mockReturnValue([
        {
          type: 'UNKNOWN_GATE',
          suite: 'unit-tests',
          gate: 'nonexistent',
          message: 'Suite "unit-tests" references unknown gate "nonexistent"',
        },
      ])

      await run()

      expect(mockCore.setFailed).toHaveBeenCalledWith(
        'Configuration validation failed. See errors above.',
      )
      expect(mockCore.error).toHaveBeenCalledWith(
        '- Suite "unit-tests" references unknown gate "nonexistent"',
      )
    })
  })

  describe('policy-ref input', () => {
    beforeEach(() => {
      const mockPolicy = { version: 1, team: {}, gates: {} }
      const mockOperational = {
        version: 1,
        settings: { maxAgeDays: 30 },
        suites: { 'unit-tests': { packages: ['src'] } },
      }
      const mockConfig = createMockConfig()

      mockFetchPolicy.getRepoInfo.mockReturnValue({ owner: 'test-org', repo: 'test-repo' })
      mockFetchPolicy.fetchPolicyFromRef.mockResolvedValue({
        content: 'version: 1',
        sha: 'abc123',
      })
      mockReadFile.mockResolvedValue('version: 1')
      mockParsePolicyContent.mockReturnValue(mockPolicy as never)
      mockParseOperationalContent.mockReturnValue(mockOperational as never)
      mockMergeConfigs.mockReturnValue(mockConfig)
      mockValidateSuiteGateReferences.mockReturnValue([])
    })

    it('should fetch policy from specified ref in non-PR context', async () => {
      // Non-PR context with explicit policy-ref
      mockFetchPolicy.isPullRequest.mockReturnValue(false)
      mockFetchPolicy.getBaseBranch.mockReturnValue(undefined)

      mockCore.getInput.mockImplementation((name: string) => {
        if (name === 'policy-ref') return 'production'
        if (name === 'github-token') return 'test-token'
        if (name === 'policy-path') return '.attest-it/policy.yaml'
        return ''
      })

      const mockResult = createMockVerifyResult({
        success: true,
        signatureValid: true,
        suites: [createMockSuiteStatus({ suite: 'unit-tests', status: 'VALID' })],
      })
      mockVerifyAttestations.mockResolvedValue(mockResult)

      await run()

      // Should fetch policy from the specified ref via API
      expect(mockFetchPolicy.fetchPolicyFromRef).toHaveBeenCalledWith({
        token: 'test-token',
        owner: 'test-org',
        repo: 'test-repo',
        ref: 'production',
        path: '.attest-it/policy.yaml',
      })
      expect(mockCore.setFailed).not.toHaveBeenCalled()
    })

    it('should override base branch with policy-ref in PR context', async () => {
      // PR context with explicit policy-ref - should use policy-ref, not base branch
      mockFetchPolicy.isPullRequest.mockReturnValue(true)
      mockFetchPolicy.getBaseBranch.mockReturnValue('main')

      mockCore.getInput.mockImplementation((name: string) => {
        if (name === 'policy-ref') return 'production'
        if (name === 'github-token') return 'test-token'
        if (name === 'policy-path') return '.attest-it/policy.yaml'
        return ''
      })

      const mockResult = createMockVerifyResult({
        success: true,
        signatureValid: true,
        suites: [createMockSuiteStatus({ suite: 'unit-tests', status: 'VALID' })],
      })
      mockVerifyAttestations.mockResolvedValue(mockResult)

      await run()

      // Should fetch from policy-ref, not the base branch 'main'
      expect(mockFetchPolicy.fetchPolicyFromRef).toHaveBeenCalledWith({
        token: 'test-token',
        owner: 'test-org',
        repo: 'test-repo',
        ref: 'production',
        path: '.attest-it/policy.yaml',
      })
      expect(mockCore.setFailed).not.toHaveBeenCalled()
    })

    it('should support tag refs in policy-ref', async () => {
      mockFetchPolicy.isPullRequest.mockReturnValue(false)

      mockCore.getInput.mockImplementation((name: string) => {
        if (name === 'policy-ref') return 'v1.0.0'
        if (name === 'github-token') return 'test-token'
        if (name === 'policy-path') return '.attest-it/policy.yaml'
        return ''
      })

      const mockResult = createMockVerifyResult({
        success: true,
        signatureValid: true,
        suites: [createMockSuiteStatus({ suite: 'unit-tests', status: 'VALID' })],
      })
      mockVerifyAttestations.mockResolvedValue(mockResult)

      await run()

      expect(mockFetchPolicy.fetchPolicyFromRef).toHaveBeenCalledWith(
        expect.objectContaining({ ref: 'v1.0.0' }),
      )
      expect(mockCore.setFailed).not.toHaveBeenCalled()
    })
  })
})
