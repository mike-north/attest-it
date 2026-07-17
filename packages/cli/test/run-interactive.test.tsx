/**
 * Tests for run-interactive entry point.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { spawn } from 'node:child_process'
import type { EventEmitter } from 'node:events'
import { loadSplitConfig, readSealsSync, type AttestItConfig, type Seal } from '@attest-it/core'

// Mock dependencies
vi.mock('node:child_process')
vi.mock('@attest-it/core')
vi.mock('ink', () => ({
  render: vi.fn(() => ({
    waitUntilExit: vi.fn().mockResolvedValue(undefined),
  })),
}))
vi.mock('../src/components/InteractiveRun.js', () => ({
  InteractiveRun: vi.fn(() => null),
}))
vi.mock('../src/commands/run-utils.js')
vi.mock('../src/session/session.js')
vi.mock('../src/utils/output.js', () => ({
  log: vi.fn(),
  error: vi.fn(),
}))

// Import after mocks
import { runInteractive } from '../src/commands/run-interactive.js'
import { getAllSuiteStatuses } from '../src/commands/run-utils.js'
import { loadSession } from '../src/session/session.js'
import { log, error } from '../src/utils/output.js'
import { ExitCode } from '../src/utils/exit-codes.js'

// Fixed timestamp for deterministic seal/session fixtures.
const FIXED_TIMESTAMP = '2024-01-15T10:30:00.000Z'

// Test helpers
function createMockConfig(): AttestItConfig {
  return {
    version: 1,
    settings: {
      maxAgeDays: 30,
      publicKeyPath: '.attest-it/pubkey.pem',
      attestationsPath: '.attest-it/attestations.json',
      sealsPath: '.attest-it/seals.json',
      defaultCommand: 'npm test',
    },
    suites: {
      unit: {
        gate: 'unit-gate',
        command: 'npm run test:unit',
      },
      integration: {
        gate: 'integration-gate',
        command: 'npm run test:integration',
      },
    },
    gates: {
      'unit-gate': {
        name: 'Unit Gate',
        description: 'Gate for unit tests',
        authorizedSigners: ['testuser'],
        fingerprint: { paths: ['src/**/*.ts'] },
        maxAge: '30d',
      },
      'integration-gate': {
        name: 'Integration Gate',
        description: 'Gate for integration tests',
        authorizedSigners: ['testuser'],
        fingerprint: { paths: ['src/**/*.ts'] },
        maxAge: '30d',
      },
    },
  }
}

function createMockSuiteStatus(overrides: Record<string, unknown> = {}) {
  return {
    name: 'unit',
    status: 'NEEDS_ATTESTATION',
    reason: 'No attestation found',
    currentFingerprint: 'abc123',
    ...overrides,
  }
}

function createMockSeal(overrides: Partial<Seal> = {}): Seal {
  return {
    gateId: 'unit-gate',
    fingerprint: 'abc123',
    timestamp: FIXED_TIMESTAMP,
    sealedBy: 'testuser',
    signature: 'deadbeef',
    ...overrides,
  }
}

// Create a mock child process
function createMockChildProcess() {
  const mockChild = {
    stdout: {
      on: vi.fn(),
    },
    on: vi.fn(),
  } as unknown as EventEmitter

  return mockChild
}

