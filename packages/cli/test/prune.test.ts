import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { runPrune } from '../src/commands/prune.js'
import type { AttestItConfig, Seal, SealsFile } from '@attest-it/core'
import { ExitCode } from '../src/utils/exit-codes.js'

// Mock core functions used by the prune command
vi.mock('@attest-it/core', async () => {
  const actual = await vi.importActual<typeof import('@attest-it/core')>('@attest-it/core')
  return {
    ...actual,
    loadSplitConfig: vi.fn(),
    readSealsSync: vi.fn(),
    writeSealsSync: vi.fn(),
  }
})

// Mock output utilities
vi.mock('../src/utils/output.js', () => ({
  log: vi.fn(),
  verbose: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
}))

// Mock process.exit
const mockProcessExit = vi
  .spyOn(process, 'exit')
  // @ts-expect-error - Mocking process.exit which has a complex signature
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  .mockImplementation(() => {})

const { loadSplitConfig, readSealsSync, writeSealsSync } = await import('@attest-it/core')
const { success, error, info, log } = await import('../src/utils/output.js')

const SEALS_PATH = '.attest-it/seals.json'
const FIXED_TIMESTAMP = '2024-01-15T10:30:00.000Z'

/** Build a mock AttestItConfig with one gate ("kept-gate") unless overridden. */
function createMockConfig(overrides?: Partial<AttestItConfig>): AttestItConfig {
  return {
    version: 1,
    settings: {
      maxAgeDays: 30,
      publicKeyPath: '.attest-it/pubkey.pem',
      attestationsPath: '.attest-it/attestations.json',
      sealsPath: SEALS_PATH,
    },
    gates: {
      'kept-gate': {
        name: 'Kept Gate',
        description: 'A gate that still exists',
        authorizedSigners: ['test-user'],
        fingerprint: { paths: ['pkg1'] },
        maxAge: '30d',
      },
    },
    suites: {},
    ...overrides,
  }
}

/** Build a mock Seal for the given gate id. */
function createMockSeal(gateId: string, overrides?: Partial<Seal>): Seal {
  return {
    gateId,
    fingerprint: 'sha256:abc123',
    timestamp: FIXED_TIMESTAMP,
    sealedBy: 'test-user',
    signature: 'mock-signature',
    ...overrides,
  }
}

/** Build a mock SealsFile from a map of gateId -> Seal. */
function createMockSealsFile(seals: Record<string, Seal>): SealsFile {
  return { version: 1, seals }
}

