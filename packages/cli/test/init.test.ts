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
}))

// Mock completion offer (no-op in tests)
vi.mock('../src/utils/completion-offer.js', () => ({
  offerCompletionInstall: vi.fn().mockResolvedValue(false),
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
const { confirmAction } = await import('../src/utils/prompts.js')

interface ConfigStructure {
  version: number
  settings: {
    maxAgeDays: number
    publicKeyPath: string
    attestationsPath: string
    algorithm: string
  }
  suites: Record<string, unknown>
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
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('positive cases', () => {
    it('should create config file in correct location', async () => {
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
      await runInit({
        path: '.attest-it/config.yaml',
      })

      expect(fs.promises.mkdir).toHaveBeenCalledWith(path.resolve('.attest-it'), {
        recursive: true,
      })
    })

    it('should output valid YAML', async () => {
      await runInit({
        path: '.attest-it/config.yaml',
      })

      const writeCall = vi.mocked(fs.promises.writeFile).mock.calls[0]
      expect(writeCall).toBeDefined()
      if (!writeCall) throw new Error('Expected writeFile to be called')

      const contentArg: unknown = writeCall[1]
      expect(typeof contentArg).toBe('string')

      if (typeof contentArg !== 'string') {
        throw new Error('Expected content to be string')
      }

      // Should be valid YAML
      expect(() => {
        YAML.parse(contentArg)
      }).not.toThrow()
    })

    it('should include sensible default settings', async () => {
      await runInit({
        path: '.attest-it/config.yaml',
      })

      const writeCall = vi.mocked(fs.promises.writeFile).mock.calls[0]
      expect(writeCall).toBeDefined()
      if (!writeCall) throw new Error('Expected writeFile to be called')

      const contentArg: unknown = writeCall[1]
      if (typeof contentArg !== 'string') {
        throw new Error('Expected content to be string')
      }

      const config: unknown = YAML.parse(contentArg)

      if (!isConfigStructure(config)) {
        throw new Error('Expected valid config structure')
      }

      expect(config.settings.maxAgeDays).toBe(30)
      expect(config.settings.algorithm).toBe('rsa')
      expect(config.settings.publicKeyPath).toBe('.attest-it/pubkey.pem')
      expect(config.settings.attestationsPath).toBe('.attest-it/attestations.json')
    })

    it('should overwrite with --force flag', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true)

      await runInit({
        path: '.attest-it/config.yaml',
        force: true,
      })

      // Should not prompt for confirmation
      expect(confirmAction).not.toHaveBeenCalled()
      expect(fs.promises.writeFile).toHaveBeenCalled()
    })

    it('should display success message', async () => {
      await runInit({
        path: '.attest-it/config.yaml',
      })

      expect(mockConsoleLog).toHaveBeenCalledWith(expect.stringContaining('Configuration created'))
    })

    it('should display next steps', async () => {
      await runInit({
        path: '.attest-it/config.yaml',
      })

      expect(mockConsoleLog).toHaveBeenCalledWith(expect.stringContaining('Next steps:'))
      expect(mockConsoleLog).toHaveBeenCalledWith(expect.stringContaining('attest-it keygen'))
      expect(mockConsoleLog).toHaveBeenCalledWith(expect.stringContaining('attest-it status'))
    })

    it('should set config version to 1', async () => {
      await runInit({
        path: '.attest-it/config.yaml',
      })

      const writeCall = vi.mocked(fs.promises.writeFile).mock.calls[0]
      expect(writeCall).toBeDefined()
      if (!writeCall) throw new Error('Expected writeFile to be called')

      const contentArg: unknown = writeCall[1]
      if (typeof contentArg !== 'string') {
        throw new Error('Expected content to be string')
      }
      const config: unknown = YAML.parse(contentArg)

      if (!isConfigStructure(config)) {
        throw new Error('Expected valid config structure')
      }

      expect(config.version).toBe(1)
    })

    it('should create config directory', async () => {
      await runInit({
        path: '.attest-it/config.yaml',
      })

      expect(fs.promises.mkdir).toHaveBeenCalledWith(expect.stringContaining('.attest-it'), {
        recursive: true,
      })
    })

    it('should include commented example suites in template', async () => {
      await runInit({
        path: '.attest-it/config.yaml',
      })

      const writeCall = vi.mocked(fs.promises.writeFile).mock.calls[0]
      expect(writeCall).toBeDefined()
      if (!writeCall) throw new Error('Expected writeFile to be called')

      const contentArg: unknown = writeCall[1]
      if (typeof contentArg !== 'string') {
        throw new Error('Expected content to be string')
      }

      // Should contain commented examples
      expect(contentArg).toContain('# Example:')
      expect(contentArg).toContain('# suites:')
      expect(contentArg).toContain('#   visual-tests:')
    })

    it('should have empty suites object by default', async () => {
      await runInit({
        path: '.attest-it/config.yaml',
      })

      const writeCall = vi.mocked(fs.promises.writeFile).mock.calls[0]
      expect(writeCall).toBeDefined()
      if (!writeCall) throw new Error('Expected writeFile to be called')

      const contentArg: unknown = writeCall[1]
      if (typeof contentArg !== 'string') {
        throw new Error('Expected content to be string')
      }
      const config: unknown = YAML.parse(contentArg)

      if (!isConfigStructure(config)) {
        throw new Error('Expected valid config structure')
      }

      expect(config.suites).toEqual({})
    })

    it('should tell user to edit the config file', async () => {
      await runInit({
        path: '.attest-it/config.yaml',
      })

      expect(mockConsoleLog).toHaveBeenCalledWith(
        expect.stringContaining('Edit .attest-it/config.yaml'),
      )
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

    it('should prompt for confirmation when config exists', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true)
      vi.mocked(confirmAction).mockResolvedValue(true)

      await runInit({
        path: '.attest-it/config.yaml',
      })

      expect(confirmAction).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('Overwrite'),
        }),
      )
      expect(fs.promises.writeFile).toHaveBeenCalled()
    })

    it('should handle file write errors', async () => {
      vi.mocked(fs.promises.writeFile).mockRejectedValue(new Error('Permission denied'))

      await expect(async () => {
        await runInit({
          path: '.attest-it/config.yaml',
        })
      }).rejects.toThrow('process.exit called')

      expect(mockProcessExit).toHaveBeenCalledWith(3) // CONFIG_ERROR
      expect(mockConsoleError).toHaveBeenCalledWith(expect.stringContaining('Permission denied'))
    })

    it('should handle directory creation errors', async () => {
      vi.mocked(fs.promises.mkdir).mockRejectedValue(new Error('Cannot create directory'))

      await expect(async () => {
        await runInit({
          path: '.attest-it/config.yaml',
        })
      }).rejects.toThrow('process.exit called')

      expect(mockProcessExit).toHaveBeenCalledWith(3) // CONFIG_ERROR
      expect(mockConsoleError).toHaveBeenCalledWith(
        expect.stringContaining('Cannot create directory'),
      )
    })

    it('should handle unknown error types', async () => {
      vi.mocked(fs.promises.writeFile).mockRejectedValue('string error')

      await expect(async () => {
        await runInit({
          path: '.attest-it/config.yaml',
        })
      }).rejects.toThrow('process.exit called')

      expect(mockProcessExit).toHaveBeenCalledWith(3) // CONFIG_ERROR
      expect(mockConsoleError).toHaveBeenCalledWith(expect.stringContaining('Unknown error'))
    })
  })

  describe('edge cases', () => {
    it('should resolve relative config paths', async () => {
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

    it('should create directories for nested paths', async () => {
      await runInit({
        path: 'deep/nested/path/config.yaml',
      })

      expect(fs.promises.mkdir).toHaveBeenCalledWith(path.resolve('deep/nested/path'), {
        recursive: true,
      })
    })

    it('should use rsa algorithm', async () => {
      await runInit({
        path: '.attest-it/config.yaml',
      })

      const writeCall = vi.mocked(fs.promises.writeFile).mock.calls[0]
      expect(writeCall).toBeDefined()
      if (!writeCall) throw new Error('Expected writeFile to be called')

      const contentArg: unknown = writeCall[1]
      if (typeof contentArg !== 'string') {
        throw new Error('Expected content to be string')
      }
      const config: unknown = YAML.parse(contentArg)

      if (!isConfigStructure(config)) {
        throw new Error('Expected valid config structure')
      }

      expect(config.settings.algorithm).toBe('rsa')
    })
  })
})
