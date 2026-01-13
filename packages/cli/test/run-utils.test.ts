import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  getAllSuiteStatuses,
  getSuitesNeedingAttestation,
  filterByPattern,
  getSuitesInGroup,
  formatStatusReason,
  type SuiteStatus,
} from '../src/commands/run-utils.js'
import type { Config, FingerprintResult, Attestation, AttestationsFile } from '@attest-it/core'

// Mock the core functions
vi.mock('@attest-it/core', async () => {
  const actual = await vi.importActual<typeof import('@attest-it/core')>('@attest-it/core')
  return {
    ...actual,
    computeFingerprint: vi.fn(),
    readAttestations: vi.fn(),
    findAttestation: vi.fn(),
  }
})

// Import mocked functions
const { computeFingerprint, readAttestations, findAttestation } = await import('@attest-it/core')

describe('run-utils', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Test helpers
  function createMockConfig(overrides?: Partial<Config>): Config {
    return {
      version: 1,
      settings: {
        attestationsPath: '.attestations.json',
        maxAgeDays: 30,
        publicKeyPath: 'test.pub',
        ...overrides?.settings,
      },
      suites: {
        'test-suite': {
          packages: ['pkg1'],
        },
        ...overrides?.suites,
      },
      groups: overrides?.groups,
    }
  }

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

  function createMockFingerprintResult(fingerprint = 'abc123'): FingerprintResult {
    return {
      fingerprint,
      files: [],
      fileCount: 0,
    }
  }

  function createMockAttestationsFile(attestations: Attestation[]): AttestationsFile {
    return {
      schemaVersion: '1',
      attestations,
      signature: 'mock-signature',
    }
  }

  describe('formatStatusReason', () => {
    describe('positive cases', () => {
      it('should format VALID status with age', () => {
        const result = formatStatusReason('VALID', 5, 30)
        expect(result).toBe('Attested 5 days ago')
      })

      it('should format VALID status without age', () => {
        const result = formatStatusReason('VALID')
        expect(result).toBe('Attested 0 days ago')
      })

      it('should format NEEDS_ATTESTATION status', () => {
        const result = formatStatusReason('NEEDS_ATTESTATION')
        expect(result).toBe('No attestation found')
      })

      it('should format FINGERPRINT_CHANGED status', () => {
        const result = formatStatusReason('FINGERPRINT_CHANGED')
        expect(result).toBe('Source files modified')
      })

      it('should format EXPIRED status with age and max', () => {
        const result = formatStatusReason('EXPIRED', 35, 30)
        expect(result).toBe('35 days old (max: 30)')
      })

      it('should format SIGNATURE_INVALID status', () => {
        const result = formatStatusReason('SIGNATURE_INVALID')
        expect(result).toBe('Signature verification failed')
      })

      it('should format INVALIDATED_BY_PARENT status', () => {
        const result = formatStatusReason('INVALIDATED_BY_PARENT')
        expect(result).toBe('Invalidated by parent suite')
      })
    })

    describe('negative cases', () => {
      it('should handle EXPIRED without age', () => {
        const result = formatStatusReason('EXPIRED')
        expect(result).toBe('0 days old (max: 30)')
      })

      it('should handle EXPIRED without maxAgeDays', () => {
        const result = formatStatusReason('EXPIRED', 35)
        expect(result).toBe('35 days old (max: 30)')
      })
    })

    describe('edge cases', () => {
      it('should handle zero age', () => {
        const result = formatStatusReason('VALID', 0, 30)
        expect(result).toBe('Attested 0 days ago')
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
        status: 'NEEDS_ATTESTATION',
        reason: 'Missing',
        currentFingerprint: 'def',
      },
      {
        name: 'e2e-tests',
        status: 'FINGERPRINT_CHANGED',
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
      it('should return VALID status when attestation matches', async () => {
        const config = createMockConfig()
        const attestation = createMockAttestation({
          suite: 'test-suite',
          fingerprint: 'abc123',
          attestedAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(), // 5 days ago
        })

        vi.mocked(readAttestations).mockResolvedValue(createMockAttestationsFile([attestation]))
        vi.mocked(computeFingerprint).mockResolvedValue(createMockFingerprintResult('abc123'))
        vi.mocked(findAttestation).mockReturnValue(attestation)

        const result = await getAllSuiteStatuses(config)

        expect(result).toHaveLength(1)
        expect(result[0]).toMatchObject({
          name: 'test-suite',
          status: 'VALID',
          currentFingerprint: 'abc123',
          attestedFingerprint: 'abc123',
        })
        expect(result[0]?.age).toBe(5)
      })

      it('should return statuses for multiple suites', async () => {
        const config: Config = {
          version: 1,
          settings: {
            attestationsPath: '.attestations.json',
            maxAgeDays: 30,
            publicKeyPath: 'test.pub',
          },
          suites: {
            'suite-1': { packages: ['pkg1'] },
            'suite-2': { packages: ['pkg2'] },
          },
        }

        vi.mocked(readAttestations).mockResolvedValue(createMockAttestationsFile([]))
        vi.mocked(computeFingerprint).mockResolvedValue(createMockFingerprintResult())
        vi.mocked(findAttestation).mockReturnValue(undefined)

        const result = await getAllSuiteStatuses(config)

        expect(result).toHaveLength(2)
        expect(result.map((r) => r.name)).toEqual(['suite-1', 'suite-2'])
        expect(result.every((r) => r.status === 'NEEDS_ATTESTATION')).toBe(true)
      })

      it('should compute fingerprint with ignore patterns', async () => {
        const config = createMockConfig({
          suites: {
            'test-suite': {
              packages: ['pkg1'],
              ignore: ['**/*.test.ts'],
            },
          },
        })

        vi.mocked(readAttestations).mockResolvedValue(createMockAttestationsFile([]))
        vi.mocked(computeFingerprint).mockResolvedValue(createMockFingerprintResult())
        vi.mocked(findAttestation).mockReturnValue(undefined)

        await getAllSuiteStatuses(config)

        expect(computeFingerprint).toHaveBeenCalledWith({
          packages: ['pkg1'],
          ignore: ['**/*.test.ts'],
        })
      })
    })

    describe('negative cases', () => {
      it('should return NEEDS_ATTESTATION when no attestation exists', async () => {
        const config = createMockConfig()

        vi.mocked(readAttestations).mockResolvedValue(createMockAttestationsFile([]))
        vi.mocked(computeFingerprint).mockResolvedValue(createMockFingerprintResult())
        vi.mocked(findAttestation).mockReturnValue(undefined)

        const result = await getAllSuiteStatuses(config)

        expect(result[0]?.status).toBe('NEEDS_ATTESTATION')
        expect(result[0]?.reason).toBe('No attestation found')
      })

      it('should return FINGERPRINT_CHANGED when fingerprint differs', async () => {
        const config = createMockConfig()
        const attestation = createMockAttestation({
          fingerprint: 'old-fingerprint',
        })

        vi.mocked(readAttestations).mockResolvedValue(createMockAttestationsFile([attestation]))
        vi.mocked(computeFingerprint).mockResolvedValue(
          createMockFingerprintResult('new-fingerprint'),
        )
        vi.mocked(findAttestation).mockReturnValue(attestation)

        const result = await getAllSuiteStatuses(config)

        expect(result[0]?.status).toBe('FINGERPRINT_CHANGED')
        expect(result[0]?.reason).toBe('Source files modified')
        expect(result[0]?.attestedFingerprint).toBe('old-fingerprint')
        expect(result[0]?.currentFingerprint).toBe('new-fingerprint')
      })

      it('should return EXPIRED when attestation is too old', async () => {
        const config = createMockConfig({
          settings: {
            maxAgeDays: 30,
            attestationsPath: '.attestations.json',
            publicKeyPath: 'test.pub',
          },
        })
        const attestation = createMockAttestation({
          fingerprint: 'abc123',
          attestedAt: new Date(Date.now() - 35 * 24 * 60 * 60 * 1000).toISOString(), // 35 days ago
        })

        vi.mocked(readAttestations).mockResolvedValue(createMockAttestationsFile([attestation]))
        vi.mocked(computeFingerprint).mockResolvedValue(createMockFingerprintResult('abc123'))
        vi.mocked(findAttestation).mockReturnValue(attestation)

        const result = await getAllSuiteStatuses(config)

        expect(result[0]?.status).toBe('EXPIRED')
        expect(result[0]?.age).toBe(35)
        expect(result[0]?.reason).toContain('35 days old')
      })

      it('should rethrow non-ENOENT errors when reading attestations', async () => {
        const config = createMockConfig()
        const error = new Error('Permission denied')

        vi.mocked(readAttestations).mockRejectedValue(error)

        await expect(getAllSuiteStatuses(config)).rejects.toThrow('Permission denied')
      })
    })

    describe('edge cases', () => {
      it('should handle missing attestations file gracefully', async () => {
        const config = createMockConfig()
        const error = new Error('ENOENT: no such file or directory')

        vi.mocked(readAttestations).mockRejectedValue(error)
        vi.mocked(computeFingerprint).mockResolvedValue(createMockFingerprintResult())
        vi.mocked(findAttestation).mockReturnValue(undefined)

        const result = await getAllSuiteStatuses(config)

        expect(result[0]?.status).toBe('NEEDS_ATTESTATION')
      })

      it('should handle attestation exactly at max age boundary', async () => {
        const config = createMockConfig({
          settings: {
            maxAgeDays: 30,
            attestationsPath: '.attestations.json',
            publicKeyPath: 'test.pub',
          },
        })
        const attestation = createMockAttestation({
          fingerprint: 'abc123',
          attestedAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(), // Exactly 30 days ago
        })

        vi.mocked(readAttestations).mockResolvedValue(createMockAttestationsFile([attestation]))
        vi.mocked(computeFingerprint).mockResolvedValue(createMockFingerprintResult('abc123'))
        vi.mocked(findAttestation).mockReturnValue(attestation)

        const result = await getAllSuiteStatuses(config)

        // At exactly max age, should still be valid (not >)
        expect(result[0]?.status).toBe('VALID')
      })

      it('should handle attestation one day past max age', async () => {
        const config = createMockConfig({
          settings: {
            maxAgeDays: 30,
            attestationsPath: '.attestations.json',
            publicKeyPath: 'test.pub',
          },
        })
        const attestation = createMockAttestation({
          fingerprint: 'abc123',
          attestedAt: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString(), // 31 days ago
        })

        vi.mocked(readAttestations).mockResolvedValue(createMockAttestationsFile([attestation]))
        vi.mocked(computeFingerprint).mockResolvedValue(createMockFingerprintResult('abc123'))
        vi.mocked(findAttestation).mockReturnValue(attestation)

        const result = await getAllSuiteStatuses(config)

        expect(result[0]?.status).toBe('EXPIRED')
      })

      it('should calculate age as 0 for today', async () => {
        const config = createMockConfig()
        const attestation = createMockAttestation({
          fingerprint: 'abc123',
          attestedAt: new Date().toISOString(), // Now
        })

        vi.mocked(readAttestations).mockResolvedValue(createMockAttestationsFile([attestation]))
        vi.mocked(computeFingerprint).mockResolvedValue(createMockFingerprintResult('abc123'))
        vi.mocked(findAttestation).mockReturnValue(attestation)

        const result = await getAllSuiteStatuses(config)

        expect(result[0]?.age).toBe(0)
        expect(result[0]?.status).toBe('VALID')
      })

      it('should not include age for suites without attestation', async () => {
        const config = createMockConfig()

        vi.mocked(readAttestations).mockResolvedValue(createMockAttestationsFile([]))
        vi.mocked(computeFingerprint).mockResolvedValue(createMockFingerprintResult())
        vi.mocked(findAttestation).mockReturnValue(undefined)

        const result = await getAllSuiteStatuses(config)

        expect(result[0]?.age).toBeUndefined()
        expect(result[0]?.attestedAt).toBeUndefined()
        expect(result[0]?.attestedFingerprint).toBeUndefined()
      })

      it('should handle suite config without ignore field', async () => {
        const config = createMockConfig({
          suites: {
            'test-suite': {
              packages: ['pkg1'],
              // No ignore field
            },
          },
        })

        vi.mocked(readAttestations).mockResolvedValue(createMockAttestationsFile([]))
        vi.mocked(computeFingerprint).mockResolvedValue(createMockFingerprintResult())
        vi.mocked(findAttestation).mockReturnValue(undefined)

        await getAllSuiteStatuses(config)

        expect(computeFingerprint).toHaveBeenCalledWith({
          packages: ['pkg1'],
        })
      })
    })
  })

  describe('getSuitesNeedingAttestation', () => {
    describe('positive cases', () => {
      it('should return only suites that are not VALID', async () => {
        const config: Config = {
          version: 1,
          settings: {
            attestationsPath: '.attestations.json',
            maxAgeDays: 30,
            publicKeyPath: 'test.pub',
          },
          suites: {
            'valid-suite': { packages: ['pkg1'] },
            'invalid-suite': { packages: ['pkg2'] },
          },
        }

        const validAttestation = createMockAttestation({
          suite: 'valid-suite',
          fingerprint: 'valid-fp',
        })

        vi.mocked(readAttestations).mockResolvedValue(
          createMockAttestationsFile([validAttestation]),
        )
        vi.mocked(computeFingerprint).mockImplementation(({ packages }) => {
          // First package is 'pkg1' for valid-suite, 'pkg2' for invalid-suite
          if (packages[0] === 'pkg1') {
            return Promise.resolve(createMockFingerprintResult('valid-fp'))
          }
          return Promise.resolve(createMockFingerprintResult('different-fp'))
        })
        vi.mocked(findAttestation).mockImplementation((_, suite) => {
          if (suite === 'valid-suite') {
            return validAttestation
          }
          return undefined
        })

        const result = await getSuitesNeedingAttestation(config)

        expect(result).toHaveLength(1)
        expect(result[0]?.name).toBe('invalid-suite')
        expect(result[0]?.status).toBe('NEEDS_ATTESTATION')
      })

      it('should return all suites when none are valid', async () => {
        const config: Config = {
          version: 1,
          settings: {
            attestationsPath: '.attestations.json',
            maxAgeDays: 30,
            publicKeyPath: 'test.pub',
          },
          suites: {
            'suite-1': { packages: ['pkg1'] },
            'suite-2': { packages: ['pkg2'] },
          },
        }

        vi.mocked(readAttestations).mockResolvedValue(createMockAttestationsFile([]))
        vi.mocked(computeFingerprint).mockResolvedValue(createMockFingerprintResult())
        vi.mocked(findAttestation).mockReturnValue(undefined)

        const result = await getSuitesNeedingAttestation(config)

        expect(result).toHaveLength(2)
        expect(result.every((r) => r.status !== 'VALID')).toBe(true)
      })
    })

    describe('negative cases', () => {
      it('should return empty array when all suites are valid', async () => {
        const config = createMockConfig()
        const attestation = createMockAttestation({
          fingerprint: 'abc123',
        })

        vi.mocked(readAttestations).mockResolvedValue(createMockAttestationsFile([attestation]))
        vi.mocked(computeFingerprint).mockResolvedValue(createMockFingerprintResult('abc123'))
        vi.mocked(findAttestation).mockReturnValue(attestation)

        const result = await getSuitesNeedingAttestation(config)

        expect(result).toHaveLength(0)
      })
    })

    describe('edge cases', () => {
      it('should include EXPIRED suites', async () => {
        const config = createMockConfig({
          settings: {
            maxAgeDays: 30,
            attestationsPath: '.attestations.json',
            publicKeyPath: 'test.pub',
          },
        })
        const attestation = createMockAttestation({
          fingerprint: 'abc123',
          attestedAt: new Date(Date.now() - 35 * 24 * 60 * 60 * 1000).toISOString(),
        })

        vi.mocked(readAttestations).mockResolvedValue(createMockAttestationsFile([attestation]))
        vi.mocked(computeFingerprint).mockResolvedValue(createMockFingerprintResult('abc123'))
        vi.mocked(findAttestation).mockReturnValue(attestation)

        const result = await getSuitesNeedingAttestation(config)

        expect(result).toHaveLength(1)
        expect(result[0]?.status).toBe('EXPIRED')
      })

      it('should include FINGERPRINT_CHANGED suites', async () => {
        const config = createMockConfig()
        const attestation = createMockAttestation({
          fingerprint: 'old-fp',
        })

        vi.mocked(readAttestations).mockResolvedValue(createMockAttestationsFile([attestation]))
        vi.mocked(computeFingerprint).mockResolvedValue(createMockFingerprintResult('new-fp'))
        vi.mocked(findAttestation).mockReturnValue(attestation)

        const result = await getSuitesNeedingAttestation(config)

        expect(result).toHaveLength(1)
        expect(result[0]?.status).toBe('FINGERPRINT_CHANGED')
      })
    })
  })
})
