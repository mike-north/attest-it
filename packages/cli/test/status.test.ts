import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { runStatus } from '../src/commands/status.js'
import type { AttestItConfig, FingerprintResult, Attestation } from '@attest-it/core'

// Mock the core functions
vi.mock('@attest-it/core', async () => {
  const actual = await vi.importActual<typeof import('@attest-it/core')>('@attest-it/core')
  return {
    ...actual,
    loadConfig: vi.fn(),
    computeFingerprint: vi.fn(),
    readAttestations: vi.fn(),
    findAttestation: vi.fn(),
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
const { loadConfig, computeFingerprint, readAttestations, findAttestation } =
  await import('@attest-it/core')

describe('status command', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  // Helper to create a mock config
  function createMockConfig(overrides?: Partial<AttestItConfig>): AttestItConfig {
    return {
      version: 1,
      settings: {
        attestationsPath: '.attestations.json',
        maxAgeDays: 30,
        publicKeyPath: 'test.pub',
        algorithm: 'ed25519',
        ...overrides?.settings,
      },
      suites: {
        'test-suite': {
          packages: ['pkg1'],
          ...(overrides?.suites && 'test-suite' in overrides.suites
            ? overrides.suites['test-suite']
            : {}),
        },
        ...(overrides?.suites
          ? Object.fromEntries(
              Object.entries(overrides.suites).filter(([key]) => key !== 'test-suite'),
            )
          : {}),
      },
    }
  }

  // Helper to create a mock attestation
  function createMockAttestation(overrides?: Partial<Attestation>): Attestation {
    return {
      suite: 'test-suite',
      fingerprint: 'abc123',
      attestedAt: new Date().toISOString(),
      attestedBy: 'test-user',
      command: 'npm test',
      exitCode: 0,
      ...overrides,
    }
  }

  // Helper to create a mock fingerprint result
  function createMockFingerprintResult(fingerprint = 'abc123'): FingerprintResult {
    return {
      fingerprint,
      files: [],
      fileCount: 0,
    }
  }

  describe('positive cases', () => {
    it('should show VALID status when attestation matches', async () => {
      const config = createMockConfig()
      const attestation = createMockAttestation({
        fingerprint: 'abc123',
        attestedAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(), // 5 days ago
      })
      const fingerprintResult = createMockFingerprintResult('abc123')

      vi.mocked(loadConfig).mockResolvedValue(config)
      vi.mocked(computeFingerprint).mockResolvedValue(fingerprintResult)
      vi.mocked(readAttestations).mockResolvedValue({
        schemaVersion: '1',
        attestations: [attestation],
        signature: 'sig',
      })
      vi.mocked(findAttestation).mockReturnValue(attestation)

      await runStatus({ json: false })

      expect(mockProcessExit).toHaveBeenCalledWith(0)
      expect(mockConsoleLog).toHaveBeenCalled()
    })

    it('should show status for all suites when no --suite option', async () => {
      const config: AttestItConfig = {
        version: 1,
        settings: {
          attestationsPath: '.attestations.json',
          maxAgeDays: 30,
          publicKeyPath: 'test.pub',
          algorithm: 'ed25519',
        },
        suites: {
          'suite-1': {
            packages: ['pkg1'],
          },
          'suite-2': {
            packages: ['pkg2'],
          },
        },
      }

      vi.mocked(loadConfig).mockResolvedValue(config)
      vi.mocked(computeFingerprint).mockResolvedValue(createMockFingerprintResult())
      vi.mocked(readAttestations).mockResolvedValue({
        schemaVersion: '1',
        attestations: [],
        signature: '',
      })
      vi.mocked(findAttestation).mockReturnValue(undefined)

      await runStatus({ json: false })

      expect(computeFingerprint).toHaveBeenCalledTimes(2)
      expect(mockProcessExit).toHaveBeenCalledWith(1) // Invalid because no attestations
    })

    it('should output JSON with --json flag', async () => {
      const config = createMockConfig()
      const attestation = createMockAttestation()
      const fingerprintResult = createMockFingerprintResult('abc123')

      vi.mocked(loadConfig).mockResolvedValue(config)
      vi.mocked(computeFingerprint).mockResolvedValue(fingerprintResult)
      vi.mocked(readAttestations).mockResolvedValue({
        schemaVersion: '1',
        attestations: [attestation],
        signature: 'sig',
      })
      vi.mocked(findAttestation).mockReturnValue(attestation)

      await runStatus({ json: true })

      expect(mockConsoleLog).toHaveBeenCalledWith(expect.stringContaining('"status"'))
      expect(mockConsoleLog).toHaveBeenCalledWith(expect.stringContaining('"name"'))
    })
  })

  describe('negative cases', () => {
    it('should show NEEDS_ATTESTATION when no attestation exists', async () => {
      const config = createMockConfig()
      const fingerprintResult = createMockFingerprintResult()

      vi.mocked(loadConfig).mockResolvedValue(config)
      vi.mocked(computeFingerprint).mockResolvedValue(fingerprintResult)
      vi.mocked(readAttestations).mockResolvedValue({
        schemaVersion: '1',
        attestations: [],
        signature: '',
      })
      vi.mocked(findAttestation).mockReturnValue(undefined)

      await runStatus({ json: true })

      expect(mockProcessExit).toHaveBeenCalledWith(1)
      expect(mockConsoleLog).toHaveBeenCalledWith(expect.stringContaining('NEEDS_ATTESTATION'))
    })

    it('should show FINGERPRINT_CHANGED when code changed', async () => {
      const config = createMockConfig()
      const attestation = createMockAttestation({
        fingerprint: 'old-fingerprint',
      })
      const fingerprintResult = createMockFingerprintResult('new-fingerprint')

      vi.mocked(loadConfig).mockResolvedValue(config)
      vi.mocked(computeFingerprint).mockResolvedValue(fingerprintResult)
      vi.mocked(readAttestations).mockResolvedValue({
        schemaVersion: '1',
        attestations: [attestation],
        signature: 'sig',
      })
      vi.mocked(findAttestation).mockReturnValue(attestation)

      await runStatus({ json: true })

      expect(mockProcessExit).toHaveBeenCalledWith(1)
      expect(mockConsoleLog).toHaveBeenCalledWith(expect.stringContaining('FINGERPRINT_CHANGED'))
    })

    it('should show EXPIRED when attestation too old', async () => {
      const config = createMockConfig({
        settings: {
          maxAgeDays: 30,
          attestationsPath: '.attestations.json',
          publicKeyPath: 'test.pub',
          algorithm: 'ed25519' as const,
        },
      })
      const attestation = createMockAttestation({
        fingerprint: 'abc123',
        attestedAt: new Date(Date.now() - 35 * 24 * 60 * 60 * 1000).toISOString(), // 35 days ago
      })
      const fingerprintResult = createMockFingerprintResult('abc123')

      vi.mocked(loadConfig).mockResolvedValue(config)
      vi.mocked(computeFingerprint).mockResolvedValue(fingerprintResult)
      vi.mocked(readAttestations).mockResolvedValue({
        schemaVersion: '1',
        attestations: [attestation],
        signature: 'sig',
      })
      vi.mocked(findAttestation).mockReturnValue(attestation)

      await runStatus({ json: true })

      expect(mockProcessExit).toHaveBeenCalledWith(1)
      expect(mockConsoleLog).toHaveBeenCalledWith(expect.stringContaining('EXPIRED'))
    })

    it('should return exit code 2 when config not found', async () => {
      vi.mocked(loadConfig).mockRejectedValue(new Error('Config not found'))

      await runStatus({ json: false })

      expect(mockProcessExit).toHaveBeenCalledWith(2)
      expect(mockConsoleError).toHaveBeenCalledWith(expect.stringContaining('Config not found'))
    })

    it('should return exit code 2 when suite does not exist', async () => {
      const config = createMockConfig()
      vi.mocked(loadConfig).mockResolvedValue(config)

      await runStatus({ suite: 'nonexistent-suite', json: false })

      expect(mockProcessExit).toHaveBeenCalledWith(2)
      expect(mockConsoleError).toHaveBeenCalledWith(
        expect.stringContaining('Suite "nonexistent-suite" not found'),
      )
    })
  })

  describe('edge cases', () => {
    it('should handle missing attestations file gracefully', async () => {
      const config = createMockConfig()
      const fingerprintResult = createMockFingerprintResult()

      vi.mocked(loadConfig).mockResolvedValue(config)
      vi.mocked(computeFingerprint).mockResolvedValue(fingerprintResult)
      vi.mocked(readAttestations).mockRejectedValue(
        Object.assign(new Error('ENOENT: no such file'), { code: 'ENOENT' }),
      )
      vi.mocked(findAttestation).mockReturnValue(undefined)

      await runStatus({ json: false })

      // Should not crash, should treat as no attestations
      expect(mockProcessExit).toHaveBeenCalledWith(1)
    })

    it('should filter by --suite option', async () => {
      const config: AttestItConfig = {
        version: 1,
        settings: {
          attestationsPath: '.attestations.json',
          maxAgeDays: 30,
          publicKeyPath: 'test.pub',
          algorithm: 'ed25519',
        },
        suites: {
          'suite-1': {
            packages: ['pkg1'],
          },
          'suite-2': {
            packages: ['pkg2'],
          },
        },
      }

      vi.mocked(loadConfig).mockResolvedValue(config)
      vi.mocked(computeFingerprint).mockResolvedValue(createMockFingerprintResult())
      vi.mocked(readAttestations).mockResolvedValue({
        schemaVersion: '1',
        attestations: [],
        signature: '',
      })
      vi.mocked(findAttestation).mockReturnValue(undefined)

      await runStatus({ suite: 'suite-1', json: false })

      // Should only compute fingerprint for suite-1
      expect(computeFingerprint).toHaveBeenCalledTimes(1)
      expect(computeFingerprint).toHaveBeenCalledWith({
        packages: ['pkg1'],
      })
    })

    it('should handle empty suites object', async () => {
      const config: AttestItConfig = {
        version: 1,
        settings: {
          attestationsPath: '.attestations.json',
          maxAgeDays: 30,
          publicKeyPath: 'test.pub',
          algorithm: 'ed25519',
        },
        suites: {},
      }

      vi.mocked(loadConfig).mockResolvedValue(config)
      vi.mocked(readAttestations).mockResolvedValue({
        schemaVersion: '1',
        attestations: [],
        signature: '',
      })

      await runStatus({ json: false })

      // Empty suites means no invalid attestations, so exit 0
      // Note: In practice, config validation requires at least one suite
      expect(mockProcessExit).toHaveBeenCalledWith(0)
      expect(computeFingerprint).not.toHaveBeenCalled()
    })

    it('should handle unknown error types', async () => {
      vi.mocked(loadConfig).mockRejectedValue('string error')

      await runStatus({ json: false })

      expect(mockProcessExit).toHaveBeenCalledWith(2)
      expect(mockConsoleError).toHaveBeenCalledWith(expect.stringContaining('Unknown error'))
    })
  })
})
