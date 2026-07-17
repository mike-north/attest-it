import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  buildCommand,
  parseCommand,
  executeCommand,
  checkDirtyWorkingTree,
  resolveKeyPassphrase,
} from '../src/commands/run.js'
import type { Config } from '@attest-it/core'
import type { ChildProcess } from 'node:child_process'

// Mock child_process
vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}))

// Mock core functions
vi.mock('@attest-it/core', async () => {
  const actual = await vi.importActual<typeof import('@attest-it/core')>('@attest-it/core')
  return {
    ...actual,
    loadConfig: vi.fn(),
    computeFingerprint: vi.fn(),
    readAttestations: vi.fn(),
    writeAttestations: vi.fn(),
    upsertAttestation: vi.fn(),
    createAttestation: vi.fn(),
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

// Mock prompts
vi.mock('../src/utils/prompts.js', () => ({
  confirmAction: vi.fn(),
  isInteractiveTTY: vi.fn(() => false),
}))

// Mock @inquirer/prompts' password() -- used to prompt for an encrypted
// identity key's passphrase interactively (issue #80)
vi.mock('@inquirer/prompts', () => ({
  password: vi.fn(),
}))

// Mock os module
vi.mock('node:os', () => ({
  userInfo: vi.fn(() => ({ username: 'test-user' })),
}))

const { spawn } = await import('node:child_process')
const { isInteractiveTTY } = await import('../src/utils/prompts.js')
const { password } = await import('@inquirer/prompts')

describe('resolveKeyPassphrase', () => {
  const PASSPHRASE_ENV = 'ATTEST_IT_KEY_PASSPHRASE'
  const originalEnvValue = process.env[PASSPHRASE_ENV]

  beforeEach(() => {
    vi.clearAllMocks()
    delete process.env.ATTEST_IT_KEY_PASSPHRASE
  })

  afterEach(() => {
    if (originalEnvValue === undefined) {
      delete process.env.ATTEST_IT_KEY_PASSPHRASE
    } else {
      process.env[PASSPHRASE_ENV] = originalEnvValue
    }
  })

  it('should resolve from the ATTEST_IT_KEY_PASSPHRASE env var without prompting', async () => {
    process.env[PASSPHRASE_ENV] = 'env-passphrase'

    const result = await resolveKeyPassphrase()

    expect(result).toBe('env-passphrase')
    expect(password).not.toHaveBeenCalled()
  })

  it('should prompt interactively when the env var is unset and stdin is a TTY', async () => {
    vi.mocked(isInteractiveTTY).mockReturnValue(true)
    vi.mocked(password).mockResolvedValue('prompted-passphrase')

    const result = await resolveKeyPassphrase()

    expect(result).toBe('prompted-passphrase')
    expect(password).toHaveBeenCalledTimes(1)
  })

  it('should fail fast naming the env var when unset and stdin is not a TTY (never hangs)', async () => {
    vi.mocked(isInteractiveTTY).mockReturnValue(false)

    await expect(resolveKeyPassphrase()).rejects.toThrow(PASSPHRASE_ENV)
    expect(password).not.toHaveBeenCalled()
  })

  it('should treat an empty env var the same as unset', async () => {
    process.env[PASSPHRASE_ENV] = ''
    vi.mocked(isInteractiveTTY).mockReturnValue(false)

    await expect(resolveKeyPassphrase()).rejects.toThrow(PASSPHRASE_ENV)
  })

  it('should reject an empty passphrase at the interactive prompt instead of accepting it', async () => {
    // Regression test: an empty passphrase previously passed through
    // resolveKeyPassphrase() unchecked, then caused ed25519 signing to fail
    // with a cryptic OpenSSL decrypt error instead of a clear message.
    vi.mocked(isInteractiveTTY).mockReturnValue(true)
    vi.mocked(password).mockResolvedValue('prompted-passphrase')

    await resolveKeyPassphrase()

    const call = vi.mocked(password).mock.calls[0]
    expect(call).toBeDefined()
    const { validate } = call?.[0] ?? {}
    expect(validate).toBeDefined()
    expect(validate?.('')).toBe('Passphrase cannot be empty')
    expect(validate?.('non-empty')).toBe(true)
  })
})

describe('buildCommand', () => {
  // Helper to create a mock config
  function createMockConfig(overrides?: Partial<Config>): Config {
    return {
      version: 1,
      settings: {
        maxAgeDays: 30,
        publicKeyPath: '.attest-it/pubkey.pem',
        attestationsPath: '.attest-it/attestations.json',
        algorithm: 'ed25519',
        defaultCommand: 'npm test',
        ...overrides?.settings,
      },
      suites: {
        'test-suite': {
          packages: ['pkg1'],
          ...overrides?.suites?.['test-suite'],
        },
      },
    }
  }

  describe('positive cases', () => {
    it('should use suite command when specified', () => {
      const config = createMockConfig()

      const result = buildCommand(config, 'npm run test:unit')

      expect(result).toBe('npm run test:unit')
    })

    it('should fall back to defaultCommand when suite command not specified', () => {
      const config = createMockConfig()

      const result = buildCommand(config)

      expect(result).toBe('npm test')
    })

    it('should substitute ${files} with suite.files', () => {
      const config = createMockConfig()

      const result = buildCommand(config, 'jest ${files}', ['src/file1.ts', 'src/file2.ts'])

      expect(result).toBe('jest src/file1.ts src/file2.ts')
    })

    it('should handle multiple ${files} substitutions', () => {
      const config = createMockConfig()

      const result = buildCommand(config, 'coverage ${files} --output ${files}.coverage', [
        'test.ts',
      ])

      expect(result).toBe('coverage test.ts --output test.ts.coverage')
    })
  })

  describe('negative cases', () => {
    it('should exit with error if no command available', () => {
      const mockProcessExit = vi.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('process.exit called')
      })
      const config = createMockConfig()
      // Remove defaultCommand from settings
      delete config.settings.defaultCommand

      expect(() => buildCommand(config)).toThrow('process.exit called')
      expect(mockProcessExit).toHaveBeenCalledWith(3) // CONFIG_ERROR
      mockProcessExit.mockRestore()
    })
  })

  describe('edge cases', () => {
    it('should leave ${files} unchanged when suite.files is undefined', () => {
      const config = createMockConfig()

      const result = buildCommand(config, 'jest ${files}')

      expect(result).toBe('jest ${files}')
    })

    it('should handle empty files array', () => {
      const config = createMockConfig()

      const result = buildCommand(config, 'jest ${files}', [])

      expect(result).toBe('jest ')
    })

    it('should handle command with no ${files} placeholder', () => {
      const config = createMockConfig()

      const result = buildCommand(config, 'npm test', ['test.ts'])

      expect(result).toBe('npm test')
    })
  })
})

describe('parseCommand', () => {
  describe('positive cases', () => {
    it('should parse simple command with no arguments', () => {
      const result = parseCommand('echo')

      expect(result).toEqual({
        executable: 'echo',
        args: [],
      })
    })

    it('should parse command with space-separated arguments', () => {
      const result = parseCommand('npm run test')

      expect(result).toEqual({
        executable: 'npm',
        args: ['run', 'test'],
      })
    })

    it('should handle single-quoted arguments with spaces', () => {
      const result = parseCommand("echo 'hello world'")

      expect(result).toEqual({
        executable: 'echo',
        args: ['hello world'],
      })
    })

    it('should handle double-quoted arguments with spaces', () => {
      const result = parseCommand('echo "hello world"')

      expect(result).toEqual({
        executable: 'echo',
        args: ['hello world'],
      })
    })

    it('should handle mixed quoted and unquoted arguments', () => {
      const result = parseCommand('jest "test file.ts" --coverage')

      expect(result).toEqual({
        executable: 'jest',
        args: ['test file.ts', '--coverage'],
      })
    })

    it('should handle paths with spaces in quotes', () => {
      const result = parseCommand('node "/path/to/my script.js"')

      expect(result).toEqual({
        executable: 'node',
        args: ['/path/to/my script.js'],
      })
    })

    it('should handle escaped spaces', () => {
      const result = parseCommand('echo hello\\ world')

      expect(result).toEqual({
        executable: 'echo',
        args: ['hello world'],
      })
    })

    it('should handle multiple arguments with various quoting styles', () => {
      const result = parseCommand(
        'vitest \'src/test.ts\' --config="vitest.config.ts" --reporter json',
      )

      expect(result).toEqual({
        executable: 'vitest',
        args: ['src/test.ts', '--config=vitest.config.ts', '--reporter', 'json'],
      })
    })
  })

  describe('negative cases', () => {
    it('should throw error for empty string', () => {
      expect(() => parseCommand('')).toThrow(
        'Command string is empty or contains only control operators',
      )
    })

    it('should throw error for whitespace-only string', () => {
      expect(() => parseCommand('   ')).toThrow(
        'Command string is empty or contains only control operators',
      )
    })
  })

  describe('edge cases', () => {
    it('should handle command with leading/trailing whitespace', () => {
      const result = parseCommand('  npm test  ')

      expect(result).toEqual({
        executable: 'npm',
        args: ['test'],
      })
    })

    it('should handle command with tabs', () => {
      const result = parseCommand('npm\trun\ttest')

      expect(result).toEqual({
        executable: 'npm',
        args: ['run', 'test'],
      })
    })

    it('should handle empty quotes', () => {
      const result = parseCommand('echo ""')

      expect(result).toEqual({
        executable: 'echo',
        args: [''],
      })
    })

    it('should handle command with environment variable syntax', () => {
      // Note: shell-quote expands env vars. If $SOME_TEST_VAR is not defined, it becomes empty string
      const result = parseCommand('echo $SOME_UNDEFINED_VAR')

      expect(result).toEqual({
        executable: 'echo',
        args: [''],
      })
    })

    it('should preserve literal dollar signs when escaped', () => {
      const result = parseCommand('echo \\$HOME')

      expect(result).toEqual({
        executable: 'echo',
        args: ['$HOME'],
      })
    })
  })
})

describe('executeCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Helper to create a mock child process
  function createMockChildProcess(
    handlers: {
      onClose?: (callback: (code: number | null) => void) => void
      onError?: (callback: (err: Error) => void) => void
    } = {},
  ): ChildProcess {
    type CallbackType = ((code: number | null) => void) | ((err: Error) => void)
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- Test helper needs to create partial mock
    return {
      on: vi.fn((event: string, callback: CallbackType) => {
        if (event === 'close' && handlers.onClose) {
          // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- Type narrowing for callback
          handlers.onClose(callback as (code: number | null) => void)
        }
        if (event === 'error' && handlers.onError) {
          // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- Type narrowing for callback
          handlers.onError(callback as (err: Error) => void)
        }
      }),
      stdout: { on: vi.fn() },
      stderr: { on: vi.fn() },
    } as unknown as ChildProcess
  }

  describe('positive cases', () => {
    it('should return 0 exit code on success', async () => {
      const mockChild = createMockChildProcess({
        onClose: (callback) => {
          setTimeout(() => {
            callback(0)
          }, 0)
        },
      })

      vi.mocked(spawn).mockReturnValue(mockChild)

      const result = await executeCommand('echo test')

      expect(result).toBe(0)
      expect(spawn).toHaveBeenCalledWith('echo', ['test'], {
        stdio: 'inherit',
      })
    })

    it('should handle commands with quoted arguments containing spaces', async () => {
      const mockChild = createMockChildProcess({
        onClose: (callback) => {
          setTimeout(() => {
            callback(0)
          }, 0)
        },
      })

      vi.mocked(spawn).mockReturnValue(mockChild)

      const result = await executeCommand('node "my script.js"')

      expect(result).toBe(0)
      expect(spawn).toHaveBeenCalledWith('node', ['my script.js'], {
        stdio: 'inherit',
      })
    })

    it('should handle complex commands with multiple arguments', async () => {
      const mockChild = createMockChildProcess({
        onClose: (callback) => {
          setTimeout(() => {
            callback(0)
          }, 0)
        },
      })

      vi.mocked(spawn).mockReturnValue(mockChild)

      const result = await executeCommand('npm run test -- --coverage')

      expect(result).toBe(0)
      expect(spawn).toHaveBeenCalledWith('npm', ['run', 'test', '--', '--coverage'], {
        stdio: 'inherit',
      })
    })
  })

  describe('negative cases', () => {
    it('should return non-zero exit code on command failure', async () => {
      const mockChild = createMockChildProcess({
        onClose: (callback) => {
          setTimeout(() => {
            callback(1)
          }, 0)
        },
      })

      vi.mocked(spawn).mockReturnValue(mockChild)

      const result = await executeCommand('false')

      expect(result).toBe(1)
    })

    it('should return 1 on spawn error', async () => {
      const mockChild = createMockChildProcess({
        onError: (callback) => {
          setTimeout(() => {
            callback(new Error('Command not found'))
          }, 0)
        },
      })

      vi.mocked(spawn).mockReturnValue(mockChild)

      const result = await executeCommand('nonexistent-command')

      expect(result).toBe(1)
    })

    it('should return 1 when command parsing fails (empty string)', async () => {
      const result = await executeCommand('')

      expect(result).toBe(1)
      // spawn should never be called if parsing fails
      expect(spawn).not.toHaveBeenCalled()
    })

    it('should return 1 when command parsing fails (whitespace only)', async () => {
      const result = await executeCommand('   ')

      expect(result).toBe(1)
      expect(spawn).not.toHaveBeenCalled()
    })
  })

  describe('edge cases', () => {
    it('should return 1 when close event returns null code', async () => {
      const mockChild = createMockChildProcess({
        onClose: (callback) => {
          setTimeout(() => {
            callback(null)
          }, 0)
        },
      })

      vi.mocked(spawn).mockReturnValue(mockChild)

      const result = await executeCommand('test')

      expect(result).toBe(1)
    })
  })
})