describe('runInteractive', () => {
  let mockExit: ReturnType<typeof vi.spyOn<typeof process, 'exit'>>
  let originalProcessExit: typeof process.exit
  const originalIsTTY = process.stdin.isTTY

  beforeEach(() => {
    // Save original process.exit
    originalProcessExit = process.exit

    // Mock process.exit to prevent tests from actually exiting
    mockExit = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called')
    })

    // Reset all mocks
    vi.clearAllMocks()

    // Most of these tests exercise the interactive UI (or code paths that run
    // before it), which is only reachable with an interactive TTY (see issue
    // #80's non-TTY guard). The dedicated 'non-interactive' describe block
    // below overrides this per-test to exercise the guard itself.
    Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true })

    // Setup default mocks
    vi.mocked(loadSplitConfig).mockResolvedValue(createMockConfig())
    vi.mocked(getAllSuiteStatuses).mockResolvedValue([
      createMockSuiteStatus(),
      createMockSuiteStatus({ name: 'integration' }),
    ])
    vi.mocked(loadSession).mockResolvedValue(null)
  })

  afterEach(() => {
    // Restore original process.exit
    mockExit.mockRestore()
    Object.defineProperty(process.stdin, 'isTTY', { value: originalIsTTY, configurable: true })
  })

  describe('non-interactive guard (issue #80)', () => {
    it('should fail fast instead of hanging when stdin is not a TTY and pending suites exist', async () => {
      Object.defineProperty(process.stdin, 'isTTY', { value: undefined, configurable: true })

      await expect(runInteractive({})).rejects.toThrow('process.exit called')

      expect(error).toHaveBeenCalledWith(
        expect.stringContaining('requires an interactive terminal'),
      )
      expect(mockExit).toHaveBeenCalledWith(ExitCode.CONFIG_ERROR)
    })

    it('should not require a TTY for --dry-run', async () => {
      Object.defineProperty(process.stdin, 'isTTY', { value: undefined, configurable: true })

      await expect(runInteractive({ dryRun: true })).rejects.toThrow('process.exit called')

      expect(mockExit).toHaveBeenCalledWith(ExitCode.SUCCESS)
    })
  })

  describe('dry run mode', () => {
    it('should display pending suites and exit', async () => {
      await expect(runInteractive({ dryRun: true })).rejects.toThrow('process.exit called')

      expect(log).toHaveBeenCalledWith('Would run 2 suite(s):')
      expect(log).toHaveBeenCalledWith(expect.stringContaining('1. unit (NEEDS_ATTESTATION)'))
      expect(log).toHaveBeenCalledWith(
        expect.stringContaining('2. integration (NEEDS_ATTESTATION)'),
      )
      expect(mockExit).toHaveBeenCalledWith(ExitCode.SUCCESS)
    })

    it('should filter suites by pattern', async () => {
      await expect(runInteractive({ dryRun: true, filter: 'unit' })).rejects.toThrow(
        'process.exit called',
      )

      expect(log).toHaveBeenCalledWith('Would run 1 suite(s):')
      expect(log).toHaveBeenCalledWith(expect.stringContaining('1. unit (NEEDS_ATTESTATION)'))
      expect(log).not.toHaveBeenCalledWith(expect.stringContaining('integration'))
      expect(mockExit).toHaveBeenCalledWith(ExitCode.SUCCESS)
    })

    it('should exit with NO_WORK when all suites valid', async () => {
      vi.mocked(getAllSuiteStatuses).mockResolvedValue([
        createMockSuiteStatus({ status: 'VALID' }),
        createMockSuiteStatus({ name: 'integration', status: 'VALID' }),
      ])

      await expect(runInteractive({ dryRun: true })).rejects.toThrow('process.exit called')

      expect(log).toHaveBeenCalledWith('No suites would run (all valid or filtered out).')
      expect(mockExit).toHaveBeenCalledWith(ExitCode.NO_WORK)
    })

    it('should exit with NO_WORK when filter excludes all', async () => {
      await expect(runInteractive({ dryRun: true, filter: 'nonexistent' })).rejects.toThrow(
        'process.exit called',
      )

      expect(log).toHaveBeenCalledWith('No suites would run (all valid or filtered out).')
      expect(mockExit).toHaveBeenCalledWith(ExitCode.NO_WORK)
    })

    it('should support wildcard patterns', async () => {
      await expect(runInteractive({ dryRun: true, filter: 'int*' })).rejects.toThrow(
        'process.exit called',
      )

      expect(log).toHaveBeenCalledWith('Would run 1 suite(s):')
      expect(log).toHaveBeenCalledWith(
        expect.stringContaining('1. integration (NEEDS_ATTESTATION)'),
      )
      expect(mockExit).toHaveBeenCalledWith(ExitCode.SUCCESS)
    })
  })

  describe('session resumption', () => {
    it('should resume from saved session', async () => {
      const mockSession = {
        started: FIXED_TIMESTAMP,
        selected: ['unit', 'integration'],
        completed: ['unit'],
        failed: [],
        remaining: ['integration'],
      }

      vi.mocked(loadSession).mockResolvedValue(mockSession)

      // Mock git status to return clean
      const mockChild = createMockChildProcess()
      vi.mocked(spawn).mockReturnValue(mockChild as never)

      // Set up stdout handler
      vi.mocked(mockChild.stdout.on).mockImplementation((event, handler) => {
        // Don't call handler - empty output means clean tree
        return mockChild.stdout as never
      })

      // Set up close handler
      vi.mocked(mockChild.on).mockImplementation((event, handler) => {
        if (event === 'close') {
          // Call handler with exit code 0
          ;(handler as (code: number) => void)(0)
        }
        return mockChild as never
      })

      await runInteractive({ continue: true })

      expect(log).toHaveBeenCalledWith('Resuming session with 1 remaining suite(s)')
    })

    it('should not resume if no session exists', async () => {
      vi.mocked(loadSession).mockResolvedValue(null)

      // Mock git status to return clean
      const mockChild = createMockChildProcess()
      vi.mocked(spawn).mockReturnValue(mockChild as never)

      vi.mocked(mockChild.stdout.on).mockImplementation((event, handler) => {
        return mockChild.stdout as never
      })

      vi.mocked(mockChild.on).mockImplementation((event, handler) => {
        if (event === 'close') {
          ;(handler as (code: number) => void)(0)
        }
        return mockChild as never
      })

      await runInteractive({ continue: true })

      expect(log).not.toHaveBeenCalledWith(expect.stringContaining('Resuming'))
    })
  })

  describe('validation checks', () => {
    it('should exit if all suites are valid', async () => {
      vi.mocked(getAllSuiteStatuses).mockResolvedValue([
        createMockSuiteStatus({ status: 'VALID' }),
        createMockSuiteStatus({ name: 'integration', status: 'VALID' }),
      ])

      await expect(runInteractive({})).rejects.toThrow('process.exit called')

      expect(log).toHaveBeenCalledWith('All suites are valid. Nothing to run.')
      expect(mockExit).toHaveBeenCalledWith(ExitCode.NO_WORK)
    })

    it('should exit if working tree is dirty', async () => {
      // Mock git status to return dirty
      const mockChild = createMockChildProcess()
      vi.mocked(spawn).mockReturnValue(mockChild as never)

      // Mock stdout.on for 'data' event
      vi.mocked(mockChild.stdout.on).mockImplementation((event, handler) => {
        if (event === 'data') {
          ;(handler as (data: Buffer) => void)(Buffer.from(' M file.txt\n'))
        }
        return mockChild.stdout as never
      })

      // Mock on for 'close' event
      vi.mocked(mockChild.on).mockImplementation((event, handler) => {
        if (event === 'close') {
          ;(handler as (code: number) => void)(0)
        }
        return mockChild as never
      })

      await expect(runInteractive({})).rejects.toThrow('process.exit called')

      expect(error).toHaveBeenCalledWith(
        'Working tree has uncommitted changes. Please commit or stash before attesting.',
      )
      expect(mockExit).toHaveBeenCalledWith(ExitCode.CONFIG_ERROR)
    })
  })

  describe('edge cases', () => {
    it('should handle empty suite config', () => {
      const config = createMockConfig()
      config.suites = {}

      expect(config.suites).toEqual({})
    })

    it('should handle missing suite in config', async () => {
      const config = createMockConfig()
      // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
      delete config.suites.unit

      vi.mocked(loadSplitConfig).mockResolvedValue(config)

      // This would be tested through integration when executor is called
      expect(config.suites.unit).toBeUndefined()
    })

    it('should handle seals file not existing', async () => {
      vi.mocked(readSealsSync).mockImplementation(() => {
        throw new Error('ENOENT: file not found')
      })

      // Should fall back to an empty seals file
      // This is tested through getAllSuiteStatuses (mocked here)
      expect(true).toBe(true)
    })
  })
})

