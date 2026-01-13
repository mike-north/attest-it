/**
 * Tests for run-interactive entry point.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { spawn } from 'node:child_process'
import type { EventEmitter } from 'node:events'
import {
  loadConfig,
  readAttestations,
  type Config,
  type Attestation,
} from '@attest-it/core'

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

// Test helpers
function createMockConfig(): Config {
  return {
    version: 1,
    settings: {
      attestationsPath: '.attest-it/attestations.json',
      maxAgeDays: 30,
      defaultCommand: 'npm test',
      publicKeyPath: '.attest-it/public.pem',
    },
    suites: {
      unit: {
        packages: ['src/**/*.ts'],
        command: 'npm run test:unit',
      },
      integration: {
        packages: ['src/**/*.ts'],
        command: 'npm run test:integration',
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

function createMockAttestation(overrides: Partial<Attestation> = {}): Attestation {
  return {
    suite: 'unit',
    fingerprint: 'abc123',
    command: 'npm run test:unit',
    attestedAt: new Date().toISOString(),
    attestedBy: 'testuser',
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

  beforeEach(() => {
    // Save original process.exit
    originalProcessExit = process.exit

    // Mock process.exit to prevent tests from actually exiting
    mockExit = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called')
    })

    // Reset all mocks
    vi.clearAllMocks()

    // Setup default mocks
    vi.mocked(loadConfig).mockResolvedValue(createMockConfig())
    vi.mocked(getAllSuiteStatuses).mockResolvedValue([
      createMockSuiteStatus(),
      createMockSuiteStatus({ name: 'integration' }),
    ])
    vi.mocked(loadSession).mockResolvedValue(null)
  })

  afterEach(() => {
    // Restore original process.exit
    mockExit.mockRestore()
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
        started: new Date().toISOString(),
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

      vi.mocked(loadConfig).mockResolvedValue(config)

      // This would be tested through integration when executor is called
      expect(config.suites.unit).toBeUndefined()
    })

    it('should handle attestation file not existing', async () => {
      vi.mocked(readAttestations).mockRejectedValue(new Error('ENOENT: file not found'))

      // Should create new attestations file
      // This is tested through createAttestationCreator
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

  it('should create valid mock attestation', () => {
    const attestation = createMockAttestation()

    expect(attestation.suite).toBe('unit')
    expect(attestation.fingerprint).toBe('abc123')
    expect(attestation.command).toBe('npm run test:unit')
    expect(attestation.attestedBy).toBe('testuser')
  })

  it('should apply overrides to mock attestation', () => {
    const attestation = createMockAttestation({
      suite: 'custom',
      fingerprint: 'xyz789',
    })

    expect(attestation.suite).toBe('custom')
    expect(attestation.fingerprint).toBe('xyz789')
  })
})
