import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  createMockConfig,
  createMockSealResult,
  createMockSealsFile,
  createMockSeal,
  MOCK_NOW,
} from './test-helpers.js'

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

// Mock @attest-it/core.
// Only the surface actually imported by src/index.ts is mocked here: split
// config loading, the seal verification API, and the split-config error types.
vi.mock('@attest-it/core', () => ({
  loadSplitConfig: vi.fn(),
  readSeals: vi.fn(),
  verifyAllSeals: vi.fn(),
  computeFingerprint: vi.fn(),
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
  SplitConfigNotFoundError: class SplitConfigNotFoundError extends Error {
    configType: string
    constructor(message: string, configType: 'policy' | 'operational') {
      super(message)
      this.name = 'SplitConfigNotFoundError'
      this.configType = configType
    }
  },
  CrossConfigValidationError: class CrossConfigValidationError extends Error {
    errors: { type: string; message: string }[]
    constructor(message: string, errors: { type: string; message: string }[]) {
      super(message)
      this.name = 'CrossConfigValidationError'
      this.errors = errors
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

// Import after mocks are set up
const { run } = await import('../src/index.js')
const mockCoreModule = await import('@actions/core')
const mockAttestItCoreModule = await import('@attest-it/core')
const mockFetchPolicyModule = await import('../src/fetch-policy.js')

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

const mockLoadSplitConfig = vi.mocked(mockAttestItCoreModule.loadSplitConfig)
// Seal-based verification mocks
const mockReadSeals = vi.mocked(mockAttestItCoreModule.readSeals)
const mockVerifyAllSeals = vi.mocked(mockAttestItCoreModule.verifyAllSeals)
const mockComputeFingerprint = vi.mocked(mockAttestItCoreModule.computeFingerprint)

const mockFetchPolicy = {
  fetchPolicyFromRef: vi.mocked(mockFetchPolicyModule.fetchPolicyFromRef),
  getRepoInfo: vi.mocked(mockFetchPolicyModule.getRepoInfo),
  getBaseBranch: vi.mocked(mockFetchPolicyModule.getBaseBranch),
  isPullRequest: vi.mocked(mockFetchPolicyModule.isPullRequest),
}

describe('GitHub Action', () => {
  let originalEnv: typeof process.env
  let originalCwd: string

  beforeEach(() => {
    // Reset all mocks
    vi.clearAllMocks()

    // Fix "now" so seal age calculations (index.ts uses Date.now() directly)
    // are deterministic across runs instead of depending on wall-clock time.
    vi.useFakeTimers()
    vi.setSystemTime(MOCK_NOW)

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

    // Default seal-based mocks
    mockReadSeals.mockResolvedValue(createMockSealsFile())
    mockComputeFingerprint.mockResolvedValue({
      fingerprint: 'sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      files: [],
      fileCount: 0,
    })
    mockVerifyAllSeals.mockReturnValue([])
  })

  afterEach(() => {
    vi.useRealTimers()
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
      const mockConfig = createMockConfig()

      mockLoadSplitConfig.mockResolvedValue(mockConfig)
    })

    it('should succeed when all attestations are valid', async () => {
      mockVerifyAllSeals.mockReturnValue([
        createMockSealResult({ gateId: 'test-gate', state: 'VALID' }),
      ])

      await run()

      expect(mockCore.setOutput).toHaveBeenCalledWith('valid', 'true')
      expect(mockCore.setFailed).not.toHaveBeenCalled()
      expect(mockCore.info).toHaveBeenCalledWith('✓ All attestations valid')
    })

    it('should set suite output as JSON', async () => {
      mockVerifyAllSeals.mockReturnValue([
        createMockSealResult({ gateId: 'test-gate', state: 'VALID' }),
      ])

      await run()

      // The output is now mapped suite results, not raw seal results
      expect(mockCore.setOutput).toHaveBeenCalledWith(
        'suites',
        expect.stringContaining('test-suite'),
      )
    })
  })

  // Regression coverage for #156: mapSealResultsToSuites/logResults previously
  // only looked at a result's primary state/message, so concurrent conditions
  // (e.g. a seal that is both fingerprint-mismatched and stale) were invisible
  // to both the `suites` action output and the log group.
  describe('concurrent conditions (#156)', () => {
    beforeEach(() => {
      const mockConfig = createMockConfig()
      mockLoadSplitConfig.mockResolvedValue(mockConfig)
    })

    it('carries every condition through to the `suites` output when a result has more than one', async () => {
      mockVerifyAllSeals.mockReturnValue([
        createMockSealResult({
          gateId: 'test-gate',
          state: 'FINGERPRINT_MISMATCH',
          message: 'Fingerprint changed since seal was created',
          conditions: [
            {
              state: 'FINGERPRINT_MISMATCH',
              message: 'Fingerprint changed since seal was created',
            },
            { state: 'STALE', message: 'Seal is 100 days old, exceeds maxAge of 30 days' },
          ],
        }),
      ])

      await run()

      const suitesCall = mockCore.setOutput.mock.calls.find(([key]) => key === 'suites')
      expect(suitesCall).toBeDefined()
      const suites = JSON.parse(suitesCall?.[1] as string) as {
        suite: string
        status: string
        conditions?: { status: string; message?: string }[]
      }[]
      const testSuite = suites.find((s) => s.suite === 'test-suite')
      expect(testSuite?.status).toBe('FINGERPRINT_CHANGED')
      expect(testSuite?.conditions).toBeDefined()
      const statuses = testSuite?.conditions?.map((c) => c.status) ?? []
      expect(statuses).toContain('FINGERPRINT_CHANGED')
      expect(statuses).toContain('EXPIRED')
    })

    it('omits `conditions` in the `suites` output when a result has only one condition', async () => {
      mockVerifyAllSeals.mockReturnValue([
        createMockSealResult({ gateId: 'test-gate', state: 'VALID' }),
      ])

      await run()

      const suitesCall = mockCore.setOutput.mock.calls.find(([key]) => key === 'suites')
      const suites = JSON.parse(suitesCall?.[1] as string) as {
        suite: string
        conditions?: unknown[]
      }[]
      const testSuite = suites.find((s) => s.suite === 'test-suite')
      expect(testSuite?.conditions).toBeUndefined()
    })

    it('logs every condition as its own indented line via logResults', async () => {
      mockVerifyAllSeals.mockReturnValue([
        createMockSealResult({
          gateId: 'test-gate',
          state: 'FINGERPRINT_MISMATCH',
          message: 'Fingerprint changed since seal was created',
          conditions: [
            {
              state: 'FINGERPRINT_MISMATCH',
              message: 'Fingerprint changed since seal was created',
            },
            { state: 'STALE', message: 'Seal is 100 days old, exceeds maxAge of 30 days' },
          ],
        }),
      ])

      await run()

      // The primary one-line summary is still logged...
      expect(mockCore.info).toHaveBeenCalledWith('✗ test-gate: FINGERPRINT_CHANGED')
      // ...and each condition gets its own indented line underneath.
      expect(mockCore.info).toHaveBeenCalledWith(
        expect.stringContaining('FINGERPRINT_CHANGED: Fingerprint changed since seal was created'),
      )
      expect(mockCore.info).toHaveBeenCalledWith(
        expect.stringContaining('EXPIRED: Seal is 100 days old, exceeds maxAge of 30 days'),
      )
    })
  })

  describe('Suite filtering', () => {
    beforeEach(() => {
      const mockConfig = createMockConfig({
        gates: {
          'unit-gate': {
            name: 'Unit Tests Gate',
            description: 'Unit tests gate',
            authorizedSigners: ['test-user'],
            fingerprint: { paths: ['src'] },
            maxAge: '30d',
          },
          'integration-gate': {
            name: 'Integration Tests Gate',
            description: 'Integration tests gate',
            authorizedSigners: ['test-user'],
            fingerprint: { paths: ['tests'] },
            maxAge: '30d',
          },
        },
        suites: {
          'unit-tests': { gate: 'unit-gate' },
          'integration-tests': { gate: 'integration-gate' },
        },
      })

      mockLoadSplitConfig.mockResolvedValue(mockConfig)
    })

    it('should filter to specific suite when requested', async () => {
      mockCore.getInput.mockImplementation((name: string) => {
        if (name === 'suite') return 'unit-tests'
        if (name === 'github-token') return 'test-token'
        return ''
      })

      mockVerifyAllSeals.mockReturnValue([
        createMockSealResult({ gateId: 'unit-gate', state: 'VALID' }),
      ])

      await run()

      // Verify that verifyAllSeals was called
      expect(mockVerifyAllSeals).toHaveBeenCalled()
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
      const mockConfig = createMockConfig()

      mockLoadSplitConfig.mockResolvedValue(mockConfig)
    })

    it('should fail when signature is invalid', async () => {
      mockVerifyAllSeals.mockReturnValue([
        createMockSealResult({ gateId: 'test-gate', state: 'INVALID_SIGNATURE' }),
      ])

      await run()

      expect(mockCore.setFailed).toHaveBeenCalledWith('Attestation signature verification failed')
    })

    it('should fail when attestation is missing and fail-on-missing is true', async () => {
      mockCore.getInput.mockImplementation((name: string) => {
        if (name === 'fail-on-missing') return 'true'
        if (name === 'github-token') return 'test-token'
        return ''
      })

      mockVerifyAllSeals.mockReturnValue([
        createMockSealResult({
          gateId: 'test-gate',
          state: 'MISSING',
          message: 'No seal found',
        }),
      ])

      await run()

      expect(mockCore.setFailed).toHaveBeenCalledWith('1 suite(s) have invalid attestations')
    })

    it('should not fail when attestation is missing and fail-on-missing is false', async () => {
      mockCore.getInput.mockImplementation((name: string) => {
        if (name === 'fail-on-missing') return 'false'
        if (name === 'github-token') return 'test-token'
        return ''
      })

      mockVerifyAllSeals.mockReturnValue([
        createMockSealResult({ gateId: 'test-gate', state: 'MISSING', seal: undefined }),
      ])

      await run()

      expect(mockCore.setFailed).not.toHaveBeenCalled()
    })
  })

  describe('Strict mode', () => {
    beforeEach(() => {
      // Default createMockConfig() settings already use maxAgeDays: 30.
      const mockConfig = createMockConfig()

      mockLoadSplitConfig.mockResolvedValue(mockConfig)
    })

    it('should fail in strict mode when attestation is approaching expiry', async () => {
      mockCore.getInput.mockImplementation((name: string) => {
        if (name === 'strict') return 'true'
        if (name === 'github-token') return 'test-token'
        return ''
      })

      // Age of 25 days with maxAgeDays of 30 is within the 7-day warning threshold
      const oldSeal = createMockSeal({
        timestamp: new Date(MOCK_NOW.getTime() - 25 * 24 * 60 * 60 * 1000).toISOString(),
      })

      mockVerifyAllSeals.mockReturnValue([
        createMockSealResult({ gateId: 'test-gate', state: 'VALID', seal: oldSeal }),
      ])

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

      // Fresh seal (5 days old)
      const freshSeal = createMockSeal({
        timestamp: new Date(MOCK_NOW.getTime() - 5 * 24 * 60 * 60 * 1000).toISOString(),
      })

      mockVerifyAllSeals.mockReturnValue([
        createMockSealResult({ gateId: 'test-gate', state: 'VALID', seal: freshSeal }),
      ])

      await run()

      expect(mockCore.setFailed).not.toHaveBeenCalled()
    })
  })

  describe('PR context', () => {
    beforeEach(() => {
      mockFetchPolicy.isPullRequest.mockReturnValue(true)
      mockFetchPolicy.getBaseBranch.mockReturnValue('main')
      mockFetchPolicy.getRepoInfo.mockReturnValue({ owner: 'test-org', repo: 'test-repo' })

      const mockConfig = createMockConfig()

      mockFetchPolicy.fetchPolicyFromRef.mockResolvedValue({
        content: 'version: 1',
        sha: 'abc123',
      })
      mockLoadSplitConfig.mockResolvedValue(mockConfig)
    })

    it('should fetch policy from base branch in PR context', async () => {
      mockVerifyAllSeals.mockReturnValue([
        createMockSealResult({ gateId: 'test-gate', state: 'VALID' }),
      ])

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
    it('should fail when suite references non-existent gate', async () => {
      // Import the mock class from the mock module
      const { CrossConfigValidationError } = await import('@attest-it/core')
      const validationError = new CrossConfigValidationError('Configuration validation failed', [
        {
          type: 'UNKNOWN_GATE',
          message: 'Suite "unit-tests" references unknown gate "nonexistent"',
        },
      ])
      mockLoadSplitConfig.mockRejectedValue(validationError)

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
      const mockConfig = createMockConfig()

      mockFetchPolicy.getRepoInfo.mockReturnValue({ owner: 'test-org', repo: 'test-repo' })
      mockFetchPolicy.fetchPolicyFromRef.mockResolvedValue({
        content: 'version: 1',
        sha: 'abc123',
      })
      mockLoadSplitConfig.mockResolvedValue(mockConfig)
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

      mockVerifyAllSeals.mockReturnValue([
        createMockSealResult({ gateId: 'test-gate', state: 'VALID' }),
      ])

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

      mockVerifyAllSeals.mockReturnValue([
        createMockSealResult({ gateId: 'test-gate', state: 'VALID' }),
      ])

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

      mockVerifyAllSeals.mockReturnValue([
        createMockSealResult({ gateId: 'test-gate', state: 'VALID' }),
      ])

      await run()

      expect(mockFetchPolicy.fetchPolicyFromRef).toHaveBeenCalledWith(
        expect.objectContaining({ ref: 'v1.0.0' }),
      )
      expect(mockCore.setFailed).not.toHaveBeenCalled()
    })
  })
})