describe('runPrune', () => {
  beforeEach(() => {
    // resetAllMocks (not clearAllMocks) so that a mockImplementation/mockRejectedValue
    // set by one test (e.g. simulating a write failure) can never leak into the next.
    vi.resetAllMocks()
    // resetAllMocks also wipes the process.exit no-op set at module scope, so
    // it must be reapplied every time.
    mockProcessExit.mockImplementation(() => {
      // Intentionally empty - prevent the test process from actually exiting
      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- process.exit has a `never` return type that mockImplementation can't infer
      return undefined as never
    })
  })

  afterEach(() => {
    vi.resetAllMocks()
  })

  describe('positive cases', () => {
    it('should remove a seal whose gate no longer exists in the policy', async () => {
      const config = createMockConfig()
      const keptSeal = createMockSeal('kept-gate')
      const orphanSeal = createMockSeal('removed-gate')
      const sealsFile = createMockSealsFile({
        'kept-gate': keptSeal,
        'removed-gate': orphanSeal,
      })

      vi.mocked(loadSplitConfig).mockResolvedValue(config)
      vi.mocked(readSealsSync).mockReturnValue(sealsFile)

      await runPrune({})

      expect(readSealsSync).toHaveBeenCalledWith(process.cwd(), SEALS_PATH)
      expect(writeSealsSync).toHaveBeenCalledWith(
        process.cwd(),
        { version: 1, seals: { 'kept-gate': keptSeal } },
        SEALS_PATH,
      )
      expect(success).toHaveBeenCalledWith('Pruned 1 orphaned seal(s)')
      expect(log).toHaveBeenCalledWith('Remaining: 1 seal(s)')
      expect(mockProcessExit).toHaveBeenCalledWith(ExitCode.SUCCESS)
    })

    it('should retain a seal whose gate still exists', async () => {
      const config = createMockConfig()
      const keptSeal = createMockSeal('kept-gate')
      const sealsFile = createMockSealsFile({ 'kept-gate': keptSeal })

      vi.mocked(loadSplitConfig).mockResolvedValue(config)
      vi.mocked(readSealsSync).mockReturnValue(sealsFile)

      await runPrune({})

      expect(writeSealsSync).not.toHaveBeenCalled()
      expect(success).toHaveBeenCalledWith('No orphaned seals found')
      expect(mockProcessExit).toHaveBeenCalledWith(ExitCode.SUCCESS)
    })

    it('should remove multiple orphaned seals and keep multiple valid ones', async () => {
      const config = createMockConfig({
        gates: {
          'kept-gate-1': {
            name: 'Kept 1',
            description: 'd',
            authorizedSigners: ['test-user'],
            fingerprint: { paths: ['pkg1'] },
            maxAge: '30d',
          },
          'kept-gate-2': {
            name: 'Kept 2',
            description: 'd',
            authorizedSigners: ['test-user'],
            fingerprint: { paths: ['pkg2'] },
            maxAge: '30d',
          },
        },
      })
      const kept1 = createMockSeal('kept-gate-1')
      const kept2 = createMockSeal('kept-gate-2')
      const orphan1 = createMockSeal('removed-gate-1')
      const orphan2 = createMockSeal('removed-gate-2')
      const sealsFile = createMockSealsFile({
        'kept-gate-1': kept1,
        'kept-gate-2': kept2,
        'removed-gate-1': orphan1,
        'removed-gate-2': orphan2,
      })

      vi.mocked(loadSplitConfig).mockResolvedValue(config)
      vi.mocked(readSealsSync).mockReturnValue(sealsFile)

      await runPrune({})

      expect(writeSealsSync).toHaveBeenCalledWith(
        process.cwd(),
        { version: 1, seals: { 'kept-gate-1': kept1, 'kept-gate-2': kept2 } },
        SEALS_PATH,
      )
      expect(success).toHaveBeenCalledWith('Pruned 2 orphaned seal(s)')
      expect(log).toHaveBeenCalledWith('Remaining: 2 seal(s)')
      expect(mockProcessExit).toHaveBeenCalledWith(ExitCode.SUCCESS)
    })
  })

  describe('negative cases', () => {
    it('should not write when --dry-run is passed, even with orphaned seals', async () => {
      const config = createMockConfig()
      const orphanSeal = createMockSeal('removed-gate')
      const sealsFile = createMockSealsFile({ 'removed-gate': orphanSeal })

      vi.mocked(loadSplitConfig).mockResolvedValue(config)
      vi.mocked(readSealsSync).mockReturnValue(sealsFile)

      await runPrune({ dryRun: true })

      expect(writeSealsSync).not.toHaveBeenCalled()
      expect(info).toHaveBeenCalledWith('Dry run - no changes made')
      expect(mockProcessExit).toHaveBeenCalledWith(ExitCode.SUCCESS)
    })

    it('should report every seal as orphaned when the config has no gates at all', async () => {
      const config = createMockConfig({ gates: undefined })
      const seal = createMockSeal('kept-gate')
      const sealsFile = createMockSealsFile({ 'kept-gate': seal })

      vi.mocked(loadSplitConfig).mockResolvedValue(config)
      vi.mocked(readSealsSync).mockReturnValue(sealsFile)

      await runPrune({})

      expect(writeSealsSync).toHaveBeenCalledWith(
        process.cwd(),
        { version: 1, seals: {} },
        SEALS_PATH,
      )
      expect(success).toHaveBeenCalledWith('Pruned 1 orphaned seal(s)')
      expect(mockProcessExit).toHaveBeenCalledWith(ExitCode.SUCCESS)
    })

    it('should exit with CONFIG_ERROR when loading the split config fails', async () => {
      vi.mocked(loadSplitConfig).mockRejectedValue(new Error('Config load failed'))

      await runPrune({})

      expect(readSealsSync).not.toHaveBeenCalled()
      expect(error).toHaveBeenCalledWith('Config load failed')
      expect(mockProcessExit).toHaveBeenCalledWith(ExitCode.CONFIG_ERROR)
    })

    it('should exit with CONFIG_ERROR when reading the seals file throws', async () => {
      const config = createMockConfig()
      vi.mocked(loadSplitConfig).mockResolvedValue(config)
      vi.mocked(readSealsSync).mockImplementation(() => {
        throw new Error('Failed to read seals file: Invalid JSON')
      })

      await runPrune({})

      expect(writeSealsSync).not.toHaveBeenCalled()
      expect(error).toHaveBeenCalledWith('Failed to read seals file: Invalid JSON')
      expect(mockProcessExit).toHaveBeenCalledWith(ExitCode.CONFIG_ERROR)
    })

    it('should exit with CONFIG_ERROR when writing the seals file throws', async () => {
      const config = createMockConfig()
      const orphanSeal = createMockSeal('removed-gate')
      const sealsFile = createMockSealsFile({ 'removed-gate': orphanSeal })

      vi.mocked(loadSplitConfig).mockResolvedValue(config)
      vi.mocked(readSealsSync).mockReturnValue(sealsFile)
      vi.mocked(writeSealsSync).mockImplementation(() => {
        throw new Error('Failed to write seals file: disk full')
      })

      await runPrune({})

      expect(error).toHaveBeenCalledWith('Failed to write seals file: disk full')
      expect(mockProcessExit).toHaveBeenCalledWith(ExitCode.CONFIG_ERROR)
    })

    it('should exit with CONFIG_ERROR and a generic message for non-Error throwables', async () => {
      vi.mocked(loadSplitConfig).mockRejectedValue('string error')

      await runPrune({})

      expect(error).toHaveBeenCalledWith('Unknown error occurred')
      expect(mockProcessExit).toHaveBeenCalledWith(ExitCode.CONFIG_ERROR)
    })
  })

  describe('edge cases', () => {
    it('should report "No seals to prune" for an empty seals file', async () => {
      const config = createMockConfig()
      const sealsFile = createMockSealsFile({})

      vi.mocked(loadSplitConfig).mockResolvedValue(config)
      vi.mocked(readSealsSync).mockReturnValue(sealsFile)

      await runPrune({})

      expect(writeSealsSync).not.toHaveBeenCalled()
      expect(info).toHaveBeenCalledWith('No seals to prune')
      expect(mockProcessExit).toHaveBeenCalledWith(ExitCode.SUCCESS)
    })

    it('should read and write using a custom sealsPath from settings', async () => {
      const customSealsPath = 'custom/location/seals.yaml'
      const config = createMockConfig({
        settings: {
          maxAgeDays: 30,
          publicKeyPath: '.attest-it/pubkey.pem',
          attestationsPath: '.attest-it/attestations.json',
          sealsPath: customSealsPath,
        },
      })
      const orphanSeal = createMockSeal('removed-gate')
      const sealsFile = createMockSealsFile({ 'removed-gate': orphanSeal })

      vi.mocked(loadSplitConfig).mockResolvedValue(config)
      vi.mocked(readSealsSync).mockReturnValue(sealsFile)

      await runPrune({})

      expect(readSealsSync).toHaveBeenCalledWith(process.cwd(), customSealsPath)
      expect(writeSealsSync).toHaveBeenCalledWith(
        process.cwd(),
        { version: 1, seals: {} },
        customSealsPath,
      )
      expect(mockProcessExit).toHaveBeenCalledWith(ExitCode.SUCCESS)
    })
  })
})
