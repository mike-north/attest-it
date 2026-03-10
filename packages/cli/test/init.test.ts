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
    readFileSync: vi.fn(),
    promises: {
      mkdir: vi.fn(),
      writeFile: vi.fn(),
      readFile: vi.fn(),
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
    sealsPath: string
  }
  team: Record<string, unknown>
  gates: Record<string, unknown>
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

function hasTeamField(value: object): value is { team: unknown } {
  return 'team' in value
}

function hasGatesField(value: object): value is { gates: unknown } {
  return 'gates' in value
}

function hasRequiredSettingsFields(value: object): value is {
  maxAgeDays: unknown
  sealsPath: unknown
} {
  return 'maxAgeDays' in value && 'sealsPath' in value
}

function isConfigStructure(value: unknown): value is ConfigStructure {
  if (typeof value !== 'object' || value === null) return false

  if (!hasVersionField(value)) return false
  if (typeof value.version !== 'number') return false

  if (!hasSettingsField(value)) return false
  if (typeof value.settings !== 'object' || value.settings === null) return false

  if (!hasRequiredSettingsFields(value.settings)) return false
  if (typeof value.settings.maxAgeDays !== 'number') return false
  if (typeof value.settings.sealsPath !== 'string') return false

  if (!hasTeamField(value)) return false
  if (typeof value.team !== 'object' || value.team === null) return false

  if (!hasGatesField(value)) return false
  if (typeof value.gates !== 'object' || value.gates === null) return false

  if (!hasSuitesField(value)) return false
  if (typeof value.suites !== 'object' || value.suites === null) return false

  return true
}

