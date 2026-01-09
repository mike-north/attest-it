import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { runInit } from '../src/commands/init.js'
import * as fs from 'node:fs'
import * as path from 'node:path'
import YAML from 'yaml'

// Mock fs module
vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs')
  return {
    ...actual,
    existsSync: vi.fn(),
    promises: {
      mkdir: vi.fn(),
      writeFile: vi.fn(),
    },
  }
})

// Mock prompts
vi.mock('../src/utils/prompts.js', () => ({
  confirmAction: vi.fn(),
  getInput: vi.fn(),
  selectOption: vi.fn(),
}))

// Mock console methods
const mockConsoleLog = vi.spyOn(console, 'log').mockImplementation(() => {
  // Intentionally empty
})
const mockConsoleError = vi.spyOn(console, 'error').mockImplementation(() => {
  // Intentionally empty
})
const mockProcessExit = vi.spyOn(process, 'exit').mockImplementation(() => {
  throw new Error('process.exit called')
})

// Import mocked functions
const { confirmAction, getInput, selectOption } = await import('../src/utils/prompts.js')

interface ConfigStructure {
  version: number
  settings: {
    maxAgeDays: number
    publicKeyPath: string
    attestationsPath: string
    algorithm: string
  }
  suites: Record<
    string,
    {
      description?: string
      packages: string[]
      command: string
    }
  >
}

function hasVersionField(value: object): value is { version: unknown } {
  return 'version' in value
}

function hasSettingsField(value: object): value is { settings: unknown } {
  return 'settings' in value
}

function hasSuitesField(value: object): value is { suites: unknown } {
  return 'suites' in value
}

function hasRequiredSettingsFields(value: object): value is {
  maxAgeDays: unknown
  publicKeyPath: unknown
  attestationsPath: unknown
  algorithm: unknown
} {
  return (
    'maxAgeDays' in value &&
    'publicKeyPath' in value &&
    'attestationsPath' in value &&
    'algorithm' in value
  )
}

function isConfigStructure(value: unknown): value is ConfigStructure {
  if (typeof value !== 'object' || value === null) return false

  if (!hasVersionField(value)) return false
  if (typeof value.version !== 'number') return false

  if (!hasSettingsField(value)) return false
  if (typeof value.settings !== 'object' || value.settings === null) return false

  if (!hasRequiredSettingsFields(value.settings)) return false
  if (typeof value.settings.maxAgeDays !== 'number') return false
  if (typeof value.settings.publicKeyPath !== 'string') return false
  if (typeof value.settings.attestationsPath !== 'string') return false
  if (typeof value.settings.algorithm !== 'string') return false

  if (!hasSuitesField(value)) return false
  if (typeof value.suites !== 'object' || value.suites === null) return false

  return true
}

