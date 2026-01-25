import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  getAllSuiteStatuses,
  getSuitesNeedingAttestation,
  filterByPattern,
  getSuitesInGroup,
  formatStatusReason,
  type SuiteStatus,
} from '../src/commands/run-utils.js'
import type {
  Config,
  FingerprintResult,
  Seal,
  SealsFile,
  SealVerificationResult,
  VerificationState,
} from '@attest-it/core'

// Mock the core functions
vi.mock('@attest-it/core', async () => {
  const actual = await vi.importActual<typeof import('@attest-it/core')>('@attest-it/core')
  return {
    ...actual,
    computeFingerprint: vi.fn(),
    readSealsSync: vi.fn(),
    verifyGateSeal: vi.fn(),
    toAttestItConfig: vi.fn((config: Config) => config),
  }
})

// Import mocked functions
const { computeFingerprint, readSealsSync, verifyGateSeal } = await import('@attest-it/core')

describe('run-utils', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Test helpers
  function createMockConfig(overrides?: Partial<Config>): Config {
    // Default to a gate-based suite since legacy package-based suites are now skipped
    const gates = overrides?.gates ?? {
      'test-gate': {
        name: 'Test Gate',
        description: 'A test gate',
        authorizedSigners: ['test-user'],
        fingerprint: {
          paths: ['pkg1/**'],
        },
        maxAge: '30d',
      },
    }

    const suites = overrides?.suites ?? {
      'test-suite': {
        gate: 'test-gate',
      },
    }

    return {
      version: 1,
      settings: {
        attestationsPath: '.attestations.json',
        sealsPath: '.attest-it/seals.json',
        maxAgeDays: 30,
        publicKeyPath: 'test.pub',
        ...overrides?.settings,
      },
      suites,
      gates,
      groups: overrides?.groups,
      team: overrides?.team,
    }
  }

  function createMockSeal(overrides?: Partial<Seal>): Seal {
    return {
      gateId: 'test-gate',
      fingerprint: 'abc123',
      timestamp: new Date().toISOString(),
      sealedBy: 'test-user',
      signature: 'mock-signature',
      ...overrides,
    }
  }

  function createMockFingerprintResult(fingerprint = 'abc123'): FingerprintResult {
    return {
      fingerprint,
      files: [],
      fileCount: 0,
    }
  }

  function createMockSealsFile(seals: Record<string, Seal> = {}): SealsFile {
    return {
      version: 1,
      seals,
    }
  }

  function createMockVerificationResult(
    overrides?: Partial<SealVerificationResult>,
  ): SealVerificationResult {
    return {
      gateId: 'test-gate',
      state: 'VALID' as VerificationState,
      ...overrides,
    }
  }

  describe('formatStatusReason', () => {
    describe('positive cases', () => {
      it('should format VALID status with age', () => {
        const result = formatStatusReason('VALID', 5)
        expect(result).toBe('Sealed 5 days ago')
      })

      it('should format VALID status without age', () => {
        const result = formatStatusReason('VALID')
        expect(result).toBe('Sealed 0 days ago')
      })

      it('should format MISSING status', () => {
        const result = formatStatusReason('MISSING')
        expect(result).toBe('No attestation found')
      })

      it('should format FINGERPRINT_MISMATCH status', () => {
        const result = formatStatusReason('FINGERPRINT_MISMATCH')
        expect(result).toBe('Source files modified')
      })

      it('should format STALE status with age', () => {
        const result = formatStatusReason('STALE', 35)
        expect(result).toBe('Seal expired (35 days old)')
      })

      it('should format INVALID_SIGNATURE status', () => {
        const result = formatStatusReason('INVALID_SIGNATURE')
        expect(result).toBe('Signature verification failed')
      })

      it('should format UNKNOWN_SIGNER status', () => {
        const result = formatStatusReason('UNKNOWN_SIGNER')
        expect(result).toBe('Signer not authorized')
      })
    })

    describe('negative cases', () => {
      it('should handle STALE without age', () => {
        const result = formatStatusReason('STALE')
        expect(result).toBe('Seal expired (0 days old)')
      })
    })

    describe('edge cases', () => {
      it('should handle zero age', () => {
        const result = formatStatusReason('VALID', 0)
        expect(result).toBe('Sealed 0 days ago')
      })

      it('should return status as-is for unknown status', () => {
        // @ts-expect-error - Testing with invalid status
        const result = formatStatusReason('UNKNOWN_STATUS')
        expect(result).toBe('UNKNOWN_STATUS')
      })
    })
  })

  describe('filterByPattern', () => {
    const mockSuites: SuiteStatus[] = [
      {
        name: 'unit-tests',
        status: 'VALID',
        reason: 'OK',
        currentFingerprint: 'abc',
      },
      {
        name: 'integration-tests',
        status: 'MISSING',
        reason: 'Missing',
        currentFingerprint: 'def',
      },
      {
        name: 'e2e-tests',
        status: 'FINGERPRINT_MISMATCH',
        reason: 'Changed',
        currentFingerprint: 'ghi',
      },
      {
        name: 'unit-frontend',
        status: 'VALID',
        reason: 'OK',
        currentFingerprint: 'jkl',
      },
    ]

    describe('positive cases', () => {
      it('should filter by exact match', () => {
        const result = filterByPattern(mockSuites, 'unit-tests')
        expect(result).toHaveLength(1)
        expect(result[0]?.name).toBe('unit-tests')
      })

      it('should filter by prefix wildcard', () => {
        const result = filterByPattern(mockSuites, 'unit*')
        expect(result).toHaveLength(2)
        expect(result.map((s) => s.name)).toEqual(['unit-tests', 'unit-frontend'])
      })

      it('should filter by suffix wildcard', () => {
        const result = filterByPattern(mockSuites, '*-tests')
        expect(result).toHaveLength(3)
        expect(result.map((s) => s.name)).toEqual(['unit-tests', 'integration-tests', 'e2e-tests'])
      })

      it('should filter by wildcard in middle', () => {
        const result = filterByPattern(mockSuites, 'integration*tests')
        expect(result).toHaveLength(1)
        expect(result[0]?.name).toBe('integration-tests')
      })

      it('should match all with * pattern', () => {
        const result = filterByPattern(mockSuites, '*')
        expect(result).toHaveLength(4)
      })
    })

    describe('negative cases', () => {
      it('should return empty array when no matches', () => {
        const result = filterByPattern(mockSuites, 'nonexistent')
        expect(result).toHaveLength(0)
      })

      it('should return empty array for empty pattern that does not match', () => {
        const result = filterByPattern(mockSuites, 'xyz*')
        expect(result).toHaveLength(0)
      })
    })

    describe('edge cases', () => {
      it('should handle empty suites array', () => {
        const result = filterByPattern([], 'anything')
        expect(result).toHaveLength(0)
      })

      it('should be case-insensitive', () => {
        const result = filterByPattern(mockSuites, 'UNIT-TESTS')
        expect(result).toHaveLength(1)
        expect(result[0]?.name).toBe('unit-tests')
      })

      it('should handle multiple wildcards', () => {
        const result = filterByPattern(mockSuites, '*unit*')
        expect(result).toHaveLength(2)
      })
    })
  })

  describe('getSuitesInGroup', () => {
    describe('positive cases', () => {
      it('should return suites in existing group', () => {
        const config = createMockConfig({
          groups: {
            frontend: ['unit-frontend', 'e2e-frontend'],
            backend: ['unit-backend', 'integration-backend'],
          },
        })

        const result = getSuitesInGroup('frontend', config)
        expect(result).toEqual(['unit-frontend', 'e2e-frontend'])
      })

      it('should return empty array for non-existent group', () => {
        const config = createMockConfig({
          groups: {
            frontend: ['unit-frontend'],
          },
        })

        const result = getSuitesInGroup('backend', config)
        expect(result).toEqual([])
      })
    })

    describe('negative cases', () => {
      it('should return empty array when groups is undefined', () => {
        const config = createMockConfig()

        const result = getSuitesInGroup('anygroup', config)
        expect(result).toEqual([])
      })

      it('should return empty array when group does not exist', () => {
        const config = createMockConfig({
          groups: {},
        })

        const result = getSuitesInGroup('nonexistent', config)
        expect(result).toEqual([])
      })
    })

    describe('edge cases', () => {
      it('should return empty array for group with empty array', () => {
        const config = createMockConfig({
          groups: {
            empty: [],
          },
        })

        const result = getSuitesInGroup('empty', config)
        expect(result).toEqual([])
      })

      it('should handle group with single suite', () => {
        const config = createMockConfig({
          groups: {
            single: ['only-suite'],
          },
        })

        const result = getSuitesInGroup('single', config)
        expect(result).toEqual(['only-suite'])
      })
    })
  })

  describe('getAllSuiteStatuses', () => {
    describe('positive cases', () => {
      it('should return VALID status when seal verification passes', async () => {
        const config = createMockConfig()
        const seal = createMockSeal({
          fingerprint: 'abc123',
          timestamp: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(), // 5 days ago
        })

        vi.mocked(readSealsSync).mockReturnValue(
          createMockSealsFile({ 'test-gate': seal }),
        )
        vi.mocked(computeFingerprint).mockResolvedValue(createMockFingerprintResult('abc123'))
        vi.mocked(verifyGateSeal).mockReturnValue(
          createMockVerificationResult({
            state: 'VALID',
            seal,
          }),
        )

        const result = await getAllSuiteStatuses(config)

        expect(result).toHaveLength(1)
        expect(result[0]).toMatchObject({
          name: 'test-suite',
          status: 'VALID',
          currentFingerprint: 'abc123',
          sealedFingerprint: 'abc123',
        })
        expect(result[0]?.age).toBe(5)
      })

      it('should return statuses for multiple suites', async () => {
        const config = createMockConfig({
          gates: {
            'gate-1': {
              name: 'Gate 1',
              description: 'First gate',
              authorizedSigners: ['user'],
              fingerprint: { paths: ['pkg1/**'] },
              maxAge: '30d',
            },
            'gate-2': {
              name: 'Gate 2',
              description: 'Second gate',
              authorizedSigners: ['user'],
              fingerprint: { paths: ['pkg2/**'] },
              maxAge: '30d',
            },
          },
          suites: {
            'suite-1': { gate: 'gate-1' },
            'suite-2': { gate: 'gate-2' },
          },
        })

        vi.mocked(readSealsSync).mockReturnValue(createMockSealsFile())
        vi.mocked(computeFingerprint).mockResolvedValue(createMockFingerprintResult())
        vi.mocked(verifyGateSeal).mockReturnValue(
          createMockVerificationResult({ state: 'MISSING' }),
        )

        const result = await getAllSuiteStatuses(config)

        expect(result).toHaveLength(2)
        expect(result.map((r) => r.name).sort()).toEqual(['suite-1', 'suite-2'])
        expect(result.every((r) => r.status === 'MISSING')).toBe(true)
      })

      it('should compute fingerprint with ignore patterns from gate', async () => {
        const config = createMockConfig({
          gates: {
            'test-gate': {
              name: 'Test Gate',
              description: 'A test gate',
              authorizedSigners: ['test-user'],
              fingerprint: {
                paths: ['pkg1/**'],
                exclude: ['**/*.test.ts'],
              },
              maxAge: '30d',
            },
          },
          suites: {
            'test-suite': {
              gate: 'test-gate',
            },
          },
        })

        vi.mocked(readSealsSync).mockReturnValue(createMockSealsFile())
        vi.mocked(computeFingerprint).mockResolvedValue(createMockFingerprintResult())
        vi.mocked(verifyGateSeal).mockReturnValue(
          createMockVerificationResult({ state: 'MISSING' }),
        )

        await getAllSuiteStatuses(config)

        expect(computeFingerprint).toHaveBeenCalledWith({
          packages: ['pkg1/**'],
          ignore: ['**/*.test.ts'],
        })
      })
    })

    describe('negative cases', () => {
      it('should return MISSING when no seal exists', async () => {
        const config = createMockConfig()

        vi.mocked(readSealsSync).mockReturnValue(createMockSealsFile())
        vi.mocked(computeFingerprint).mockResolvedValue(createMockFingerprintResult())
        vi.mocked(verifyGateSeal).mockReturnValue(
          createMockVerificationResult({
            state: 'MISSING',
            message: 'No seal found for gate',
          }),
        )

        const result = await getAllSuiteStatuses(config)

        expect(result[0]?.status).toBe('MISSING')
        expect(result[0]?.reason).toBe('No seal found for gate')
      })

      it('should return FINGERPRINT_MISMATCH when fingerprint differs', async () => {
        const config = createMockConfig()
        const seal = createMockSeal({
          fingerprint: 'old-fingerprint',
        })

        vi.mocked(readSealsSync).mockReturnValue(
          createMockSealsFile({ 'test-gate': seal }),
        )
        vi.mocked(computeFingerprint).mockResolvedValue(
          createMockFingerprintResult('new-fingerprint'),
        )
        vi.mocked(verifyGateSeal).mockReturnValue(
          createMockVerificationResult({
            state: 'FINGERPRINT_MISMATCH',
            seal,
            message: 'Fingerprint changed since seal was created',
          }),
        )

        const result = await getAllSuiteStatuses(config)

        expect(result[0]?.status).toBe('FINGERPRINT_MISMATCH')
        expect(result[0]?.reason).toBe('Fingerprint changed since seal was created')
        expect(result[0]?.sealedFingerprint).toBe('old-fingerprint')
        expect(result[0]?.currentFingerprint).toBe('new-fingerprint')
      })

      it('should return STALE when seal is too old', async () => {
        const config = createMockConfig()
        const seal = createMockSeal({
          fingerprint: 'abc123',
          timestamp: new Date(Date.now() - 35 * 24 * 60 * 60 * 1000).toISOString(), // 35 days ago
        })

        vi.mocked(readSealsSync).mockReturnValue(
          createMockSealsFile({ 'test-gate': seal }),
        )
        vi.mocked(computeFingerprint).mockResolvedValue(createMockFingerprintResult('abc123'))
        vi.mocked(verifyGateSeal).mockReturnValue(
          createMockVerificationResult({
            state: 'STALE',
            seal,
            message: 'Seal is 35 days old, exceeds maxAge of 30 days',
          }),
        )

        const result = await getAllSuiteStatuses(config)

        expect(result[0]?.status).toBe('STALE')
        expect(result[0]?.age).toBe(35)
        expect(result[0]?.reason).toContain('35 days old')
      })

      it('should return INVALID_SIGNATURE when signature verification fails', async () => {
        const config = createMockConfig()
        const seal = createMockSeal()

        vi.mocked(readSealsSync).mockReturnValue(
          createMockSealsFile({ 'test-gate': seal }),
        )
        vi.mocked(computeFingerprint).mockResolvedValue(createMockFingerprintResult())
        vi.mocked(verifyGateSeal).mockReturnValue(
          createMockVerificationResult({
            state: 'INVALID_SIGNATURE',
            seal,
            message: 'Signature verification failed',
          }),
        )

        const result = await getAllSuiteStatuses(config)

        expect(result[0]?.status).toBe('INVALID_SIGNATURE')
        expect(result[0]?.reason).toBe('Signature verification failed')
      })

      it('should return UNKNOWN_SIGNER when signer is not authorized', async () => {
        const config = createMockConfig()
        const seal = createMockSeal()

        vi.mocked(readSealsSync).mockReturnValue(
          createMockSealsFile({ 'test-gate': seal }),
        )
        vi.mocked(computeFingerprint).mockResolvedValue(createMockFingerprintResult())
        vi.mocked(verifyGateSeal).mockReturnValue(
          createMockVerificationResult({
            state: 'UNKNOWN_SIGNER',
            seal,
            message: 'Signer not found in team',
          }),
        )

        const result = await getAllSuiteStatuses(config)

        expect(result[0]?.status).toBe('UNKNOWN_SIGNER')
        expect(result[0]?.reason).toBe('Signer not found in team')
      })
    })

    describe('edge cases', () => {
      it('should handle missing seals file gracefully', async () => {
        const config = createMockConfig()

        vi.mocked(readSealsSync).mockImplementation(() => {
          throw new Error('ENOENT: no such file or directory')
        })
        vi.mocked(computeFingerprint).mockResolvedValue(createMockFingerprintResult())
        vi.mocked(verifyGateSeal).mockReturnValue(
          createMockVerificationResult({ state: 'MISSING' }),
        )

        const result = await getAllSuiteStatuses(config)

        expect(result[0]?.status).toBe('MISSING')
      })

      it('should calculate age as 0 for today', async () => {
        const config = createMockConfig()
        const seal = createMockSeal({
          fingerprint: 'abc123',
          timestamp: new Date().toISOString(), // Now
        })

        vi.mocked(readSealsSync).mockReturnValue(
          createMockSealsFile({ 'test-gate': seal }),
        )
        vi.mocked(computeFingerprint).mockResolvedValue(createMockFingerprintResult('abc123'))
        vi.mocked(verifyGateSeal).mockReturnValue(
          createMockVerificationResult({
            state: 'VALID',
            seal,
          }),
        )

        const result = await getAllSuiteStatuses(config)

        expect(result[0]?.age).toBe(0)
        expect(result[0]?.status).toBe('VALID')
      })

      it('should not include age for suites without seal', async () => {
        const config = createMockConfig()

        vi.mocked(readSealsSync).mockReturnValue(createMockSealsFile())
        vi.mocked(computeFingerprint).mockResolvedValue(createMockFingerprintResult())
        vi.mocked(verifyGateSeal).mockReturnValue(
          createMockVerificationResult({ state: 'MISSING' }),
        )

        const result = await getAllSuiteStatuses(config)

        expect(result[0]?.age).toBeUndefined()
        expect(result[0]?.sealedAt).toBeUndefined()
        expect(result[0]?.sealedFingerprint).toBeUndefined()
      })

      it('should handle gate without exclude patterns', async () => {
        const config = createMockConfig({
          gates: {
            'simple-gate': {
              name: 'Simple Gate',
              description: 'A gate without excludes',
              authorizedSigners: ['test-user'],
              fingerprint: {
                paths: ['lib/**/*.js'],
              },
              maxAge: '30d',
            },
          },
          suites: {
            'simple-suite': {
              gate: 'simple-gate',
            },
          },
        })

        vi.mocked(readSealsSync).mockReturnValue(createMockSealsFile())
        vi.mocked(computeFingerprint).mockResolvedValue(createMockFingerprintResult())
        vi.mocked(verifyGateSeal).mockReturnValue(
          createMockVerificationResult({ state: 'MISSING' }),
        )

        await getAllSuiteStatuses(config)

        expect(computeFingerprint).toHaveBeenCalledWith({
          packages: ['lib/**/*.js'],
        })
      })
    })

    // Tests for gate-based suite handling
    describe('gate-based suites', () => {
      it('should handle suites that reference gates via gate property', async () => {
        const config = createMockConfig({
          gates: {
            'my-gate': {
              name: 'My Gate',
              description: 'A test gate',
              authorizedSigners: ['test-user'],
              fingerprint: {
                paths: ['src/**/*.ts'],
                exclude: ['**/*.test.ts'],
              },
              maxAge: '30d',
            },
          },
          suites: {
            'gate-based-suite': {
              gate: 'my-gate',
              command: 'npm test',
            },
          },
        })

        vi.mocked(readSealsSync).mockReturnValue(createMockSealsFile())
        vi.mocked(computeFingerprint).mockResolvedValue(createMockFingerprintResult('gate-fp'))
        vi.mocked(verifyGateSeal).mockReturnValue(
          createMockVerificationResult({ state: 'MISSING' }),
        )

        const result = await getAllSuiteStatuses(config)

        // Should NOT skip the gate-based suite
        expect(result).toHaveLength(1)
        expect(result[0]?.name).toBe('gate-based-suite')
        expect(result[0]?.status).toBe('MISSING')

        // Should use gate's fingerprint.paths and fingerprint.exclude
        expect(computeFingerprint).toHaveBeenCalledWith({
          packages: ['src/**/*.ts'],
          ignore: ['**/*.test.ts'],
        })
      })

      it('should skip suites referencing non-existent gates', async () => {
        const config = createMockConfig({
          gates: {
            'existing-gate': {
              name: 'Existing Gate',
              description: 'This gate exists',
              authorizedSigners: ['test-user'],
              fingerprint: { paths: ['src/**'] },
              maxAge: '30d',
            },
          },
          suites: {
            'orphan-suite': {
              gate: 'non-existent-gate', // References gate that doesn't exist
            },
          },
        })

        vi.mocked(readSealsSync).mockReturnValue(createMockSealsFile())
        vi.mocked(computeFingerprint).mockResolvedValue(createMockFingerprintResult())
        vi.mocked(verifyGateSeal).mockReturnValue(
          createMockVerificationResult({ state: 'MISSING' }),
        )

        const result = await getAllSuiteStatuses(config)

        // Suite with non-existent gate should be skipped
        expect(result).toHaveLength(0)
        expect(computeFingerprint).not.toHaveBeenCalled()
      })

      it('should skip suites without gate property', async () => {
        const config = createMockConfig({
          gates: {
            'ui-gate': {
              name: 'UI Gate',
              description: 'UI components',
              authorizedSigners: ['test-user'],
              fingerprint: { paths: ['src/ui/**'] },
              maxAge: '30d',
            },
          },
          suites: {
            'ui-suite': {
              gate: 'ui-gate',
              command: 'npm run test:ui',
            },
            'legacy-suite': {
              // No gate property - should be skipped
              command: 'npm run test:legacy',
            },
          },
        })

        vi.mocked(readSealsSync).mockReturnValue(createMockSealsFile())
        vi.mocked(computeFingerprint).mockResolvedValue(createMockFingerprintResult())
        vi.mocked(verifyGateSeal).mockReturnValue(
          createMockVerificationResult({ state: 'MISSING' }),
        )

        const result = await getAllSuiteStatuses(config)

        // Only gate-based suite should be included
        expect(result).toHaveLength(1)
        expect(result[0]?.name).toBe('ui-suite')

        // Only one fingerprint call for gate-based suite
        expect(computeFingerprint).toHaveBeenCalledTimes(1)
        expect(computeFingerprint).toHaveBeenCalledWith({ packages: ['src/ui/**'] })
      })

      it('should skip suites with gate property when gates config is undefined', async () => {
        const config = createMockConfig({
          gates: undefined,
          suites: {
            'gate-suite': {
              gate: 'some-gate',
            },
          },
        })

        vi.mocked(readSealsSync).mockReturnValue(createMockSealsFile())
        vi.mocked(computeFingerprint).mockResolvedValue(createMockFingerprintResult())
        vi.mocked(verifyGateSeal).mockReturnValue(
          createMockVerificationResult({ state: 'MISSING' }),
        )

        const result = await getAllSuiteStatuses(config)

        // Should skip when gates config is missing
        expect(result).toHaveLength(0)
      })

      it('should skip gates with empty paths array', async () => {
        const config = createMockConfig({
          gates: {
            'empty-gate': {
              name: 'Empty Gate',
              description: 'A gate with no paths',
              authorizedSigners: ['test-user'],
              fingerprint: { paths: [] },
              maxAge: '30d',
            },
          },
          suites: {
            'empty-suite': {
              gate: 'empty-gate',
            },
          },
        })

        vi.mocked(readSealsSync).mockReturnValue(createMockSealsFile())
        vi.mocked(computeFingerprint).mockResolvedValue(createMockFingerprintResult())

        const result = await getAllSuiteStatuses(config)

        // Should skip suites with gates that have no paths
        expect(result).toHaveLength(0)
        expect(computeFingerprint).not.toHaveBeenCalled()
      })
    })
  })

  describe('getSuitesNeedingAttestation', () => {
    describe('positive cases', () => {
      it('should return only suites that are not VALID', async () => {
        const config = createMockConfig({
          gates: {
            'gate-1': {
              name: 'Gate 1',
              description: 'First gate',
              authorizedSigners: ['user'],
              fingerprint: { paths: ['pkg1/**'] },
              maxAge: '30d',
            },
            'gate-2': {
              name: 'Gate 2',
              description: 'Second gate',
              authorizedSigners: ['user'],
              fingerprint: { paths: ['pkg2/**'] },
              maxAge: '30d',
            },
          },
          suites: {
            'valid-suite': { gate: 'gate-1' },
            'invalid-suite': { gate: 'gate-2' },
          },
        })

        const validSeal = createMockSeal({
          gateId: 'gate-1',
          fingerprint: 'valid-fp',
        })

        vi.mocked(readSealsSync).mockReturnValue(
          createMockSealsFile({ 'gate-1': validSeal }),
        )

        // Return different fingerprints for different gates
        vi.mocked(computeFingerprint).mockImplementation(({ packages }) => {
          if (packages[0] === 'pkg1/**') {
            return Promise.resolve(createMockFingerprintResult('valid-fp'))
          }
          return Promise.resolve(createMockFingerprintResult('different-fp'))
        })

        // Return different verification results for different gates
        vi.mocked(verifyGateSeal).mockImplementation((_config, gateId) => {
          if (gateId === 'gate-1') {
            return createMockVerificationResult({
              gateId: 'gate-1',
              state: 'VALID',
              seal: validSeal,
            })
          }
          return createMockVerificationResult({
            gateId: 'gate-2',
            state: 'MISSING',
          })
        })

        const result = await getSuitesNeedingAttestation(config)

        expect(result).toHaveLength(1)
        expect(result[0]?.name).toBe('invalid-suite')
        expect(result[0]?.status).toBe('MISSING')
      })

      it('should return all suites when none are valid', async () => {
        const config = createMockConfig({
          gates: {
            'gate-1': {
              name: 'Gate 1',
              description: 'First gate',
              authorizedSigners: ['user'],
              fingerprint: { paths: ['pkg1/**'] },
              maxAge: '30d',
            },
            'gate-2': {
              name: 'Gate 2',
              description: 'Second gate',
              authorizedSigners: ['user'],
              fingerprint: { paths: ['pkg2/**'] },
              maxAge: '30d',
            },
          },
          suites: {
            'suite-1': { gate: 'gate-1' },
            'suite-2': { gate: 'gate-2' },
          },
        })

        vi.mocked(readSealsSync).mockReturnValue(createMockSealsFile())
        vi.mocked(computeFingerprint).mockResolvedValue(createMockFingerprintResult())
        vi.mocked(verifyGateSeal).mockReturnValue(
          createMockVerificationResult({ state: 'MISSING' }),
        )

        const result = await getSuitesNeedingAttestation(config)

        expect(result).toHaveLength(2)
        expect(result.every((r) => r.status !== 'VALID')).toBe(true)
      })
    })

    describe('negative cases', () => {
      it('should return empty array when all suites are valid', async () => {
        const config = createMockConfig()
        const seal = createMockSeal({
          fingerprint: 'abc123',
        })

        vi.mocked(readSealsSync).mockReturnValue(
          createMockSealsFile({ 'test-gate': seal }),
        )
        vi.mocked(computeFingerprint).mockResolvedValue(createMockFingerprintResult('abc123'))
        vi.mocked(verifyGateSeal).mockReturnValue(
          createMockVerificationResult({
            state: 'VALID',
            seal,
          }),
        )

        const result = await getSuitesNeedingAttestation(config)

        expect(result).toHaveLength(0)
      })
    })

    describe('edge cases', () => {
      it('should include STALE suites', async () => {
        const config = createMockConfig()
        const seal = createMockSeal({
          fingerprint: 'abc123',
          timestamp: new Date(Date.now() - 35 * 24 * 60 * 60 * 1000).toISOString(),
        })

        vi.mocked(readSealsSync).mockReturnValue(
          createMockSealsFile({ 'test-gate': seal }),
        )
        vi.mocked(computeFingerprint).mockResolvedValue(createMockFingerprintResult('abc123'))
        vi.mocked(verifyGateSeal).mockReturnValue(
          createMockVerificationResult({
            state: 'STALE',
            seal,
            message: 'Seal expired',
          }),
        )

        const result = await getSuitesNeedingAttestation(config)

        expect(result).toHaveLength(1)
        expect(result[0]?.status).toBe('STALE')
      })

      it('should include FINGERPRINT_MISMATCH suites', async () => {
        const config = createMockConfig()
        const seal = createMockSeal({
          fingerprint: 'old-fp',
        })

        vi.mocked(readSealsSync).mockReturnValue(
          createMockSealsFile({ 'test-gate': seal }),
        )
        vi.mocked(computeFingerprint).mockResolvedValue(createMockFingerprintResult('new-fp'))
        vi.mocked(verifyGateSeal).mockReturnValue(
          createMockVerificationResult({
            state: 'FINGERPRINT_MISMATCH',
            seal,
          }),
        )

        const result = await getSuitesNeedingAttestation(config)

        expect(result).toHaveLength(1)
        expect(result[0]?.status).toBe('FINGERPRINT_MISMATCH')
      })
    })
  })
})