describe('init command', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    // Default mock implementations
    vi.mocked(fs.existsSync).mockImplementation((filePath) => {
      const path = filePath.toString()
      // CLI's package.json exists (for getPackageVersion)
      if (path.includes('dist') && path.includes('package.json')) {
        return true
      }
      // Template file exists (for loadConfigTemplate)
      if (path.includes('templates') && path.includes('config.yaml')) {
        return true
      }
      // User's package.json doesn't exist by default (will be created)
      if (path === 'package.json') {
        return false
      }
      // Lock files don't exist by default
      return false
    })
    vi.mocked(fs.promises.mkdir).mockResolvedValue(undefined)
    vi.mocked(fs.promises.writeFile).mockResolvedValue(undefined)
    // User's package.json read (when it exists) - return valid JSON
    vi.mocked(fs.promises.readFile).mockResolvedValue(
      JSON.stringify({ name: 'test-project', version: '1.0.0', devDependencies: {} }),
    )
    vi.mocked(fs.readFileSync).mockImplementation((filePath) => {
      const path = filePath.toString()

      // Mock CLI's package.json content (for getPackageVersion)
      if (path.includes('package.json')) {
        return JSON.stringify({ name: '@attest-it/cli', version: '0.8.0' })
      }

      // Mock config template file
      if (path.includes('config.yaml')) {
        return `# yaml-language-server: $schema=https://raw.githubusercontent.com/mike-north/attest-it/main/schemas/v1/project-config.schema.json
# attest-it configuration
# See https://github.com/attest-it/attest-it for documentation

version: 1

settings:
  # How long seals remain valid
  maxAgeDays: 30
  # Path to the seals file
  sealsPath: .attest-it/seals.yaml

# Team members who can sign seals.
# Add members with: attest-it identity create && attest-it team join
#
# team:
#   alice:
#     name: Alice
#     email: alice@example.com
#     publicKey: <base64-encoded-public-key>

team: {}

# Gates define what code areas require seals and who can sign.
#
# Customize this gate or add more gates for different code areas.
gates:
  default:
    name: Default Gate
    description: Covers the entire project
    authorizedSigners: []  # Add team member slugs after running 'attest-it team join'
    fingerprint:
      paths:
        - src
      exclude:
        - '**/*.test.ts'
        - '**/*.spec.ts'

# Suites define test commands that produce attestations.
#
# Customize this suite to match your project's test setup.
suites:
  default:
    description: Default test suite
    gate: default
    command: npm test
`
      }

      return ''
    })
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

      const writeCalls = vi.mocked(fs.promises.writeFile).mock.calls
      const configWrite = writeCalls.find((call) => call[0].toString().includes('config.yaml'))
      expect(configWrite).toBeDefined()
      if (!configWrite) throw new Error('Expected config writeFile to be called')

      const contentArg: unknown = configWrite[1]
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

      // Find the config file write (second writeFile call, first is package.json)
      const writeCalls = vi.mocked(fs.promises.writeFile).mock.calls
      const configWrite = writeCalls.find((call) => call[0].toString().includes('config.yaml'))
      expect(configWrite).toBeDefined()
      if (!configWrite) throw new Error('Expected config writeFile to be called')

      const contentArg: unknown = configWrite[1]
      if (typeof contentArg !== 'string') {
        throw new Error('Expected content to be string')
      }

      const config: unknown = YAML.parse(contentArg)

      if (!isConfigStructure(config)) {
        throw new Error('Expected valid config structure')
      }

      expect(config.settings.maxAgeDays).toBe(30)
      expect(config.settings.sealsPath).toBe('.attest-it/seals.yaml')
    })

    it('should overwrite with --force flag', async () => {
      vi.mocked(fs.existsSync).mockImplementation((filePath) => {
        // Return true for both CLI package.json and config file
        return true
      })

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
      expect(mockConsoleLog).toHaveBeenCalledWith(expect.stringContaining('install'))
      expect(mockConsoleLog).toHaveBeenCalledWith(
        expect.stringContaining('attest-it identity create'),
      )
      expect(mockConsoleLog).toHaveBeenCalledWith(expect.stringContaining('attest-it team join'))
      expect(mockConsoleLog).toHaveBeenCalledWith(
        expect.stringContaining('Edit .attest-it/config.yaml'),
      )
    })

    it('should set config version to 1', async () => {
      await runInit({
        path: '.attest-it/config.yaml',
      })

      const writeCalls = vi.mocked(fs.promises.writeFile).mock.calls
      const configWrite = writeCalls.find((call) => call[0].toString().includes('config.yaml'))
      expect(configWrite).toBeDefined()
      if (!configWrite) throw new Error('Expected config writeFile to be called')

      const contentArg: unknown = configWrite[1]
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

    it('should include customization comments for gates and suites', async () => {
      await runInit({
        path: '.attest-it/config.yaml',
      })

      const writeCalls = vi.mocked(fs.promises.writeFile).mock.calls
      const configWrite = writeCalls.find((call) => call[0].toString().includes('config.yaml'))
      expect(configWrite).toBeDefined()
      if (!configWrite) throw new Error('Expected config writeFile to be called')

      const contentArg: unknown = configWrite[1]
      if (typeof contentArg !== 'string') {
        throw new Error('Expected content to be string')
      }

      // Should contain customization comments for gates and suites
      expect(contentArg).toContain('# Customize this gate')
      expect(contentArg).toContain('# Customize this suite')
    })

    it('should include a default suite and gate so config is immediately valid', async () => {
      await runInit({
        path: '.attest-it/config.yaml',
      })

      const writeCalls = vi.mocked(fs.promises.writeFile).mock.calls
      const configWrite = writeCalls.find((call) => call[0].toString().includes('config.yaml'))
      expect(configWrite).toBeDefined()
      if (!configWrite) throw new Error('Expected config writeFile to be called')

      const contentArg: unknown = configWrite[1]
      if (typeof contentArg !== 'string') {
        throw new Error('Expected content to be string')
      }
      const config: unknown = YAML.parse(contentArg)

      if (!isConfigStructure(config)) {
        throw new Error('Expected valid config structure')
      }

      // Both suites and gates should have a 'default' entry out of the box
      expect(config.suites).toHaveProperty('default')
      expect(config.gates).toHaveProperty('default')
    })

    it('should create or update package.json with attest-it devDependency', async () => {
      await runInit({
        path: '.attest-it/config.yaml',
      })

      // Find the package.json write call
      const writeCalls = vi.mocked(fs.promises.writeFile).mock.calls
      const packageJsonWrite = writeCalls.find((call) =>
        call[0].toString().includes('package.json'),
      )
      expect(packageJsonWrite).toBeDefined()
      if (!packageJsonWrite) throw new Error('Expected package.json writeFile to be called')

      const contentArg: unknown = packageJsonWrite[1]
      if (typeof contentArg !== 'string') {
        throw new Error('Expected content to be string')
      }

      const packageJson = JSON.parse(contentArg)
      expect(packageJson.devDependencies).toBeDefined()
      expect(packageJson.devDependencies['attest-it']).toMatch(/^\^0\.\d+\.\d+$/)
    })

    it('should include team and gates sections', async () => {
      await runInit({
        path: '.attest-it/config.yaml',
      })

      const writeCalls = vi.mocked(fs.promises.writeFile).mock.calls
      const configWrite = writeCalls.find((call) => call[0].toString().includes('config.yaml'))
      expect(configWrite).toBeDefined()
      if (!configWrite) throw new Error('Expected config writeFile to be called')

      const contentArg: unknown = configWrite[1]
      if (typeof contentArg !== 'string') {
        throw new Error('Expected content to be string')
      }

      const config: unknown = YAML.parse(contentArg)

      if (!isConfigStructure(config)) {
        throw new Error('Expected valid config structure')
      }

      // team starts empty — identity setup is required before joining
      expect(config.team).toEqual({})
      // gates has a default entry out of the box
      expect(config.gates).toHaveProperty('default')
    })
  })

  describe('negative cases', () => {
    it('should exit when user declines overwrite', async () => {
      vi.mocked(fs.existsSync).mockImplementation((filePath) => {
        // Return true for all files (config exists, CLI package.json exists)
        return true
      })
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
      vi.mocked(fs.existsSync).mockImplementation((filePath) => {
        // Return true for all files (config exists, CLI package.json exists)
        return true
      })
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

    it('should detect package manager from lock files', async () => {
      // Test pnpm detection
      vi.mocked(fs.existsSync).mockImplementation((path) => {
        if (path === 'pnpm-lock.yaml') return true
        return false
      })

      await runInit({
        path: '.attest-it/config.yaml',
      })

      expect(mockConsoleLog).toHaveBeenCalledWith(expect.stringContaining('pnpm install'))
    })
  })
})