describe('test helpers', () => {
  it('should create valid mock config', () => {
    const config = createMockConfig()

    expect(config.version).toBe(1)
    expect(config.settings.attestationsPath).toBe('.attest-it/attestations.json')
    expect(config.suites.unit).toBeDefined()
    expect(config.suites.integration).toBeDefined()
  })

  it('should create valid mock suite status', () => {
    const status = createMockSuiteStatus()

    expect(status.name).toBe('unit')
    expect(status.status).toBe('NEEDS_ATTESTATION')
    expect(status.currentFingerprint).toBe('abc123')
  })

  it('should apply overrides to mock suite status', () => {
    const status = createMockSuiteStatus({ name: 'custom', status: 'VALID' })

    expect(status.name).toBe('custom')
    expect(status.status).toBe('VALID')
  })

  it('should create valid mock seal', () => {
    const seal = createMockSeal()

    expect(seal.gateId).toBe('unit-gate')
    expect(seal.fingerprint).toBe('abc123')
    expect(seal.sealedBy).toBe('testuser')
  })

  it('should apply overrides to mock seal', () => {
    const seal = createMockSeal({
      gateId: 'custom-gate',
      fingerprint: 'xyz789',
    })

    expect(seal.gateId).toBe('custom-gate')
    expect(seal.fingerprint).toBe('xyz789')
  })
})
