import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { runStatus } from '../src/commands/status.js'
import { SplitConfigNotFoundError } from '@attest-it/core'
import type { SealVerificationResult, AttestItConfig, SealsFile } from '@attest-it/core'

// Fixed timestamp for deterministic seal fixtures.
const FIXED_TIMESTAMP = '2024-01-15T10:30:00.000Z'

// Mock the core functions
vi.mock('@attest-it/core', async () => {
  const actual = await vi.importActual<typeof import('@attest-it/core')>('@attest-it/core')
  return {
    ...actual,
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
const { loadSplitConfig, computeFingerprintSync, readSealsSync, verifyAllSeals, verifyGateSeal } =
  await import('@attest-it/core')

describe('status command', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

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
          timestamp: FIXED_TIMESTAMP,
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
        timestamp: FIXED_TIMESTAMP,
        sealedBy: 'alice',
        signature: 'test-signature-base64',
      },
      ...overrides,
    }
  }

  describe('positive cases', () => {
    it('should show VALID status when seal matches', async () => {
      const mockAttestItConfig = createMockAttestItConfig()
      vi.mocked(loadSplitConfig).mockResolvedValue(mockAttestItConfig)
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
      expect(mockProcessExit).toHaveBeenCalledWith(0) // status is informational-only; always exits 0
    })

    it('should output JSON with --json flag', async () => {
      const mockAttestItConfig = createMockAttestItConfig()
      vi.mocked(loadSplitConfig).mockResolvedValue(mockAttestItConfig)
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

      await runStatus([], { json: true })

      expect(mockProcessExit).toHaveBeenCalledWith(0) // status is informational-only; always exits 0
      expect(mockConsoleLog).toHaveBeenCalledWith(expect.stringContaining('MISSING'))
    })

    it('should show FINGERPRINT_MISMATCH when code changed', async () => {
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

      await runStatus([], { json: true })

      expect(mockProcessExit).toHaveBeenCalledWith(0) // status is informational-only; always exits 0
      expect(mockConsoleLog).toHaveBeenCalledWith(expect.stringContaining('FINGERPRINT_MISMATCH'))
    })

    it('should show STALE when seal exceeds maxAge, but exit SUCCESS since STALE is a warning not a failure', async () => {
      // Regression test for PR #92 review thread: status.ts's JSDoc claims it
      // "mirrors verify's exit-code semantics", but verify treats a STALE-only
      // result set as SUCCESS (STALE is a warning, not a failure — see
      // verify.ts's `hasStale` branch). status previously exited FAILURE (1)
      // solely because a gate was STALE, contradicting that claim. It must now
      // exit SUCCESS (0) to actually mirror verify.
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

      await runStatus([], { json: true })

      expect(mockProcessExit).toHaveBeenCalledWith(0) // status is informational-only; always exits 0
      expect(mockConsoleLog).toHaveBeenCalledWith(expect.stringContaining('STALE'))
    })

    it("exits 0 (informational) even when gates are STALE or invalid — enforcement is verify's job", async () => {
      // status reports gate results (including STALE and MISSING) but never
      // enforces them; it always exits 0 on results. `verify` is the gate.
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
        createMockVerificationResult({
          gateId: 'gate1',
          state: 'STALE',
          message: 'Seal is 45 days old, exceeds maxAge of 30 days',
        }),
        createMockVerificationResult({
          gateId: 'gate2',
          state: 'MISSING',
          seal: undefined,
          message: 'No seal found',
        }),
      ])

      await runStatus([], { json: true })

      expect(mockProcessExit).toHaveBeenCalledWith(0)
    })

    it('should return exit code 3 when config not found', async () => {
      vi.mocked(loadSplitConfig).mockRejectedValue(new Error('Config not found'))

      await runStatus([], {})

      expect(mockProcessExit).toHaveBeenCalledWith(3) // CONFIG_ERROR
      expect(mockConsoleError).toHaveBeenCalledWith(expect.stringContaining('Config not found'))
    })

    it('should return exit code 3 when gate does not exist', async () => {
      const mockAttestItConfig = createMockAttestItConfig()
      vi.mocked(loadSplitConfig).mockResolvedValue(mockAttestItConfig)

      await runStatus(['nonexistent-gate'], {})

      expect(mockProcessExit).toHaveBeenCalledWith(3) // CONFIG_ERROR
      expect(mockConsoleError).toHaveBeenCalledWith(expect.stringContaining('not found'))
    })
  })

  describe('edge cases', () => {
    it('should filter by specific gates when provided', async () => {
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
      vi.mocked(verifyGateSeal).mockReturnValue(
        createMockVerificationResult({ gateId: 'gate1', state: 'VALID' }),
      )

      await runStatus(['gate1'], {})

      // Should only compute fingerprint for gate1
      expect(computeFingerprintSync).toHaveBeenCalledTimes(1)
      expect(verifyGateSeal).toHaveBeenCalledTimes(1)
      expect(mockProcessExit).toHaveBeenCalledWith(0)
    })

    it('should return exit code 2 (NO_WORK) when no gates defined', async () => {
      // Config loaded successfully but defines zero gates — distinct from a missing
      // or unreadable config (CONFIG_ERROR): there is simply nothing to report on.
      const mockAttestItConfig = { ...createMockAttestItConfig(), gates: {} }
      vi.mocked(loadSplitConfig).mockResolvedValue(mockAttestItConfig)

      await runStatus([], {})

      expect(mockConsoleWarn).toHaveBeenCalledWith(
        expect.stringContaining('No gates defined in configuration'),
      )
      expect(mockProcessExit).toHaveBeenCalledWith(2) // NO_WORK
    })

    it('should return exit code 2 (NO_WORK) when gates is undefined', async () => {
      const mockAttestItConfig = { ...createMockAttestItConfig(), gates: undefined }
      vi.mocked(loadSplitConfig).mockResolvedValue(mockAttestItConfig)

      await runStatus([], {})

      expect(mockConsoleWarn).toHaveBeenCalledWith(
        expect.stringContaining('No gates defined in configuration'),
      )
      expect(mockProcessExit).toHaveBeenCalledWith(2) // NO_WORK
    })

    it('should exit with code 3 (CONFIG_ERROR), not 0, when no config is discoverable', async () => {
      // Regression test for #81: a missing/unreadable config must never be reported
      // as a clean status (fail-closed), and must never be silently exit 0.
      vi.mocked(loadSplitConfig).mockRejectedValue(
        new SplitConfigNotFoundError(
          'Policy file not found. Expected .attest-it/policy.yaml, .attest-it/policy.yml, or .attest-it/policy.json',
          'policy',
        ),
      )

      await runStatus([], {})

      expect(mockConsoleError).toHaveBeenCalledWith(
        expect.stringContaining('Policy file not found'),
      )
      expect(mockConsoleLog).toHaveBeenCalledWith(expect.stringContaining('attest-it init'))
      expect(mockProcessExit).toHaveBeenCalledWith(3) // CONFIG_ERROR
      expect(mockProcessExit).not.toHaveBeenCalledWith(0)
    })

    it('should pass an explicit --config path through as the policy source override', async () => {
      const mockAttestItConfig = createMockAttestItConfig()
      vi.mocked(loadSplitConfig).mockResolvedValue(mockAttestItConfig)
      vi.mocked(readSealsSync).mockReturnValue(createMockSealsFile())
      vi.mocked(computeFingerprintSync).mockReturnValue({
        fingerprint: 'sha256:abc123def456',
        fileCount: 10,
        files: [],
      })
      vi.mocked(verifyAllSeals).mockReturnValue([createMockVerificationResult({ state: 'VALID' })])

      await runStatus([], {}, '/custom/policy.yaml')

      expect(loadSplitConfig).toHaveBeenCalledWith({
        policySource: { type: 'filesystem', path: '/custom/policy.yaml' },
      })
    })

    it('should exit with code 3 naming the path when --config points to a missing file', async () => {
      // Regression test for #81: `status --config <nonexistent-path>` must exit
      // non-zero with a message naming the unreadable path, not exit 0.
      vi.mocked(loadSplitConfig).mockRejectedValue(
        new SplitConfigNotFoundError(
          'Failed to read policy file at /custom/policy.yaml: Error: ENOENT: no such file or directory',
          'policy',
        ),
      )

      await runStatus([], {}, '/custom/policy.yaml')

      expect(loadSplitConfig).toHaveBeenCalledWith({
        policySource: { type: 'filesystem', path: '/custom/policy.yaml' },
      })
      expect(mockConsoleError).toHaveBeenCalledWith(expect.stringContaining('/custom/policy.yaml'))
      expect(mockProcessExit).toHaveBeenCalledWith(3) // CONFIG_ERROR
      expect(mockProcessExit).not.toHaveBeenCalledWith(0)
    })

    it('should handle unknown error types', async () => {
      vi.mocked(loadSplitConfig).mockRejectedValue('string error')

      await runStatus([], {})

      expect(mockProcessExit).toHaveBeenCalledWith(3) // CONFIG_ERROR
      expect(mockConsoleError).toHaveBeenCalledWith(expect.stringContaining('Unknown error'))
    })

    it('should show INVALID_SIGNATURE status', async () => {
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
          state: 'INVALID_SIGNATURE',
          message: 'Signature verification failed',
        }),
      ])

      await runStatus([], { json: true })

      expect(mockProcessExit).toHaveBeenCalledWith(0) // status is informational-only; always exits 0
      expect(mockConsoleLog).toHaveBeenCalledWith(expect.stringContaining('INVALID_SIGNATURE'))
    })

    it('should show UNKNOWN_SIGNER status', async () => {
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
          state: 'UNKNOWN_SIGNER',
          message: "Signer 'bob' not found in team",
        }),
      ])

      await runStatus([], { json: true })

      expect(mockProcessExit).toHaveBeenCalledWith(0) // status is informational-only; always exits 0
      expect(mockConsoleLog).toHaveBeenCalledWith(expect.stringContaining('UNKNOWN_SIGNER'))
    })

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

      await runStatus([], {})

      expect(mockProcessExit).toHaveBeenCalledWith(0) // status is informational-only; always exits 0
    })
  })
})
