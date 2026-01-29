import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { runVerify, displayResults } from '../src/commands/verify.js'
import type { SealVerificationResult, AttestItConfig, SealsFile, Config } from '@attest-it/core'

// Mock the core functions
vi.mock('@attest-it/core', async () => {
  const actual = await vi.importActual<typeof import('@attest-it/core')>('@attest-it/core')
  return {
    ...actual,
    loadConfig: vi.fn(),
    toAttestItConfig: vi.fn(),
    loadSplitConfig: vi.fn(),
    computeFingerprintSync: vi.fn(),
    readSealsSync: vi.fn(),
    verifyAllSeals: vi.fn(),
    verifyGateSeal: vi.fn(),
  }
})

// Mock console methods
const mockConsoleLog = vi.spyOn(console, 'log').mockImplementation(() => {
  // Intentionally empty
})
const mockConsoleError = vi.spyOn(console, 'error').mockImplementation(() => {
  // Intentionally empty
})
const mockConsoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {
  // Intentionally empty
})
const mockProcessExit = vi
  .spyOn(process, 'exit')
  // @ts-expect-error - Mocking process.exit which has a complex signature
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  .mockImplementation(() => {})

// Import mocked functions
const {
  loadConfig,
  toAttestItConfig,
  loadSplitConfig,
  computeFingerprintSync,
  readSealsSync,
  verifyAllSeals,
  verifyGateSeal,
} = await import('@attest-it/core')

