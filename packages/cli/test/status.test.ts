import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { runStatus } from '../src/commands/status.js'
import type { SealVerificationResult, AttestItConfig, SealsFile, Config } from '@attest-it/core'

// Mock the core functions
vi.mock('@attest-it/core', async () => {
  const actual = await vi.importActual<typeof import('@attest-it/core')>('@attest-it/core')
  return {
    ...actual,
    loadConfig: vi.fn(),
    toAttestItConfig: vi.fn(),
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
const mockProcessExit = vi
  .spyOn(process, 'exit')
  // @ts-expect-error - Mocking process.exit which has a complex signature
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  .mockImplementation(() => {})

// Import mocked functions
const {
  loadConfig,
  toAttestItConfig,
  computeFingerprintSync,
  readSealsSync,
  verifyAllSeals,
  verifyGateSeal,
} = await import('@attest-it/core')

describe('status command', () => {
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

  describe('positive cases', () => {
    it('should show VALID status when seal matches', async () => {
      const mockConfig = createMockConfig()
      const mockAttestItConfig = createMockAttestItConfig()
      vi.mocked(loadConfig).mockResolvedValue(mockConfig)
      vi.mocked(toAttestItConfig).mockReturnValue(mockAttestItConfig)
      vi.mocked(readSealsSync).mockReturnValue(createMockSealsFile())
      vi.mocked(computeFingerprintSync).mockReturnValue({
        fingerprint: 'sha256:abc123def456',
        fileCount: 10,
        files: [],
      })
      vi.mocked(verifyAllSeals).mockReturnValue([createMockVerificationResult({ state: 'VALID' })])

      await runStatus([], {})

      expect(mockProcessExit).toHaveBeenCalledWith(0)
      expect(mockConsoleLog).toHaveBeenCalled()
    })

    it('should show status for all gates when no gates specified', async () => {
      const mockConfig = createMockConfig()
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

      vi.mocked(loadConfig).mockResolvedValue(mockConfig)
      vi.mocked(toAttestItConfig).mockReturnValue(mockAttestItConfig)
      vi.mocked(readSealsSync).mockReturnValue({ version: 1, seals: {} })
      vi.mocked(computeFingerprintSync).mockReturnValue({
        fingerprint: 'sha256:abc123def456',
        fileCount: 10,
        files: [],
      })
      vi.mocked(verifyAllSeals).mockReturnValue([
        createMockVerificationResult({ gateId: 'gate1', state: 'MISSING', seal: undefined }),
        createMockVerificationResult({ gateId: 'gate2', state: 'MISSING', seal: undefined }),
      ])

      await runStatus([], {})

      expect(computeFingerprintSync).toHaveBeenCalledTimes(2)
      expect(mockProcessExit).toHaveBeenCalledWith(1) // Invalid because MISSING
    })

    it('should output JSON with --json flag', async () => {
      const mockConfig = createMockConfig()
      const mockAttestItConfig = createMockAttestItConfig()
      vi.mocked(loadConfig).mockResolvedValue(mockConfig)
      vi.mocked(toAttestItConfig).mockReturnValue(mockAttestItConfig)
      vi.mocked(readSealsSync).mockReturnValue(createMockSealsFile())
      vi.mocked(computeFingerprintSync).mockReturnValue({
        fingerprint: 'sha256:abc123def456',
        fileCount: 10,
        files: [],
      })
      vi.mocked(verifyAllSeals).mockReturnValue([createMockVerificationResult({ state: 'VALID' })])

      await runStatus([], { json: true })

      expect(mockConsoleLog).toHaveBeenCalledWith(expect.stringContaining('"state"'))
      expect(mockConsoleLog).toHaveBeenCalledWith(expect.stringContaining('"gateId"'))
    })
  })

  describe('negative cases', () => {
    it('should show MISSING status when no seal exists', async () => {
      const mockConfig = createMockConfig()
      const mockAttestItConfig = createMockAttestItConfig()
      vi.mocked(loadConfig).mockResolvedValue(mockConfig)
      vi.mocked(toAttestItConfig).mockReturnValue(mockAttestItConfig)
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

      await runStatus([], { json: true })

      expect(mockProcessExit).toHaveBeenCalledWith(1)
      expect(mockConsoleLog).toHaveBeenCalledWith(expect.stringContaining('MISSING'))
    })

    it('should show FINGERPRINT_MISMATCH when code changed', async () => {
      const mockConfig = createMockConfig()
      const mockAttestItConfig = createMockAttestItConfig()
      vi.mocked(loadConfig).mockResolvedValue(mockConfig)
      vi.mocked(toAttestItConfig).mockReturnValue(mockAttestItConfig)
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

      await runStatus([], { json: true })

      expect(mockProcessExit).toHaveBeenCalledWith(1)
      expect(mockConsoleLog).toHaveBeenCalledWith(expect.stringContaining('FINGERPRINT_MISMATCH'))
    })

    it('should show STALE when seal exceeds maxAge', async () => {
      const mockConfig = createMockConfig()
      const mockAttestItConfig = createMockAttestItConfig()
      vi.mocked(loadConfig).mockResolvedValue(mockConfig)
      vi.mocked(toAttestItConfig).mockReturnValue(mockAttestItConfig)
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

      await runStatus([], { json: true })

      expect(mockProcessExit).toHaveBeenCalledWith(1)
      expect(mockConsoleLog).toHaveBeenCalledWith(expect.stringContaining('STALE'))
    })

    it('should return exit code 3 when config not found', async () => {
      vi.mocked(loadConfig).mockRejectedValue(new Error('Config not found'))

      await runStatus([], {})

      expect(mockProcessExit).toHaveBeenCalledWith(3) // CONFIG_ERROR
      expect(mockConsoleError).toHaveBeenCalledWith(expect.stringContaining('Config not found'))
    })

    it('should return exit code 3 when gate does not exist', async () => {
      const mockConfig = createMockConfig()
      const mockAttestItConfig = createMockAttestItConfig()
      vi.mocked(loadConfig).mockResolvedValue(mockConfig)
      vi.mocked(toAttestItConfig).mockReturnValue(mockAttestItConfig)

      await runStatus(['nonexistent-gate'], {})

      expect(mockProcessExit).toHaveBeenCalledWith(3) // CONFIG_ERROR
      expect(mockConsoleError).toHaveBeenCalledWith(expect.stringContaining('not found'))
    })
  })

  describe('edge cases', () => {
    it('should filter by specific gates when provided', async () => {
      const mockConfig = createMockConfig()
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

      vi.mocked(loadConfig).mockResolvedValue(mockConfig)
      vi.mocked(toAttestItConfig).mockReturnValue(mockAttestItConfig)
      vi.mocked(readSealsSync).mockReturnValue(createMockSealsFile())
      vi.mocked(computeFingerprintSync).mockReturnValue({
        fingerprint: 'sha256:abc123def456',
        fileCount: 10,
        files: [],
      })
      vi.mocked(verifyGateSeal).mockReturnValue(
        createMockVerificationResult({ gateId: 'gate1', state: 'VALID' }),
      )

      await runStatus(['gate1'], {})

      // Should only compute fingerprint for gate1
      expect(computeFingerprintSync).toHaveBeenCalledTimes(1)
      expect(verifyGateSeal).toHaveBeenCalledTimes(1)
      expect(mockProcessExit).toHaveBeenCalledWith(0)
    })

    it('should return exit code 3 when no gates defined', async () => {
      const mockConfig = createMockConfig()
      const mockAttestItConfig = { ...createMockAttestItConfig(), gates: {} }
      vi.mocked(loadConfig).mockResolvedValue(mockConfig)
      vi.mocked(toAttestItConfig).mockReturnValue(mockAttestItConfig)

      await runStatus([], {})

      expect(mockConsoleError).toHaveBeenCalledWith(
        expect.stringContaining('No gates defined in configuration'),
      )
      expect(mockProcessExit).toHaveBeenCalledWith(3)
    })

    it('should return exit code 3 when gates is undefined', async () => {
      const mockConfig = createMockConfig()
      const mockAttestItConfig = { ...createMockAttestItConfig(), gates: undefined }
      vi.mocked(loadConfig).mockResolvedValue(mockConfig)
      vi.mocked(toAttestItConfig).mockReturnValue(mockAttestItConfig)

      await runStatus([], {})

      expect(mockConsoleError).toHaveBeenCalledWith(
        expect.stringContaining('No gates defined in configuration'),
      )
      expect(mockProcessExit).toHaveBeenCalledWith(3)
    })

    it('should handle unknown error types', async () => {
      vi.mocked(loadConfig).mockRejectedValue('string error')

      await runStatus([], {})

      expect(mockProcessExit).toHaveBeenCalledWith(3) // CONFIG_ERROR
      expect(mockConsoleError).toHaveBeenCalledWith(expect.stringContaining('Unknown error'))
    })

    it('should show INVALID_SIGNATURE status', async () => {
      const mockConfig = createMockConfig()
      const mockAttestItConfig = createMockAttestItConfig()
      vi.mocked(loadConfig).mockResolvedValue(mockConfig)
      vi.mocked(toAttestItConfig).mockReturnValue(mockAttestItConfig)
      vi.mocked(readSealsSync).mockReturnValue(createMockSealsFile())
      vi.mocked(computeFingerprintSync).mockReturnValue({
        fingerprint: 'sha256:abc123def456',
        fileCount: 10,
        files: [],
      })
      vi.mocked(verifyAllSeals).mockReturnValue([
        createMockVerificationResult({
          state: 'INVALID_SIGNATURE',
          message: 'Signature verification failed',
        }),
      ])

      await runStatus([], { json: true })

      expect(mockProcessExit).toHaveBeenCalledWith(1)
      expect(mockConsoleLog).toHaveBeenCalledWith(expect.stringContaining('INVALID_SIGNATURE'))
    })

    it('should show UNKNOWN_SIGNER status', async () => {
      const mockConfig = createMockConfig()
      const mockAttestItConfig = createMockAttestItConfig()
      vi.mocked(loadConfig).mockResolvedValue(mockConfig)
      vi.mocked(toAttestItConfig).mockReturnValue(mockAttestItConfig)
      vi.mocked(readSealsSync).mockReturnValue(createMockSealsFile())
      vi.mocked(computeFingerprintSync).mockReturnValue({
        fingerprint: 'sha256:abc123def456',
        fileCount: 10,
        files: [],
      })
      vi.mocked(verifyAllSeals).mockReturnValue([
        createMockVerificationResult({
          state: 'UNKNOWN_SIGNER',
          message: "Signer 'bob' not found in team",
        }),
      ])

      await runStatus([], { json: true })

      expect(mockProcessExit).toHaveBeenCalledWith(1)
      expect(mockConsoleLog).toHaveBeenCalledWith(expect.stringContaining('UNKNOWN_SIGNER'))
    })

    it('should handle multiple gates with mixed statuses', async () => {
      const mockConfig = createMockConfig()
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
      vi.mocked(loadConfig).mockResolvedValue(mockConfig)
      vi.mocked(toAttestItConfig).mockReturnValue(mockAttestItConfig)
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

      await runStatus([], {})

      expect(mockProcessExit).toHaveBeenCalledWith(1)
    })
  })
})