describe('init command', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    // Default mock implementations
    vi.mocked(fs.existsSync).mockReturnValue(false)
    vi.mocked(fs.promises.mkdir).mockResolvedValue(undefined)
    vi.mocked(fs.promises.writeFile).mockResolvedValue(undefined)
    vi.mocked(confirmAction).mockResolvedValue(false)
    vi.mocked(getInput)
      .mockResolvedValueOnce('30') // maxAgeDays
      .mockResolvedValueOnce('example') // suite name
      .mockResolvedValueOnce('Example test suite') // description
      .mockResolvedValueOnce('packages/example') // packages
      .mockResolvedValueOnce('pnpm vitest packages/example') // command
    vi.mocked(selectOption).mockResolvedValue('ed25519')
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('positive cases', () => {
    it('should create config file in correct location', async () => {
      vi.mocked(confirmAction).mockResolvedValue(false) // no more suites

      await runInit({
        path: '.attest-it/config.yaml',
      })

      expect(fs.promises.writeFile).toHaveBeenCalledWith(
        path.resolve('.attest-it/config.yaml'),
        expect.any(String),
        'utf-8',
      )
    })

    it('should create parent directories', async () => {
      vi.mocked(confirmAction).mockResolvedValue(false)

      await runInit({
        path: '.attest-it/config.yaml',
      })

      expect(fs.promises.mkdir).toHaveBeenCalledWith(path.resolve('.attest-it'), {
        recursive: true,
      })
    })

    it('should output YAML by default', async () => {
      vi.mocked(confirmAction).mockResolvedValue(false)

      await runInit({
        path: '.attest-it/config.yaml',
      })

      const writeCall = vi.mocked(fs.promises.writeFile).mock.calls[0]
      expect(writeCall).toBeDefined()
      if (!writeCall) throw new Error('Expected writeFile to be called')

      const contentArg: unknown = writeCall[1]
      expect(typeof contentArg).toBe('string')

      // Type guard for string
      if (typeof contentArg !== 'string') {
        throw new Error('Expected content to be string')
      }

      // Should be valid YAML
      expect(() => {
        YAML.parse(contentArg)
      }).not.toThrow()
    })

    it('should output JSON with --json flag', async () => {
      vi.mocked(confirmAction).mockResolvedValue(false)

      await runInit({
        path: '.attest-it/config.yaml',
        json: true,
      })

      const writeCall = vi.mocked(fs.promises.writeFile).mock.calls[0]
      expect(writeCall).toBeDefined()
      if (!writeCall) throw new Error('Expected writeFile to be called')

      const contentArg: unknown = writeCall[1]
      expect(typeof contentArg).toBe('string')

      // Type guard for string
      if (typeof contentArg !== 'string') {
        throw new Error('Expected content to be string')
      }

      // Should be valid JSON
      expect(() => {
        JSON.parse(contentArg)
      }).not.toThrow()
    })

    it('should include all user inputs in config', async () => {
      vi.mocked(getInput).mockReset()
      vi.mocked(getInput)
        .mockResolvedValueOnce('45') // maxAgeDays
        .mockResolvedValueOnce('my-suite') // suite name
        .mockResolvedValueOnce('My custom suite') // description
        .mockResolvedValueOnce('packages/my-suite') // packages
        .mockResolvedValueOnce('npm test') // command
      vi.mocked(selectOption).mockResolvedValue('rsa')
      vi.mocked(confirmAction).mockResolvedValue(false)

      await runInit({
        path: '.attest-it/config.yaml',
        json: true,
      })

      const writeCall = vi.mocked(fs.promises.writeFile).mock.calls[0]
      expect(writeCall).toBeDefined()
      if (!writeCall) throw new Error('Expected writeFile to be called')

      const contentArg: unknown = writeCall[1]
      if (typeof contentArg !== 'string') {
        throw new Error('Expected content to be string')
      }
      const config: unknown = JSON.parse(contentArg)

      if (!isConfigStructure(config)) {
        throw new Error('Expected valid config structure')
      }

      expect(config.settings.maxAgeDays).toBe(45)
      expect(config.settings.algorithm).toBe('rsa')
      expect(config.suites['my-suite']).toBeDefined()
      expect(config.suites['my-suite']?.description).toBe('My custom suite')
      expect(config.suites['my-suite']?.packages).toEqual(['packages/my-suite'])
      expect(config.suites['my-suite']?.command).toBe('npm test')
    })

    it('should overwrite with --force flag', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true)
      vi.mocked(confirmAction).mockResolvedValue(false)

      await runInit({
        path: '.attest-it/config.yaml',
        force: true,
      })

      // Should not prompt for confirmation
      expect(confirmAction).toHaveBeenCalledTimes(1) // Only for "add more suites"
      expect(fs.promises.writeFile).toHaveBeenCalled()
    })

    it('should support multiple suites', async () => {
      vi.mocked(getInput).mockReset()
      vi.mocked(getInput)
        .mockResolvedValueOnce('30') // maxAgeDays
        .mockResolvedValueOnce('suite1') // first suite name
        .mockResolvedValueOnce('First suite') // description
        .mockResolvedValueOnce('packages/suite1') // packages
        .mockResolvedValueOnce('npm test suite1') // command
        .mockResolvedValueOnce('suite2') // second suite name
        .mockResolvedValueOnce('Second suite') // description
        .mockResolvedValueOnce('packages/suite2') // packages
        .mockResolvedValueOnce('npm test suite2') // command
      vi.mocked(confirmAction)
        .mockResolvedValueOnce(true) // add another suite
        .mockResolvedValueOnce(false) // no more suites

      await runInit({
        path: '.attest-it/config.yaml',
        json: true,
      })

      const writeCall = vi.mocked(fs.promises.writeFile).mock.calls[0]
      expect(writeCall).toBeDefined()
      if (!writeCall) throw new Error('Expected writeFile to be called')

      const contentArg: unknown = writeCall[1]
      if (typeof contentArg !== 'string') {
        throw new Error('Expected content to be string')
      }
      const config: unknown = JSON.parse(contentArg)

      if (!isConfigStructure(config)) {
        throw new Error('Expected valid config structure')
      }

      expect(Object.keys(config.suites)).toEqual(['suite1', 'suite2'])
    })

    it('should handle comma-separated packages', async () => {
      vi.mocked(getInput).mockReset()
      vi.mocked(getInput)
        .mockResolvedValueOnce('30') // maxAgeDays
        .mockResolvedValueOnce('multi-pkg') // suite name
        .mockResolvedValueOnce('Multi-package suite') // description
        .mockResolvedValueOnce('packages/pkg1, packages/pkg2, packages/pkg3') // packages
        .mockResolvedValueOnce('npm test') // command
      vi.mocked(confirmAction).mockResolvedValue(false)

      await runInit({
        path: '.attest-it/config.yaml',
        json: true,
      })

      const writeCall = vi.mocked(fs.promises.writeFile).mock.calls[0]
      expect(writeCall).toBeDefined()
      if (!writeCall) throw new Error('Expected writeFile to be called')

      const contentArg: unknown = writeCall[1]
      if (typeof contentArg !== 'string') {
        throw new Error('Expected content to be string')
      }
      const config: unknown = JSON.parse(contentArg)

      if (!isConfigStructure(config)) {
        throw new Error('Expected valid config structure')
      }

      expect(config.suites['multi-pkg']?.packages).toEqual([
        'packages/pkg1',
        'packages/pkg2',
        'packages/pkg3',
      ])
    })

    it('should display success message', async () => {
      vi.mocked(confirmAction).mockResolvedValue(false)

      await runInit({
        path: '.attest-it/config.yaml',
      })

      expect(mockConsoleLog).toHaveBeenCalledWith(expect.stringContaining('Configuration created'))
    })

    it('should display next steps', async () => {
      vi.mocked(confirmAction).mockResolvedValue(false)

      await runInit({
        path: '.attest-it/config.yaml',
      })

      expect(mockConsoleLog).toHaveBeenCalledWith(expect.stringContaining('Next steps:'))
      expect(mockConsoleLog).toHaveBeenCalledWith(expect.stringContaining('attest-it keygen'))
    })

    it('should set config version to 1', async () => {
      vi.mocked(confirmAction).mockResolvedValue(false)

      await runInit({
        path: '.attest-it/config.yaml',
        json: true,
      })

      const writeCall = vi.mocked(fs.promises.writeFile).mock.calls[0]
      expect(writeCall).toBeDefined()
      if (!writeCall) throw new Error('Expected writeFile to be called')

      const contentArg: unknown = writeCall[1]
      if (typeof contentArg !== 'string') {
        throw new Error('Expected content to be string')
      }
      const config: unknown = JSON.parse(contentArg)

      if (!isConfigStructure(config)) {
        throw new Error('Expected valid config structure')
      }

      expect(config.version).toBe(1)
    })

    it('should create attestations directory', async () => {
      vi.mocked(confirmAction).mockResolvedValue(false)

      await runInit({
        path: '.attest-it/config.yaml',
      })

      // Should create .attest-it directory
      expect(fs.promises.mkdir).toHaveBeenCalledWith(expect.stringContaining('.attest-it'), {
        recursive: true,
      })
    })
  })

  describe('negative cases', () => {
    it('should exit when user declines overwrite', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true)
      vi.mocked(confirmAction).mockResolvedValue(false)

      await expect(async () => {
        await runInit({
          path: '.attest-it/config.yaml',
        })
      }).rejects.toThrow('process.exit called')

      expect(mockProcessExit).toHaveBeenCalledWith(3)
      expect(mockConsoleError).toHaveBeenCalledWith(expect.stringContaining('Init cancelled'))
      expect(fs.promises.writeFile).not.toHaveBeenCalled()
    })

    it('should validate maxAgeDays input', async () => {
      vi.mocked(getInput)
        .mockResolvedValueOnce('30') // Will be called for validation
        .mockResolvedValueOnce('example')
        .mockResolvedValueOnce('Example suite')
        .mockResolvedValueOnce('packages/example')
        .mockResolvedValueOnce('npm test')

      await runInit({
        path: '.attest-it/config.yaml',
      })

      // Check that getInput was called with validate function
      const maxAgeDaysCall = vi.mocked(getInput).mock.calls[0]
      if (!maxAgeDaysCall) {
        throw new Error('Expected getInput to be called')
      }

      const options = maxAgeDaysCall[0]
      if (!options.validate) {
        throw new Error('Expected validate function')
      }

      // Test the validate function
      expect(options.validate('30')).toBe(true)
      expect(options.validate('0')).toBe('Must be a positive number')
      expect(options.validate('-5')).toBe('Must be a positive number')
      expect(options.validate('abc')).toBe('Must be a positive number')
    })

    // Note: Testing the "at least one suite required" case is difficult
    // because the validation function in getInput prevents empty suite names.
    // The error case in the code (suites.length === 0) is unreachable in practice
    // due to the validation logic. This is by design.

    it('should handle file write errors', async () => {
      vi.mocked(confirmAction).mockResolvedValue(false)
      vi.mocked(fs.promises.writeFile).mockRejectedValue(new Error('Permission denied'))

      await expect(async () => {
        await runInit({
          path: '.attest-it/config.yaml',
        })
      }).rejects.toThrow('process.exit called')

      expect(mockProcessExit).toHaveBeenCalledWith(2)
      expect(mockConsoleError).toHaveBeenCalledWith(expect.stringContaining('Permission denied'))
    })

    it('should handle directory creation errors', async () => {
      vi.mocked(confirmAction).mockResolvedValue(false)
      vi.mocked(fs.promises.mkdir).mockRejectedValue(new Error('Cannot create directory'))

      await expect(async () => {
        await runInit({
          path: '.attest-it/config.yaml',
        })
      }).rejects.toThrow('process.exit called')

      expect(mockProcessExit).toHaveBeenCalledWith(2)
      expect(mockConsoleError).toHaveBeenCalledWith(
        expect.stringContaining('Cannot create directory'),
      )
    })

    it('should handle unknown error types', async () => {
      vi.mocked(confirmAction).mockResolvedValue(false)
      vi.mocked(fs.promises.writeFile).mockRejectedValue('string error')

      await expect(async () => {
        await runInit({
          path: '.attest-it/config.yaml',
        })
      }).rejects.toThrow('process.exit called')

      expect(mockProcessExit).toHaveBeenCalledWith(2)
      expect(mockConsoleError).toHaveBeenCalledWith(expect.stringContaining('Unknown error'))
    })

    it('should validate suite name is not empty', async () => {
      vi.mocked(getInput)
        .mockResolvedValueOnce('30') // maxAgeDays
        .mockResolvedValueOnce('example') // suite name (will be validated)
        .mockResolvedValueOnce('Example suite')
        .mockResolvedValueOnce('packages/example')
        .mockResolvedValueOnce('npm test')

      await runInit({
        path: '.attest-it/config.yaml',
      })

      // Check that getInput was called with validate function for suite name
      const suiteNameCall = vi.mocked(getInput).mock.calls[1]
      if (!suiteNameCall) {
        throw new Error('Expected getInput to be called')
      }

      const options = suiteNameCall[0]
      if (!options.validate) {
        throw new Error('Expected validate function')
      }

      // Test the validate function
      expect(options.validate('example')).toBe(true)
      expect(options.validate('')).toBe('Required')
    })

    it('should validate packages input is not empty', async () => {
      vi.mocked(getInput)
        .mockResolvedValueOnce('30') // maxAgeDays
        .mockResolvedValueOnce('example') // suite name
        .mockResolvedValueOnce('Example suite')
        .mockResolvedValueOnce('packages/example') // packages (will be validated)
        .mockResolvedValueOnce('npm test')

      await runInit({
        path: '.attest-it/config.yaml',
      })

      // Check that getInput was called with validate function for packages
      const packagesCall = vi.mocked(getInput).mock.calls[3]
      if (!packagesCall) {
        throw new Error('Expected getInput to be called')
      }

      const options = packagesCall[0]
      if (!options.validate) {
        throw new Error('Expected validate function')
      }

      // Test the validate function
      expect(options.validate('packages/example')).toBe(true)
      expect(options.validate('')).toBe('At least one package required')
    })
  })

  describe('edge cases', () => {
    it('should handle empty description (optional)', async () => {
      vi.mocked(getInput).mockReset()
      vi.mocked(getInput)
        .mockResolvedValueOnce('30') // maxAgeDays
        .mockResolvedValueOnce('example') // suite name
        .mockResolvedValueOnce('') // empty description
        .mockResolvedValueOnce('packages/example') // packages
        .mockResolvedValueOnce('npm test') // command
      vi.mocked(confirmAction).mockResolvedValue(false)

      await runInit({
        path: '.attest-it/config.yaml',
        json: true,
      })

      const writeCall = vi.mocked(fs.promises.writeFile).mock.calls[0]
      expect(writeCall).toBeDefined()
      if (!writeCall) throw new Error('Expected writeFile to be called')

      const contentArg: unknown = writeCall[1]
      if (typeof contentArg !== 'string') {
        throw new Error('Expected content to be string')
      }
      const config: unknown = JSON.parse(contentArg)

      if (!isConfigStructure(config)) {
        throw new Error('Expected valid config structure')
      }

      // Description should be undefined when empty
      expect(config.suites.example?.description).toBeUndefined()
    })

    it('should trim whitespace from packages', async () => {
      vi.mocked(getInput).mockReset()
      vi.mocked(getInput)
        .mockResolvedValueOnce('30') // maxAgeDays
        .mockResolvedValueOnce('example') // suite name
        .mockResolvedValueOnce('Example suite')
        .mockResolvedValueOnce('  packages/a  ,  packages/b  , packages/c ') // packages with whitespace
        .mockResolvedValueOnce('npm test')
      vi.mocked(confirmAction).mockResolvedValue(false)

      await runInit({
        path: '.attest-it/config.yaml',
        json: true,
      })

      const writeCall = vi.mocked(fs.promises.writeFile).mock.calls[0]
      expect(writeCall).toBeDefined()
      if (!writeCall) throw new Error('Expected writeFile to be called')

      const contentArg: unknown = writeCall[1]
      if (typeof contentArg !== 'string') {
        throw new Error('Expected content to be string')
      }
      const config: unknown = JSON.parse(contentArg)

      if (!isConfigStructure(config)) {
        throw new Error('Expected valid config structure')
      }

      expect(config.suites.example?.packages).toEqual(['packages/a', 'packages/b', 'packages/c'])
    })

    it('should filter out empty package entries', async () => {
      // Clear and reset mocks completely
      vi.mocked(getInput).mockReset()
      vi.mocked(getInput)
        .mockResolvedValueOnce('30') // maxAgeDays
        .mockResolvedValueOnce('example') // suite name
        .mockResolvedValueOnce('Example suite')
        .mockResolvedValueOnce('packages/a,,packages/b,,,packages/c') // packages with empty entries
        .mockResolvedValueOnce('npm test')
      vi.mocked(confirmAction).mockResolvedValue(false)

      await runInit({
        path: '.attest-it/config.yaml',
        json: true,
      })

      const writeCall = vi.mocked(fs.promises.writeFile).mock.calls[0]
      expect(writeCall).toBeDefined()
      if (!writeCall) throw new Error('Expected writeFile to be called')

      const contentArg: unknown = writeCall[1]
      if (typeof contentArg !== 'string') {
        throw new Error('Expected content to be string')
      }
      const config: unknown = JSON.parse(contentArg)

      if (!isConfigStructure(config)) {
        throw new Error('Expected valid config structure')
      }

      expect(config.suites.example?.packages).toEqual(['packages/a', 'packages/b', 'packages/c'])
    })

    it('should use default values for inputs', async () => {
      // Clear and reset mocks completely
      vi.mocked(getInput).mockReset()
      vi.mocked(getInput)
        .mockResolvedValueOnce('30') // maxAgeDays (default)
        .mockResolvedValueOnce('my-suite') // suite name
        .mockResolvedValueOnce('')
        .mockResolvedValueOnce('packages/my-suite') // will use default in actual run
        .mockResolvedValueOnce('pnpm vitest packages/my-suite') // will use default
      vi.mocked(confirmAction).mockResolvedValue(false)

      await runInit({
        path: '.attest-it/config.yaml',
      })

      // Check that defaults were provided
      const maxAgeDaysCall = vi.mocked(getInput).mock.calls[0]
      if (!maxAgeDaysCall) {
        throw new Error('Expected call')
      }
      const maxAgeDaysOptions = maxAgeDaysCall[0]
      if (!maxAgeDaysOptions.default) {
        throw new Error('Expected options with default')
      }
      expect(maxAgeDaysOptions.default).toBe('30')

      const packagesCall = vi.mocked(getInput).mock.calls[3]
      if (!packagesCall) {
        throw new Error('Expected call')
      }
      const packagesOptions = packagesCall[0]
      if (!packagesOptions.default) {
        throw new Error('Expected options with default')
      }
      expect(packagesOptions.default).toContain('my-suite')
    })

    it('should resolve relative config paths', async () => {
      vi.mocked(confirmAction).mockResolvedValue(false)

      await runInit({
        path: '../some/path/config.yaml',
      })

      // Should resolve to absolute path
      expect(fs.promises.writeFile).toHaveBeenCalledWith(
        path.resolve('../some/path/config.yaml'),
        expect.any(String),
        'utf-8',
      )
    })

    it('should handle both ed25519 and rsa algorithms', async () => {
      // Test ed25519
      vi.mocked(selectOption).mockResolvedValue('ed25519')
      vi.mocked(confirmAction).mockResolvedValue(false)

      await runInit({
        path: '.attest-it/config.yaml',
        json: true,
      })

      let writeCall = vi.mocked(fs.promises.writeFile).mock.calls[0]
      if (!writeCall) {
        throw new Error('Expected writeFile to be called')
      }

      let contentArg: unknown = writeCall[1]
      if (typeof contentArg !== 'string') {
        throw new Error('Expected content to be string')
      }
      let config: unknown = JSON.parse(contentArg)

      if (!isConfigStructure(config)) {
        throw new Error('Expected valid config structure')
      }

      expect(config.settings.algorithm).toBe('ed25519')

      // Reset and test rsa
      vi.clearAllMocks()
      vi.mocked(fs.existsSync).mockReturnValue(false)
      vi.mocked(fs.promises.mkdir).mockResolvedValue(undefined)
      vi.mocked(fs.promises.writeFile).mockResolvedValue(undefined)
      vi.mocked(getInput)
        .mockResolvedValueOnce('30')
        .mockResolvedValueOnce('example')
        .mockResolvedValueOnce('Example suite')
        .mockResolvedValueOnce('packages/example')
        .mockResolvedValueOnce('npm test')
      vi.mocked(selectOption).mockResolvedValue('rsa')
      vi.mocked(confirmAction).mockResolvedValue(false)

      await runInit({
        path: '.attest-it/config.yaml',
        json: true,
      })

      writeCall = vi.mocked(fs.promises.writeFile).mock.calls[0]
      if (!writeCall) {
        throw new Error('Expected writeFile to be called')
      }

      contentArg = writeCall[1]
      if (typeof contentArg !== 'string') {
        throw new Error('Expected content to be string')
      }
      config = JSON.parse(contentArg)

      if (!isConfigStructure(config)) {
        throw new Error('Expected valid config structure')
      }

      expect(config.settings.algorithm).toBe('rsa')
    })
  })
})
