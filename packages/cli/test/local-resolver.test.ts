import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as child_process from 'node:child_process'

// Mock all the Node.js modules we use
vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs')
  return {
    ...actual,
    existsSync: vi.fn(),
    realpathSync: vi.fn(),
  }
})

vi.mock('node:child_process', async () => {
  const actual = await vi.importActual<typeof import('node:child_process')>('node:child_process')
  return {
    ...actual,
    spawnSync: vi.fn(),
  }
})

// Type-safe mock functions
const mockExistsSync = vi.mocked(fs.existsSync)
const mockRealpathSync = vi.mocked(fs.realpathSync)
const mockSpawnSync = vi.mocked(child_process.spawnSync)

// Mock process.exit
const mockProcessExit = vi
  .spyOn(process, 'exit')
  .mockImplementation((code?: string | number | null | undefined) => {
    throw new Error(`process.exit called with code ${code ?? 'undefined'}`)
  })

// Mock process.cwd
const originalCwd = process.cwd()
const mockCwd = vi.spyOn(process, 'cwd')

// Import the module under test
const { tryDelegateToLocal } = await import('../src/local-resolver.js')

describe('tryDelegateToLocal', () => {
  beforeEach(() => {
    // Reset all mocks before each test
    vi.clearAllMocks()

    // Reset environment variable
    delete process.env.ATTEST_IT_SKIP_LOCAL_RESOLUTION

    // Default mock implementations
    mockCwd.mockReturnValue(originalCwd)
    mockExistsSync.mockReturnValue(false)
    mockRealpathSync.mockImplementation((p) => String(p))
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('positive cases - no delegation', () => {
    it('should return false when ATTEST_IT_SKIP_LOCAL_RESOLUTION is set', () => {
      process.env.ATTEST_IT_SKIP_LOCAL_RESOLUTION = '1'

      const result = tryDelegateToLocal()

      expect(result).toBe(false)
      expect(mockExistsSync).not.toHaveBeenCalled()
      expect(mockSpawnSync).not.toHaveBeenCalled()
    })

    it('should return false when no local CLI is found', () => {
      mockExistsSync.mockReturnValue(false)

      const result = tryDelegateToLocal()

      expect(result).toBe(false)
      expect(mockExistsSync).toHaveBeenCalled()
      expect(mockSpawnSync).not.toHaveBeenCalled()
    })

    it('should return false when local CLI is the same as current CLI (exact match)', () => {
      const localPath = '/project/node_modules/.bin/attest-it'
      const samePath = '/project/node_modules/@attest-it/cli/dist/bin/attest-it.js'

      mockCwd.mockReturnValue('/project')
      mockExistsSync.mockImplementation((p) => String(p) === localPath)
      mockRealpathSync.mockImplementation(() => samePath)

      const result = tryDelegateToLocal()

      expect(result).toBe(false)
      expect(mockSpawnSync).not.toHaveBeenCalled()
    })

    it('should return false when local CLI is the same as current CLI (same package)', () => {
      const localPath = '/project/node_modules/.bin/attest-it'
      const localRealPath = '/project/node_modules/@attest-it/cli/dist/bin/attest-it.js'
      const currentRealPath = '/project/node_modules/@attest-it/cli/dist/local-resolver.js'

      mockCwd.mockReturnValue('/project')
      mockExistsSync.mockImplementation((p) => String(p) === localPath)
      mockRealpathSync.mockImplementation((p) => {
        if (String(p) === localPath) return localRealPath
        // This simulates the __filename path
        return currentRealPath
      })

      const result = tryDelegateToLocal()

      expect(result).toBe(false)
      expect(mockSpawnSync).not.toHaveBeenCalled()
    })
  })

  describe('negative cases - delegation fails', () => {
    it('should delegate when realpathSync throws an error (treats as different)', () => {
      const localPath = '/project/node_modules/.bin/attest-it'

      mockCwd.mockReturnValue('/project')
      mockExistsSync.mockImplementation((p) => String(p) === localPath)
      mockRealpathSync.mockImplementation(() => {
        throw new Error('ENOENT: no such file')
      })
      mockSpawnSync.mockReturnValue({
        status: 0,
        signal: null,
        error: undefined,
        pid: 1234,
        output: [],
        stdout: null,
        stderr: null,
      })

      // Should not throw from realpathSync because isSameAsCurrentCli catches errors
      // Since realpathSync throws, isSameAsCurrentCli returns false,
      // so delegation should be attempted
      expect(() => tryDelegateToLocal()).toThrow('process.exit called')
      expect(mockSpawnSync).toHaveBeenCalled()
    })

    it('should exit with code 1 when spawnSync returns null status', () => {
      const localPath = '/project/node_modules/.bin/attest-it'

      mockCwd.mockReturnValue('/project')
      mockExistsSync.mockImplementation((p) => String(p) === localPath)
      mockRealpathSync.mockImplementation((p) => {
        if (String(p) === localPath)
          return '/project/node_modules/@attest-it/cli/dist/bin/attest-it.js'
        return '/usr/local/lib/node_modules/@attest-it/cli/dist/local-resolver.js'
      })
      mockSpawnSync.mockReturnValue({
        status: null,
        signal: null,
        error: undefined,
        pid: 1234,
        output: [],
        stdout: null,
        stderr: null,
      })

      expect(() => tryDelegateToLocal()).toThrow('process.exit called with code 1')
      expect(mockProcessExit).toHaveBeenCalledWith(1)
    })
  })

  describe('edge cases', () => {
    it('should search up directory tree until root', () => {
      mockCwd.mockReturnValue('/deep/nested/project/subdirectory')
      mockExistsSync.mockReturnValue(false)

      const result = tryDelegateToLocal()

      expect(result).toBe(false)
      // Should check multiple parent directories
      const calls = mockExistsSync.mock.calls.map((call) => call[0])
      expect(calls.some((p) => String(p).includes('node_modules'))).toBe(true)
    })

    it('should find local CLI in parent directory', () => {
      const localPath = '/project/node_modules/.bin/attest-it'

      mockCwd.mockReturnValue('/project/subdirectory')
      mockExistsSync.mockImplementation((p) => {
        return String(p) === localPath
      })
      mockRealpathSync.mockImplementation((p) => {
        if (String(p) === localPath)
          return '/project/node_modules/@attest-it/cli/dist/bin/attest-it.js'
        return '/global/lib/node_modules/@attest-it/cli/dist/index.js'
      })
      mockSpawnSync.mockReturnValue({
        status: 0,
        signal: null,
        error: undefined,
        pid: 1234,
        output: [],
        stdout: null,
        stderr: null,
      })

      expect(() => tryDelegateToLocal()).toThrow('process.exit called with code 0')
      expect(mockSpawnSync).toHaveBeenCalledWith(
        localPath,
        process.argv.slice(2),
        expect.objectContaining({
          stdio: 'inherit',
          env: expect.objectContaining({
            ATTEST_IT_SKIP_LOCAL_RESOLUTION: '1',
          }),
        }),
      )
    })

    it('should pass through all command-line arguments', () => {
      const localPath = '/project/node_modules/.bin/attest-it'
      const originalArgv = process.argv
      process.argv = ['node', 'attest-it', 'run', '--verbose', 'test.yml']

      mockCwd.mockReturnValue('/project')
      mockExistsSync.mockImplementation((p) => String(p) === localPath)
      mockRealpathSync.mockImplementation((p) => {
        if (String(p) === localPath)
          return '/project/node_modules/@attest-it/cli/dist/bin/attest-it.js'
        return '/usr/local/lib/node_modules/@attest-it/cli/dist/local-resolver.js'
      })
      mockSpawnSync.mockReturnValue({
        status: 0,
        signal: null,
        error: undefined,
        pid: 1234,
        output: [],
        stdout: null,
        stderr: null,
      })

      expect(() => tryDelegateToLocal()).toThrow('process.exit called')
      expect(mockSpawnSync).toHaveBeenCalledWith(
        localPath,
        ['run', '--verbose', 'test.yml'],
        expect.any(Object),
      )

      process.argv = originalArgv
    })

    it('should preserve all environment variables', () => {
      const localPath = '/project/node_modules/.bin/attest-it'
      const originalEnv = { ...process.env }
      process.env.CUSTOM_VAR = 'test-value'

      mockCwd.mockReturnValue('/project')
      mockExistsSync.mockImplementation((p) => String(p) === localPath)
      mockRealpathSync.mockImplementation((p) => {
        if (String(p) === localPath)
          return '/project/node_modules/@attest-it/cli/dist/bin/attest-it.js'
        return '/usr/local/lib/node_modules/@attest-it/cli/dist/local-resolver.js'
      })
      mockSpawnSync.mockReturnValue({
        status: 0,
        signal: null,
        error: undefined,
        pid: 1234,
        output: [],
        stdout: null,
        stderr: null,
      })

      expect(() => tryDelegateToLocal()).toThrow('process.exit called')
      expect(mockSpawnSync).toHaveBeenCalledWith(
        localPath,
        expect.any(Array),
        expect.objectContaining({
          env: expect.objectContaining({
            CUSTOM_VAR: 'test-value',
            ATTEST_IT_SKIP_LOCAL_RESOLUTION: '1',
          }),
        }),
      )

      process.env = originalEnv
    })

    it('should exit with the same status code as delegated process', () => {
      const localPath = '/project/node_modules/.bin/attest-it'

      mockCwd.mockReturnValue('/project')
      mockExistsSync.mockImplementation((p) => String(p) === localPath)
      mockRealpathSync.mockImplementation((p) => {
        if (String(p) === localPath)
          return '/project/node_modules/@attest-it/cli/dist/bin/attest-it.js'
        return '/usr/local/lib/node_modules/@attest-it/cli/dist/local-resolver.js'
      })
      mockSpawnSync.mockReturnValue({
        status: 42,
        signal: null,
        error: undefined,
        pid: 1234,
        output: [],
        stdout: null,
        stderr: null,
      })

      expect(() => tryDelegateToLocal()).toThrow('process.exit called with code 42')
      expect(mockProcessExit).toHaveBeenCalledWith(42)
    })

    it('should use stdio: inherit to preserve output', () => {
      const localPath = '/project/node_modules/.bin/attest-it'

      mockCwd.mockReturnValue('/project')
      mockExistsSync.mockImplementation((p) => String(p) === localPath)
      mockRealpathSync.mockImplementation((p) => {
        if (String(p) === localPath)
          return '/project/node_modules/@attest-it/cli/dist/bin/attest-it.js'
        return '/usr/local/lib/node_modules/@attest-it/cli/dist/local-resolver.js'
      })
      mockSpawnSync.mockReturnValue({
        status: 0,
        signal: null,
        error: undefined,
        pid: 1234,
        output: [],
        stdout: null,
        stderr: null,
      })

      expect(() => tryDelegateToLocal()).toThrow('process.exit called')
      expect(mockSpawnSync).toHaveBeenCalledWith(
        localPath,
        expect.any(Array),
        expect.objectContaining({
          stdio: 'inherit',
        }),
      )
    })
  })

  describe('positive cases - successful delegation', () => {
    it('should delegate to local CLI when found and different', () => {
      const localPath = '/project/node_modules/.bin/attest-it'

      mockCwd.mockReturnValue('/project')
      mockExistsSync.mockReturnValue(true)
      mockRealpathSync.mockImplementation((p) => {
        if (String(p) === localPath)
          return '/project/node_modules/@attest-it/cli/dist/bin/attest-it.js'
        return '/usr/local/lib/node_modules/@attest-it/cli/dist/index.js'
      })
      mockSpawnSync.mockReturnValue({
        status: 0,
        signal: null,
        error: undefined,
        pid: 1234,
        output: [],
        stdout: null,
        stderr: null,
      })

      expect(() => tryDelegateToLocal()).toThrow('process.exit called with code 0')
      expect(mockSpawnSync).toHaveBeenCalledWith(
        localPath,
        process.argv.slice(2),
        expect.objectContaining({
          stdio: 'inherit',
          env: expect.objectContaining({
            ATTEST_IT_SKIP_LOCAL_RESOLUTION: '1',
          }),
        }),
      )
      expect(mockProcessExit).toHaveBeenCalledWith(0)
    })

    it('should set ATTEST_IT_SKIP_LOCAL_RESOLUTION to prevent infinite loops', () => {
      const localPath = '/project/node_modules/.bin/attest-it'

      mockCwd.mockReturnValue('/project')
      mockExistsSync.mockImplementation((p) => String(p) === localPath)
      mockRealpathSync.mockImplementation((p) => {
        if (String(p) === localPath)
          return '/project/node_modules/@attest-it/cli/dist/bin/attest-it.js'
        return '/usr/local/lib/node_modules/@attest-it/cli/dist/local-resolver.js'
      })
      mockSpawnSync.mockReturnValue({
        status: 0,
        signal: null,
        error: undefined,
        pid: 1234,
        output: [],
        stdout: null,
        stderr: null,
      })

      expect(() => tryDelegateToLocal()).toThrow('process.exit called')

      const spawnCall = mockSpawnSync.mock.calls[0]
      expect(spawnCall?.[2]).toBeDefined()
      const env = spawnCall?.[2]?.env as Record<string, string> | undefined
      expect(env?.ATTEST_IT_SKIP_LOCAL_RESOLUTION).toBe('1')
    })
  })
})