describe('verify command', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  // Helper to create a mock Config (CLI layer)
  function createMockConfig(): Config {
    return {
      version: 1,
      settings: {
        attestationsPath: '.attest-it/attestations.json',
        maxAgeDays: 30,
        publicKeyPath: '.attest-it/pubkey.pem',
      },
      suites: {
        'test-suite': {
          packages: ['src/**/*.ts'],
          gate: 'test-gate',
        },
      },
    }
  }

  // Helper to create a mock AttestItConfig (core layer)
  function createMockAttestItConfig(): AttestItConfig {
    return {
      version: 1,
      settings: {
        maxAgeDays: 30,
        publicKeyPath: '.attest-it/pubkey.pem',
        attestationsPath: '.attest-it/attestations.json',
      },
      team: {
        alice: {
          name: 'Alice Developer',
          publicKey: 'test-public-key-base64',
        },
      },
      gates: {
        'test-gate': {
          name: 'Test Gate',
          description: 'Test gate description',
          authorizedSigners: ['alice'],
          fingerprint: {
            paths: ['src/**/*.ts'],
          },
          maxAge: '30d',
        },
      },
    }
  }

  // Helper to create mock seals file
  function createMockSealsFile(): SealsFile {
    return {
      version: 1,
      seals: {
        'test-gate': {
          gateId: 'test-gate',
          fingerprint: 'sha256:abc123def456',
          timestamp: new Date().toISOString(),
          sealedBy: 'alice',
          signature: 'test-signature-base64',
        },
      },
    }
  }

  // Helper to create a mock verification result
  function createMockVerificationResult(
    overrides?: Partial<SealVerificationResult>,
  ): SealVerificationResult {
    return {
      gateId: 'test-gate',
      state: 'VALID',
      seal: {
        gateId: 'test-gate',
        fingerprint: 'sha256:abc123def456',
        timestamp: new Date().toISOString(),
        sealedBy: 'alice',
        signature: 'test-signature-base64',
      },
      ...overrides,
    }
  }

  describe('runVerify', () => {
    it('should exit with code 0 when all seals are valid', async () => {
      const mockAttestItConfig = createMockAttestItConfig()
      vi.mocked(loadSplitConfig).mockResolvedValue(mockAttestItConfig)
      vi.mocked(readSealsSync).mockReturnValue(createMockSealsFile())
      vi.mocked(computeFingerprintSync).mockReturnValue({
        fingerprint: 'sha256:abc123def456',
        fileCount: 10,
        files: [],
      })
      vi.mocked(verifyAllSeals).mockReturnValue([createMockVerificationResult({ state: 'VALID' })])

      await runVerify([], {})

      expect(mockProcessExit).toHaveBeenCalledWith(0)
    })

    it('should exit with code 1 when seals are invalid (MISSING)', async () => {
      const mockAttestItConfig = createMockAttestItConfig()
      vi.mocked(loadSplitConfig).mockResolvedValue(mockAttestItConfig)
      vi.mocked(readSealsSync).mockReturnValue({ version: 1, seals: {} })
      vi.mocked(computeFingerprintSync).mockReturnValue({
        fingerprint: 'sha256:abc123def456',
        fileCount: 10,
        files: [],
      })
      vi.mocked(verifyAllSeals).mockReturnValue([
        createMockVerificationResult({
          state: 'MISSING',
          seal: undefined,
          message: 'No seal found for gate',
        }),
      ])

      await runVerify([], {})

      expect(mockProcessExit).toHaveBeenCalledWith(1)
    })

    it('should exit with code 1 when seals have FINGERPRINT_MISMATCH', async () => {
      const mockAttestItConfig = createMockAttestItConfig()
      vi.mocked(loadSplitConfig).mockResolvedValue(mockAttestItConfig)
      vi.mocked(readSealsSync).mockReturnValue(createMockSealsFile())
      vi.mocked(computeFingerprintSync).mockReturnValue({
        fingerprint: 'sha256:different-fingerprint',
        fileCount: 10,
        files: [],
      })
      vi.mocked(verifyAllSeals).mockReturnValue([
        createMockVerificationResult({
          state: 'FINGERPRINT_MISMATCH',
          message: 'Fingerprint changed since seal was created',
        }),
      ])

      await runVerify([], {})

      expect(mockProcessExit).toHaveBeenCalledWith(1)
    })

    it('should exit with code 0 when seals are STALE (warning only)', async () => {
      const mockAttestItConfig = createMockAttestItConfig()
      vi.mocked(loadSplitConfig).mockResolvedValue(mockAttestItConfig)
      vi.mocked(readSealsSync).mockReturnValue(createMockSealsFile())
      vi.mocked(computeFingerprintSync).mockReturnValue({
        fingerprint: 'sha256:abc123def456',
        fileCount: 10,
        files: [],
      })
      vi.mocked(verifyAllSeals).mockReturnValue([
        createMockVerificationResult({
          state: 'STALE',
          message: 'Seal is 45 days old, exceeds maxAge of 30 days',
        }),
      ])

      await runVerify([], {})

      // STALE is a warning, not a failure
      expect(mockProcessExit).toHaveBeenCalledWith(0)
    })

    it('should exit with code 3 on config error', async () => {
      vi.mocked(loadSplitConfig).mockRejectedValue(new Error('Config not found'))

      await runVerify([], {})

      expect(mockConsoleError).toHaveBeenCalledWith(expect.stringContaining('Config not found'))
      expect(mockProcessExit).toHaveBeenCalledWith(3) // CONFIG_ERROR
    })

    it('should exit with code 3 when no gates are defined', async () => {
      const mockAttestItConfig = { ...createMockAttestItConfig(), gates: undefined }
      vi.mocked(loadSplitConfig).mockResolvedValue(mockAttestItConfig)

      await runVerify([], {})

      expect(mockConsoleError).toHaveBeenCalledWith(
        expect.stringContaining('No gates defined in configuration'),
      )
      expect(mockProcessExit).toHaveBeenCalledWith(3) // CONFIG_ERROR
    })

    it('should verify specific gates when provided', async () => {
      const mockAttestItConfig = createMockAttestItConfig()
      vi.mocked(loadSplitConfig).mockResolvedValue(mockAttestItConfig)
      vi.mocked(readSealsSync).mockReturnValue(createMockSealsFile())
      vi.mocked(computeFingerprintSync).mockReturnValue({
        fingerprint: 'sha256:abc123def456',
        fileCount: 10,
        files: [],
      })
      vi.mocked(verifyGateSeal).mockReturnValue(createMockVerificationResult({ state: 'VALID' }))

      await runVerify(['test-gate'], {})

      expect(verifyGateSeal).toHaveBeenCalledTimes(1)
      expect(mockProcessExit).toHaveBeenCalledWith(0)
    })

    it('should exit with code 3 when specified gate does not exist', async () => {
      const mockAttestItConfig = createMockAttestItConfig()
      vi.mocked(loadSplitConfig).mockResolvedValue(mockAttestItConfig)

      await runVerify(['nonexistent-gate'], {})

      expect(mockConsoleError).toHaveBeenCalledWith(expect.stringContaining('not found'))
      expect(mockProcessExit).toHaveBeenCalledWith(3) // CONFIG_ERROR
    })

    it('should output JSON with --json option', async () => {
      const mockAttestItConfig = createMockAttestItConfig()
      const mockResults = [createMockVerificationResult({ state: 'VALID' })]
      vi.mocked(loadSplitConfig).mockResolvedValue(mockAttestItConfig)
      vi.mocked(readSealsSync).mockReturnValue(createMockSealsFile())
      vi.mocked(computeFingerprintSync).mockReturnValue({
        fingerprint: 'sha256:abc123def456',
        fileCount: 10,
        files: [],
      })
      vi.mocked(verifyAllSeals).mockReturnValue(mockResults)

      await runVerify([], { json: true })

      // Should output JSON
      expect(mockConsoleLog).toHaveBeenCalledWith(JSON.stringify(mockResults, null, 2))
      expect(mockProcessExit).toHaveBeenCalledWith(0)
    })
  })

  describe('displayResults', () => {
    it('should display valid status for all gates', () => {
      const results: SealVerificationResult[] = [createMockVerificationResult({ state: 'VALID' })]

      displayResults(results)

      // Should show success message
      expect(mockConsoleLog).toHaveBeenCalledWith(expect.stringContaining('All gate seals valid'))
    })

    it('should display MISSING status with remediation', () => {
      const results: SealVerificationResult[] = [
        createMockVerificationResult({
          state: 'MISSING',
          seal: undefined,
          message: 'No seal found for gate',
        }),
      ]

      displayResults(results)

      // Should show error count
      expect(mockConsoleError).toHaveBeenCalledWith(
        expect.stringContaining('gate(s) have invalid or missing seals'),
      )
    })

    it('should display STALE status with warning', () => {
      const results: SealVerificationResult[] = [
        createMockVerificationResult({
          state: 'STALE',
          message: 'Seal is 45 days old, exceeds maxAge of 30 days',
        }),
      ]

      displayResults(results)

      // Should show warning
      expect(mockConsoleWarn).toHaveBeenCalledWith(
        expect.stringContaining('gate(s) have stale seals'),
      )
    })

    it('should display INVALID_SIGNATURE status', () => {
      const results: SealVerificationResult[] = [
        createMockVerificationResult({
          state: 'INVALID_SIGNATURE',
          message: 'Signature verification failed',
        }),
      ]

      displayResults(results)

      // Should show error count
      expect(mockConsoleError).toHaveBeenCalledWith(
        expect.stringContaining('gate(s) have invalid or missing seals'),
      )
    })

    it('should display UNKNOWN_SIGNER status', () => {
      const results: SealVerificationResult[] = [
        createMockVerificationResult({
          state: 'UNKNOWN_SIGNER',
          message: "Signer 'bob' not found in team",
        }),
      ]

      displayResults(results)

      // Should show error count
      expect(mockConsoleError).toHaveBeenCalledWith(
        expect.stringContaining('gate(s) have invalid or missing seals'),
      )
    })
  })

  describe('edge cases', () => {
    it('should handle multiple gates with mixed statuses', async () => {
      const mockAttestItConfig = {
        ...createMockAttestItConfig(),
        gates: {
          gate1: {
            name: 'Gate 1',
            description: 'Gate 1',
            authorizedSigners: ['alice'],
            fingerprint: { paths: ['src/**/*.ts'] },
            maxAge: '30d',
          },
          gate2: {
            name: 'Gate 2',
            description: 'Gate 2',
            authorizedSigners: ['alice'],
            fingerprint: { paths: ['lib/**/*.ts'] },
            maxAge: '30d',
          },
        },
      }
      vi.mocked(loadSplitConfig).mockResolvedValue(mockAttestItConfig)
      vi.mocked(readSealsSync).mockReturnValue(createMockSealsFile())
      vi.mocked(computeFingerprintSync).mockReturnValue({
        fingerprint: 'sha256:abc123def456',
        fileCount: 10,
        files: [],
      })
      vi.mocked(verifyAllSeals).mockReturnValue([
        createMockVerificationResult({ gateId: 'gate1', state: 'VALID' }),
        createMockVerificationResult({
          gateId: 'gate2',
          state: 'MISSING',
          seal: undefined,
          message: 'No seal found',
        }),
      ])

      await runVerify([], {})

      expect(mockProcessExit).toHaveBeenCalledWith(1)
    })

    it('should handle unknown error type', async () => {
      vi.mocked(loadSplitConfig).mockRejectedValue('string error')

      await runVerify([], {})

      expect(mockConsoleError).toHaveBeenCalledWith(expect.stringContaining('Unknown error'))
      expect(mockProcessExit).toHaveBeenCalledWith(3) // CONFIG_ERROR
    })

    it('should handle empty gates', async () => {
      const mockAttestItConfig = { ...createMockAttestItConfig(), gates: {} }
      vi.mocked(loadSplitConfig).mockResolvedValue(mockAttestItConfig)

      await runVerify([], {})

      expect(mockConsoleError).toHaveBeenCalledWith(
        expect.stringContaining('No gates defined in configuration'),
      )
      expect(mockProcessExit).toHaveBeenCalledWith(3)
    })
  })
})
