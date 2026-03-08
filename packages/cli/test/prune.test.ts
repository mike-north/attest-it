import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { runPrune } from '../src/commands/prune.js'
import type { Config, AttestationsFile, Attestation } from '@attest-it/core'

// Mock core functions
vi.mock('@attest-it/core', async () => {
  const actual = await vi.importActual<typeof import('@attest-it/core')>('@attest-it/core')
  return {
    ...actual,
    loadConfig: vi.fn(),
    loadSplitConfig: vi.fn(),
    readAttestations: vi.fn(),
    writeAttestations: vi.fn(),
    computeFingerprint: vi.fn(),
  }
})

// Mock output utilities
vi.mock('../src/utils/output.js', () => ({
  log: vi.fn(),
  verbose: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
}))

// Mock process.exit
const mockProcessExit = vi
  .spyOn(process, 'exit')
  // @ts-expect-error - Mocking process.exit which has a complex signature
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  .mockImplementation(() => {})

const { loadConfig, loadSplitConfig, readAttestations, writeAttestations, computeFingerprint } =
  await import('@attest-it/core')

describe('runPrune', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  // Helper to create a mock config
  function createMockConfig(overrides?: Partial<Config>): Config {
    return {
      version: 1,
      settings: {
        maxAgeDays: 30,
        publicKeyPath: '.attest-it/pubkey.pem',
        attestationsPath: '.attest-it/attestations.json',
        sealsPath: '.attest-it/seals.json',
        ...overrides?.settings,
      },
      gates: {
        'test-gate': {
          name: 'Test Gate',
          description: 'Test gate',
          authorizedSigners: ['test-user'],
          fingerprint: {
            paths: ['pkg1'],
          },
          maxAge: '30d',
        },
        ...overrides?.gates,
      },
      suites: {
        'test-suite': {
          gate: 'test-gate',
        },
        ...overrides?.suites,
      },
    }
  }

  // Helper to create a mock attestation
  function createMockAttestation(overrides?: Partial<Attestation>): Attestation {
    return {
      suite: 'test-suite',
      fingerprint: 'sha256:abc123',
      attestedAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(), // 10 days ago
      attestedBy: 'test-user',
      command: 'npm test',
      exitCode: 0,
      ...overrides,
    }
  }

  // Helper to create a mock attestations file
  function createMockAttestationsFile(attestations: Attestation[]): AttestationsFile {
    return {
      schemaVersion: '1',
      attestations,
      signature: 'mock-signature',
    }
  }

  describe('positive cases', () => {
    it('should identify stale attestations correctly', async () => {
      const config = createMockConfig()
      const staleAttestation = createMockAttestation({
        attestedAt: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString(), // 40 days ago
      })
      const file = createMockAttestationsFile([staleAttestation])

      vi.mocked(loadSplitConfig).mockResolvedValue(config)
      vi.mocked(readAttestations).mockResolvedValue(file)
      vi.mocked(computeFingerprint).mockResolvedValue({
        fingerprint: 'sha256:different', // Different fingerprint = changed
        files: [],
        fileCount: 10,
      })

      await runPrune({ keepDays: '30', dryRun: false })

      expect(writeAttestations).toHaveBeenCalledWith(
        '.attest-it/attestations.json',
        [], // All attestations should be pruned
        'unsigned',
      )
      expect(mockProcessExit).toHaveBeenCalledWith(0)
    })

    it('should keep recent attestations', async () => {
      const config = createMockConfig()
      const recentAttestation = createMockAttestation({
        attestedAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(), // 10 days ago
      })
      const file = createMockAttestationsFile([recentAttestation])

      vi.mocked(loadSplitConfig).mockResolvedValue(config)
      vi.mocked(readAttestations).mockResolvedValue(file)
      vi.mocked(computeFingerprint).mockResolvedValue({
        fingerprint: 'sha256:abc123', // Same fingerprint = unchanged
        files: [],
        fileCount: 10,
      })

      await runPrune({ keepDays: '30', dryRun: false })

      expect(writeAttestations).not.toHaveBeenCalled()
      expect(mockProcessExit).toHaveBeenCalledWith(0)
    })

    it('should keep attestations with matching fingerprint regardless of age', async () => {
      const config = createMockConfig()
      const oldAttestation = createMockAttestation({
        attestedAt: new Date(Date.now() - 100 * 24 * 60 * 60 * 1000).toISOString(), // 100 days ago
      })
      const file = createMockAttestationsFile([oldAttestation])

      vi.mocked(loadSplitConfig).mockResolvedValue(config)
      vi.mocked(readAttestations).mockResolvedValue(file)
      vi.mocked(computeFingerprint).mockResolvedValue({
        fingerprint: 'sha256:abc123', // Same fingerprint = unchanged
        files: [],
        fileCount: 10,
      })

      await runPrune({ keepDays: '30', dryRun: false })

      expect(writeAttestations).not.toHaveBeenCalled()
      expect(mockProcessExit).toHaveBeenCalledWith(0)
    })
  })

  describe('negative cases', () => {
    it('should handle --dry-run flag', async () => {
      const config = createMockConfig()
      const staleAttestation = createMockAttestation({
        attestedAt: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString(),
      })
      const file = createMockAttestationsFile([staleAttestation])

      vi.mocked(loadSplitConfig).mockResolvedValue(config)
      vi.mocked(readAttestations).mockResolvedValue(file)
      vi.mocked(computeFingerprint).mockResolvedValue({
        fingerprint: 'sha256:different',
        files: [],
        fileCount: 10,
      })

      await runPrune({ keepDays: '30', dryRun: true })

      expect(writeAttestations).not.toHaveBeenCalled()
      expect(mockProcessExit).toHaveBeenCalledWith(0)
    })

    it('should handle invalid --keep-days value', async () => {
      await runPrune({ keepDays: 'invalid', dryRun: false })

      expect(mockProcessExit).toHaveBeenCalledWith(3) // CONFIG_ERROR
    })

    it('should handle negative --keep-days value', async () => {
      await runPrune({ keepDays: '-5', dryRun: false })

      expect(mockProcessExit).toHaveBeenCalledWith(3) // CONFIG_ERROR
    })

    it('should handle zero --keep-days value', async () => {
      await runPrune({ keepDays: '0', dryRun: false })

      expect(mockProcessExit).toHaveBeenCalledWith(3) // CONFIG_ERROR
    })
  })

  describe('edge cases', () => {
    it('should handle empty attestations file', async () => {
      const config = createMockConfig()
      const file = createMockAttestationsFile([])

      vi.mocked(loadSplitConfig).mockResolvedValue(config)
      vi.mocked(readAttestations).mockResolvedValue(file)

      await runPrune({ keepDays: '30', dryRun: false })

      expect(writeAttestations).not.toHaveBeenCalled()
      expect(mockProcessExit).toHaveBeenCalledWith(0)
    })

    it('should handle missing attestations file', async () => {
      const config = createMockConfig()

      vi.mocked(loadSplitConfig).mockResolvedValue(config)
      vi.mocked(readAttestations).mockResolvedValue(null)

      await runPrune({ keepDays: '30', dryRun: false })

      expect(writeAttestations).not.toHaveBeenCalled()
      expect(mockProcessExit).toHaveBeenCalledWith(0)
    })

    it('should report orphaned suites (suite removed from config)', async () => {
      const config = createMockConfig({
        suites: {
          'different-suite': {
            packages: ['pkg1'],
          },
        },
      })
      const orphanedAttestation = createMockAttestation({
        suite: 'removed-suite',
      })
      const file = createMockAttestationsFile([orphanedAttestation])

      vi.mocked(loadSplitConfig).mockResolvedValue(config)
      vi.mocked(readAttestations).mockResolvedValue(file)

      await runPrune({ keepDays: '30', dryRun: false })

      expect(writeAttestations).toHaveBeenCalledWith(
        '.attest-it/attestations.json',
        [], // Orphaned attestation should be pruned
        'unsigned',
      )
      expect(mockProcessExit).toHaveBeenCalledWith(0)
    })

    it('should respect custom --keep-days option', async () => {
      const config = createMockConfig()
      const attestation = createMockAttestation({
        attestedAt: new Date(Date.now() - 50 * 24 * 60 * 60 * 1000).toISOString(), // 50 days ago
      })
      const file = createMockAttestationsFile([attestation])

      vi.mocked(loadSplitConfig).mockResolvedValue(config)
      vi.mocked(readAttestations).mockResolvedValue(file)
      vi.mocked(computeFingerprint).mockResolvedValue({
        fingerprint: 'sha256:different',
        files: [],
        fileCount: 10,
      })

      // With keepDays=60, the 50-day-old attestation should NOT be pruned
      await runPrune({ keepDays: '60', dryRun: false })

      // Should keep the attestation because it's within 60 days
      expect(writeAttestations).not.toHaveBeenCalled()
      expect(mockProcessExit).toHaveBeenCalledWith(0)
    })

    it('should write updated attestation file after pruning', async () => {
      const config = createMockConfig({
        suites: {
          'stale-suite': {
            packages: ['pkg1'],
          },
          'valid-suite': {
            packages: ['pkg2'],
          },
        },
      })
      const staleAttestation = createMockAttestation({
        suite: 'stale-suite',
        attestedAt: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString(),
      })
      const validAttestation = createMockAttestation({
        suite: 'valid-suite',
        attestedAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(),
      })
      const file = createMockAttestationsFile([staleAttestation, validAttestation])

      vi.mocked(loadSplitConfig).mockResolvedValue(config)
      vi.mocked(readAttestations).mockResolvedValue(file)
      vi.mocked(computeFingerprint).mockImplementation((options) => {
        // Return different fingerprints for different suites
        if (options.packages[0] === 'pkg1') {
          // For stale-suite, return different fingerprint
          return Promise.resolve({
            fingerprint: 'sha256:different',
            files: [],
            fileCount: 10,
          })
        }
        if (options.packages[0] === 'pkg2') {
          // For valid-suite, return matching fingerprint
          return Promise.resolve({
            fingerprint: validAttestation.fingerprint,
            files: [],
            fileCount: 10,
          })
        }
        return Promise.resolve({
          fingerprint: 'sha256:default',
          files: [],
          fileCount: 10,
        })
      })

      await runPrune({ keepDays: '30', dryRun: false })

      expect(writeAttestations).toHaveBeenCalledWith(
        '.attest-it/attestations.json',
        [validAttestation],
        'unsigned',
      )
      expect(mockProcessExit).toHaveBeenCalledWith(0)
    })

    it('should handle errors gracefully', async () => {
      vi.mocked(loadSplitConfig).mockRejectedValue(new Error('Config load failed'))

      await runPrune({ keepDays: '30', dryRun: false })

      expect(mockProcessExit).toHaveBeenCalledWith(3) // CONFIG_ERROR
    })
  })
})