describe('checkDirtyWorkingTree', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Helper to create mock child process with stdout
  function createMockGitProcess(
    handlers: {
      onData?: (callback: (data: Buffer) => void) => void
      onClose?: (callback: () => void) => void
      onError?: (callback: (err: Error) => void) => void
    } = {},
  ): ChildProcess {
    type CloseOrErrorCallback = (() => void) | ((err: Error) => void)
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- Test helper needs to create partial mock
    return {
      stdout: {
        on: vi.fn((event: string, callback: (data: Buffer) => void) => {
          if (event === 'data' && handlers.onData) {
            handlers.onData(callback)
          }
        }),
      },
      on: vi.fn((event: string, callback: CloseOrErrorCallback) => {
        if (event === 'close' && handlers.onClose) {
          // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- Type narrowing for callback
          handlers.onClose(callback as () => void)
        }
        if (event === 'error' && handlers.onError) {
          // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- Type narrowing for callback
          handlers.onError(callback as (err: Error) => void)
        }
      }),
    } as unknown as ChildProcess
  }

  describe('positive cases', () => {
    it('should return true when git status shows changes', async () => {
      const mockChild = createMockGitProcess({
        onData: (callback) => {
          setTimeout(() => {
            callback(Buffer.from(' M file.ts\n'))
          }, 0)
        },
        onClose: (callback) => {
          setTimeout(() => {
            callback()
          }, 0)
        },
      })

      vi.mocked(spawn).mockReturnValue(mockChild)

      const result = await checkDirtyWorkingTree()

      expect(result).toBe(true)
      expect(spawn).toHaveBeenCalledWith('git', ['status', '--porcelain'], {
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    })

    it('should return false when git status is clean', async () => {
      const mockChild = createMockGitProcess({
        onData: (callback) => {
          setTimeout(() => {
            callback(Buffer.from(''))
          }, 0)
        },
        onClose: (callback) => {
          setTimeout(() => {
            callback()
          }, 0)
        },
      })

      vi.mocked(spawn).mockReturnValue(mockChild)

      const result = await checkDirtyWorkingTree()

      expect(result).toBe(false)
    })
  })

  describe('edge cases', () => {
    it('should return false when git is not available', async () => {
      const mockChild = createMockGitProcess({
        onError: (callback) => {
          setTimeout(() => {
            callback(new Error('git not found'))
          }, 0)
        },
      })

      vi.mocked(spawn).mockReturnValue(mockChild)

      const result = await checkDirtyWorkingTree()

      expect(result).toBe(false)
    })

    it('should return false when git status returns only whitespace', async () => {
      const mockChild = createMockGitProcess({
        onData: (callback) => {
          setTimeout(() => {
            callback(Buffer.from('   \n  \t  \n'))
          }, 0)
        },
        onClose: (callback) => {
          setTimeout(() => {
            callback()
          }, 0)
        },
      })

      vi.mocked(spawn).mockReturnValue(mockChild)

      const result = await checkDirtyWorkingTree()

      expect(result).toBe(false)
    })

    it('should handle multiple data chunks from stdout', async () => {
      const mockChild = createMockGitProcess({
        onData: (callback) => {
          setTimeout(() => {
            callback(Buffer.from(' M file1.ts\n'))
            callback(Buffer.from(' M file2.ts\n'))
          }, 0)
        },
        onClose: (callback) => {
          setTimeout(() => {
            callback()
          }, 20) // Delay to allow data chunks
        },
      })

      vi.mocked(spawn).mockReturnValue(mockChild)

      const result = await checkDirtyWorkingTree()

      expect(result).toBe(true)
    })
  })
})

// Helper function tests
describe('test helpers', () => {
  it('should create valid mock config', () => {
    function createMockConfig(overrides?: Partial<Config>): Config {
      return {
        version: 1,
        settings: {
          maxAgeDays: 30,
          publicKeyPath: '.attest-it/pubkey.pem',
          attestationsPath: '.attest-it/attestations.json',
          algorithm: 'ed25519',
          defaultCommand: 'npm test',
          ...overrides?.settings,
        },
        suites: {
          'test-suite': {
            packages: ['pkg1'],
            ...overrides?.suites?.['test-suite'],
          },
        },
      }
    }

    const config = createMockConfig()
    config.settings.maxAgeDays = 60
    expect(config.settings.maxAgeDays).toBe(60)
    expect(config.settings.algorithm).toBe('ed25519')
  })
})
