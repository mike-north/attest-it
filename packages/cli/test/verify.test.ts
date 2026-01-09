import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { runVerify, displayResults, hasWarnings } from '../src/commands/verify.js'
import type { VerifyResult, AttestItConfig } from '@attest-it/core'

// Mock the core functions
vi.mock('@attest-it/core', async () => {
  const actual = await vi.importActual<typeof import('@attest-it/core')>('@attest-it/core')
  return {
    ...actual,
    loadConfig: vi.fn(),
    verifyAttestations: vi.fn(),
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
const { loadConfig, verifyAttestations } = await import('@attest-it/core')

describe('verify command', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  // Helper to create a mock config
  function createMockConfig(): AttestItConfig {
    return {
      version: 1,
      settings: {
        attestationsPath: '.attestations.json',
        maxAgeDays: 30,
        publicKeyPath: 'test.pub',
        algorithm: 'ed25519',
      },
      suites: {
        'test-suite': {
          packages: ['pkg1'],
        },
        'another-suite': {
          packages: ['pkg2'],
        },
      },
    }
  }

  // Helper to create a mock verify result
  function createMockVerifyResult(overrides?: Partial<VerifyResult>): VerifyResult {
    return {
      success: true,
      signatureValid: true,
      suites: [
        {
          suite: 'test-suite',
          status: 'VALID',
          fingerprint: 'sha256:abc123def456',
          age: 5,
        },
      ],
      errors: [],
      ...overrides,
    }
  }

  describe('runVerify', () => {
    it('should exit with code 0 when all attestations are valid', async () => {
      const mockConfig = createMockConfig()
      vi.mocked(loadConfig).mockResolvedValue(mockConfig)
      vi.mocked(verifyAttestations).mockResolvedValue(
        createMockVerifyResult({
          success: true,
          signatureValid: true,
        }),
      )

      await runVerify({})

      expect(mockProcessExit).toHaveBeenCalledWith(0)
    })

    it('should exit with code 1 when attestations are invalid', async () => {
      const mockConfig = createMockConfig()
      vi.mocked(loadConfig).mockResolvedValue(mockConfig)
      vi.mocked(verifyAttestations).mockResolvedValue(
        createMockVerifyResult({
          success: false,
          suites: [
            {
              suite: 'test-suite',
              status: 'NEEDS_ATTESTATION',
              fingerprint: 'sha256:abc123',
            },
          ],
        }),
      )

      await runVerify({})

      expect(mockProcessExit).toHaveBeenCalledWith(1)
    })

    it('should exit with code 2 on config error', async () => {
      vi.mocked(loadConfig).mockRejectedValue(new Error('Config not found'))

      await runVerify({})

      expect(mockConsoleError).toHaveBeenCalledWith(expect.stringContaining('Config not found'))
      expect(mockProcessExit).toHaveBeenCalledWith(2)
    })

    it('should filter to specific suite with --suite option', async () => {
      const mockConfig = createMockConfig()
      vi.mocked(loadConfig).mockResolvedValue(mockConfig)
      vi.mocked(verifyAttestations).mockResolvedValue(
        createMockVerifyResult({
          suites: [
            {
              suite: 'test-suite',
              status: 'VALID',
              fingerprint: 'sha256:abc123',
              age: 5,
            },
          ],
        }),
      )

      await runVerify({ suite: 'test-suite' })

      // Verify that verifyAttestations was called with filtered config
      expect(verifyAttestations).toHaveBeenCalledTimes(1)
      const calls = vi.mocked(verifyAttestations).mock.calls
      const firstCall = calls[0]
      expect(firstCall).toBeDefined()
      if (!firstCall) {
        throw new Error('Expected verifyAttestations to be called')
      }
      const callArg = firstCall[0]
      expect(callArg.config.suites).toEqual({
        'test-suite': mockConfig.suites['test-suite'],
      })
      expect(mockProcessExit).toHaveBeenCalledWith(0)
    })

    it('should exit with code 2 when specified suite does not exist', async () => {
      const mockConfig = createMockConfig()
      vi.mocked(loadConfig).mockResolvedValue(mockConfig)

      await runVerify({ suite: 'nonexistent-suite' })

      expect(mockConsoleError).toHaveBeenCalledWith(expect.stringContaining('not found'))
      expect(mockProcessExit).toHaveBeenCalledWith(2)
    })

    it('should output JSON with --json option', async () => {
      const mockConfig = createMockConfig()
      const mockResult = createMockVerifyResult()
      vi.mocked(loadConfig).mockResolvedValue(mockConfig)
      vi.mocked(verifyAttestations).mockResolvedValue(mockResult)

      await runVerify({ json: true })

      // Should output JSON and not call displayResults
      expect(mockConsoleLog).toHaveBeenCalledWith(JSON.stringify(mockResult, null, 2))
      expect(mockProcessExit).toHaveBeenCalledWith(0)
    })

    it('should exit with code 1 in strict mode with warnings', async () => {
      const mockConfig = createMockConfig()
      vi.mocked(loadConfig).mockResolvedValue(mockConfig)
      vi.mocked(verifyAttestations).mockResolvedValue(
        createMockVerifyResult({
          success: true,
          suites: [
            {
              suite: 'test-suite',
              status: 'VALID',
              fingerprint: 'sha256:abc123',
              age: 28, // Close to 30 day expiry
            },
          ],
        }),
      )

      await runVerify({ strict: true })

      expect(mockProcessExit).toHaveBeenCalledWith(1)
    })

    it('should exit with code 0 in non-strict mode with warnings', async () => {
      const mockConfig = createMockConfig()
      vi.mocked(loadConfig).mockResolvedValue(mockConfig)
      vi.mocked(verifyAttestations).mockResolvedValue(
        createMockVerifyResult({
          success: true,
          suites: [
            {
              suite: 'test-suite',
              status: 'VALID',
              fingerprint: 'sha256:abc123',
              age: 28, // Close to 30 day expiry
            },
          ],
        }),
      )

      await runVerify({ strict: false })

      expect(mockProcessExit).toHaveBeenCalledWith(0)
    })
  })

  describe('displayResults', () => {
    it('should display valid status for all suites', () => {
      const result = createMockVerifyResult({
        success: true,
        suites: [
          {
            suite: 'test-suite',
            status: 'VALID',
            fingerprint: 'sha256:abc123def456',
            age: 5,
          },
        ],
      })

      displayResults(result, 30)

      // Should show success message
      expect(mockConsoleLog).toHaveBeenCalledWith(expect.stringContaining('All attestations valid'))
    })

    it('should display NEEDS_ATTESTATION status', () => {
      const result = createMockVerifyResult({
        success: false,
        suites: [
          {
            suite: 'test-suite',
            status: 'NEEDS_ATTESTATION',
            fingerprint: 'sha256:abc123',
            message: 'No attestation found for this suite',
          },
        ],
      })

      displayResults(result, 30)

      // Should show remediation steps
      expect(mockConsoleLog).toHaveBeenCalledWith(expect.stringContaining('Remediation:'))
      expect(mockConsoleLog).toHaveBeenCalledWith(
        expect.stringContaining('attest-it run --suite test-suite'),
      )
    })

    it('should display FINGERPRINT_CHANGED status', () => {
      const result = createMockVerifyResult({
        success: false,
        suites: [
          {
            suite: 'test-suite',
            status: 'FINGERPRINT_CHANGED',
            fingerprint: 'sha256:new123',
            message: 'Fingerprint changed',
          },
        ],
      })

      displayResults(result, 30)

      expect(mockConsoleLog).toHaveBeenCalledWith(
        expect.stringContaining('attest-it run --suite test-suite'),
      )
    })

    it('should display EXPIRED status', () => {
      const result = createMockVerifyResult({
        success: false,
        suites: [
          {
            suite: 'test-suite',
            status: 'EXPIRED',
            fingerprint: 'sha256:abc123',
            age: 45,
            message: 'Attestation expired',
          },
        ],
      })

      displayResults(result, 30)

      expect(mockConsoleLog).toHaveBeenCalledWith(
        expect.stringContaining('attest-it run --suite test-suite'),
      )
    })

    it('should display INVALIDATED_BY_PARENT status', () => {
      const result = createMockVerifyResult({
        success: false,
        suites: [
          {
            suite: 'child-suite',
            status: 'INVALIDATED_BY_PARENT',
            fingerprint: 'sha256:abc123',
            message: 'Invalidated by parent',
          },
        ],
      })

      displayResults(result, 30)

      expect(mockConsoleLog).toHaveBeenCalledWith(
        expect.stringContaining('attest-it run --suite child-suite'),
      )
    })

    it('should display signature verification failure', () => {
      const result = createMockVerifyResult({
        success: false,
        signatureValid: false,
        errors: ['Signature verification failed'],
      })

      displayResults(result, 30)

      expect(mockConsoleError).toHaveBeenCalledWith(
        expect.stringContaining('Signature verification FAILED'),
      )
      expect(mockConsoleLog).toHaveBeenCalledWith(expect.stringContaining('tampered'))
    })

    it('should display errors', () => {
      const result = createMockVerifyResult({
        success: false,
        errors: ['Public key not found', 'Another error'],
      })

      displayResults(result, 30)

      expect(mockConsoleError).toHaveBeenCalledWith(expect.stringContaining('Public key not found'))
      expect(mockConsoleError).toHaveBeenCalledWith(expect.stringContaining('Another error'))
    })

    it('should display warnings for approaching expiry', () => {
      const result = createMockVerifyResult({
        success: true,
        suites: [
          {
            suite: 'test-suite',
            status: 'VALID',
            fingerprint: 'sha256:abc123',
            age: 28, // Close to 30 day expiry
          },
        ],
      })

      displayResults(result, 30)

      expect(mockConsoleWarn).toHaveBeenCalledWith(expect.stringContaining('approaching expiry'))
      expect(mockConsoleWarn).toHaveBeenCalledWith(expect.stringContaining('28 days old'))
    })

    it('should display strict mode message with warnings', () => {
      const result = createMockVerifyResult({
        success: true,
        suites: [
          {
            suite: 'test-suite',
            status: 'VALID',
            fingerprint: 'sha256:abc123',
            age: 28,
          },
        ],
      })

      displayResults(result, 30, true)

      expect(mockConsoleLog).toHaveBeenCalledWith(expect.stringContaining('--strict mode'))
    })

    it('should not display warnings for fresh attestations', () => {
      const result = createMockVerifyResult({
        success: true,
        suites: [
          {
            suite: 'test-suite',
            status: 'VALID',
            fingerprint: 'sha256:abc123',
            age: 5, // Fresh
          },
        ],
      })

      displayResults(result, 30)

      expect(mockConsoleWarn).not.toHaveBeenCalled()
    })
  })

  describe('hasWarnings', () => {
    it('should return true when attestation is approaching expiry', () => {
      const result = createMockVerifyResult({
        suites: [
          {
            suite: 'test-suite',
            status: 'VALID',
            fingerprint: 'sha256:abc123',
            age: 28,
          },
        ],
      })

      expect(hasWarnings(result, 30)).toBe(true)
    })

    it('should return false when attestation is fresh', () => {
      const result = createMockVerifyResult({
        suites: [
          {
            suite: 'test-suite',
            status: 'VALID',
            fingerprint: 'sha256:abc123',
            age: 5,
          },
        ],
      })

      expect(hasWarnings(result, 30)).toBe(false)
    })

    it('should return false when all suites have issues', () => {
      const result = createMockVerifyResult({
        success: false,
        suites: [
          {
            suite: 'test-suite',
            status: 'NEEDS_ATTESTATION',
            fingerprint: 'sha256:abc123',
          },
        ],
      })

      expect(hasWarnings(result, 30)).toBe(false)
    })

    it('should return false with no suites', () => {
      const result = createMockVerifyResult({
        suites: [],
      })

      expect(hasWarnings(result, 30)).toBe(false)
    })
  })

  describe('edge cases', () => {
    it('should handle multiple suites with mixed statuses', async () => {
      const mockConfig = createMockConfig()
      vi.mocked(loadConfig).mockResolvedValue(mockConfig)
      vi.mocked(verifyAttestations).mockResolvedValue(
        createMockVerifyResult({
          success: false,
          suites: [
            {
              suite: 'suite1',
              status: 'VALID',
              fingerprint: 'sha256:abc123',
              age: 5,
            },
            {
              suite: 'suite2',
              status: 'NEEDS_ATTESTATION',
              fingerprint: 'sha256:def456',
            },
            {
              suite: 'suite3',
              status: 'EXPIRED',
              fingerprint: 'sha256:ghi789',
              age: 45,
            },
          ],
        }),
      )

      await runVerify({})

      expect(mockProcessExit).toHaveBeenCalledWith(1)
    })

    it('should handle unknown error type', async () => {
      vi.mocked(loadConfig).mockRejectedValue('string error')

      await runVerify({})

      expect(mockConsoleError).toHaveBeenCalledWith(expect.stringContaining('Unknown error'))
      expect(mockProcessExit).toHaveBeenCalledWith(2)
    })

    it('should handle empty suite list', async () => {
      const mockConfig = createMockConfig()
      vi.mocked(loadConfig).mockResolvedValue({
        ...mockConfig,
        suites: {},
      })
      vi.mocked(verifyAttestations).mockResolvedValue(
        createMockVerifyResult({
          success: true,
          suites: [],
        }),
      )

      await runVerify({})

      expect(mockProcessExit).toHaveBeenCalledWith(0)
    })
  })
})
