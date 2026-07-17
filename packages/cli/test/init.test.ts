import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import YAML from 'yaml'
import { runInit } from '../src/commands/init.js'
import { ExitCode } from '../src/utils/exit-codes.js'

// Mock fs module. Filesystem writes/reads/mkdir are stubbed; existsSync is
// stubbed per-test to control the overwrite-confirmation flow.
vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs')
  return {
    ...actual,
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
    promises: {
      ...actual.promises,
      mkdir: vi.fn(),
      writeFile: vi.fn(),
      readFile: vi.fn(),
    },
  }
})

// Mock prompts. isInteractiveTTY defaults to true so existing tests continue
// to exercise the interactive overwrite-confirmation prompt unchanged; the
// dedicated 'non-interactive guard' describe block below overrides it with
// mockReturnValue(false) to exercise the fail-fast path from issue #80.
vi.mock('../src/utils/prompts.js', () => ({
  confirmAction: vi.fn(),
  isInteractiveTTY: vi.fn(() => true),
}))

// Mock completion offer (no-op in tests)
vi.mock('../src/utils/completion-offer.js', () => ({
  offerCompletionInstall: vi.fn().mockResolvedValue(false),
}))

// Mock @attest-it/core, only overriding migrateUnifiedContent (used by --migrate)
vi.mock('@attest-it/core', async () => {
  const actual = await vi.importActual<typeof import('@attest-it/core')>('@attest-it/core')
  return {
    ...actual,
    migrateUnifiedContent: vi.fn(),
  }
})

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
const { confirmAction, isInteractiveTTY } = await import('../src/utils/prompts.js')
const { migrateUnifiedContent } = await import('@attest-it/core')

// Load the *real* template files from disk (via the unmocked fs module) so the
// test fixtures never drift from the actual bundled templates.
const actualFs = await vi.importActual<typeof import('node:fs')>('node:fs')
const testDir = path.dirname(fileURLToPath(import.meta.url))
const POLICY_TEMPLATE_CONTENT = actualFs.readFileSync(
  path.join(testDir, '../templates/policy.yaml'),
  'utf-8',
)
const CONFIG_TEMPLATE_CONTENT = actualFs.readFileSync(
  path.join(testDir, '../templates/config.yaml'),
  'utf-8',
)

const CLI_PACKAGE_JSON = JSON.stringify({ name: '@attest-it/cli', version: '0.8.0' })
const DEFAULT_DIR = '.attest-it'

function resolvedPaths(dir = DEFAULT_DIR): {
  configDir: string
  policyPath: string
  operationalPath: string
} {
  const configDir = path.resolve(dir)
  return {
    configDir,
    policyPath: path.join(configDir, 'policy.yaml'),
    operationalPath: path.join(configDir, 'config.yaml'),
  }
}

/** Read the string content written by a specific fs.promises.writeFile call, matched by suffix. */
function findWrittenContent(suffix: string): string {
  const writeCalls = vi.mocked(fs.promises.writeFile).mock.calls
  const call = writeCalls.find((c) => c[0].toString().endsWith(suffix))
  if (!call) throw new Error(`Expected a writeFile call targeting a path ending with ${suffix}`)
  const content: unknown = call[1]
  if (typeof content !== 'string') throw new Error('Expected written content to be a string')
  return content
}

describe('init command', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    // Most of these tests exercise the interactive overwrite-confirmation
    // prompt, only reachable with an interactive TTY (see issue #80's
    // fail-fast guard). The dedicated 'non-interactive' describe block below
    // overrides this per-test to exercise the guard itself.
    vi.mocked(isInteractiveTTY).mockReturnValue(true)

    // By default: nothing exists on disk (fresh init), no lock files.
    vi.mocked(fs.existsSync).mockReturnValue(false)

    vi.mocked(fs.promises.mkdir).mockResolvedValue(undefined)
    vi.mocked(fs.promises.writeFile).mockResolvedValue(undefined)
    // User's package.json read (when it exists) - return valid JSON
    vi.mocked(fs.promises.readFile).mockResolvedValue(
      JSON.stringify({ name: 'test-project', version: '1.0.0', devDependencies: {} }),
    )

    vi.mocked(fs.readFileSync).mockImplementation((filePath) => {
      const p = filePath.toString()
      if (p.includes('templates') && p.includes('policy.yaml')) {
        return POLICY_TEMPLATE_CONTENT
      }
      if (p.includes('templates') && p.includes('config.yaml')) {
        return CONFIG_TEMPLATE_CONTENT
      }
      if (p.includes('package.json')) {
        return CLI_PACKAGE_JSON
      }
      throw Object.assign(new Error(`ENOENT: no such file or directory, open '${p}'`), {
        code: 'ENOENT',
      })
    })

    vi.mocked(confirmAction).mockResolvedValue(true)
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('non-interactive guard (issue #80)', () => {
    it('should fail fast naming --force when policy.yaml exists, stdin is not a TTY, and --force is omitted', async () => {
      vi.mocked(isInteractiveTTY).mockReturnValue(false)
      vi.mocked(fs.existsSync).mockImplementation((filePath) =>
        filePath.toString().endsWith('policy.yaml'),
      )

      await expect(runInit({ dir: DEFAULT_DIR })).rejects.toThrow('process.exit called')

      expect(mockProcessExit).toHaveBeenCalledWith(ExitCode.CONFIG_ERROR)
      expect(mockConsoleError).toHaveBeenCalledWith(
        expect.stringMatching(/Config already exists.*--force/),
      )
      expect(confirmAction).not.toHaveBeenCalled()
      expect(fs.promises.writeFile).not.toHaveBeenCalled()
    })

    it('should proceed without prompting when stdin is not a TTY and --force is set, even if files exist', async () => {
      vi.mocked(isInteractiveTTY).mockReturnValue(false)
      vi.mocked(fs.existsSync).mockReturnValue(true)

      await runInit({ dir: DEFAULT_DIR, force: true })

      expect(confirmAction).not.toHaveBeenCalled()
      expect(fs.promises.writeFile).toHaveBeenCalled()
    })

    it('should not require a TTY when neither config file exists yet', async () => {
      vi.mocked(isInteractiveTTY).mockReturnValue(false)
      vi.mocked(fs.existsSync).mockReturnValue(false)

      await runInit({ dir: DEFAULT_DIR })

      expect(confirmAction).not.toHaveBeenCalled()
      expect(fs.promises.writeFile).toHaveBeenCalled()
    })
  })

  describe('positive cases (default split scaffold)', () => {
    it('should write both policy.yaml and config.yaml from the bundled templates', async () => {
      const { policyPath, operationalPath } = resolvedPaths()

      await runInit({ dir: DEFAULT_DIR })

      expect(fs.promises.writeFile).toHaveBeenCalledWith(
        policyPath,
        POLICY_TEMPLATE_CONTENT,
        'utf-8',
      )
      expect(fs.promises.writeFile).toHaveBeenCalledWith(
        operationalPath,
        CONFIG_TEMPLATE_CONTENT,
        'utf-8',
      )
    })

    it('should create the config directory recursively', async () => {
      const { configDir } = resolvedPaths()

      await runInit({ dir: DEFAULT_DIR })

      expect(fs.promises.mkdir).toHaveBeenCalledWith(configDir, { recursive: true })
    })

    it('should write policy.yaml content that parses as valid YAML with version 1 and empty team/gates', async () => {
      await runInit({ dir: DEFAULT_DIR })

      const content = findWrittenContent('policy.yaml')
      const parsed: unknown = YAML.parse(content)

      expect(parsed).toMatchObject({ version: 1, team: {}, gates: {} })
    })

    it('should write config.yaml content that parses as valid YAML with version 1 and empty suites', async () => {
      await runInit({ dir: DEFAULT_DIR })

      const content = findWrittenContent('config.yaml')
      const parsed: unknown = YAML.parse(content)

      expect(parsed).toMatchObject({ version: 1, suites: {} })
    })

    it('should create package.json when it does not exist', async () => {
      // existsSync('package.json') already false by default beforeEach setup
      await runInit({ dir: DEFAULT_DIR })

      const writeCalls = vi.mocked(fs.promises.writeFile).mock.calls
      const packageJsonWrite = writeCalls.find((c) => c[0].toString() === 'package.json')
      expect(packageJsonWrite).toBeDefined()

      expect(mockConsoleLog).toHaveBeenCalledWith(expect.stringContaining('Created package.json'))
    })

    it('should update package.json with attest-it devDependency when it already exists', async () => {
      vi.mocked(fs.existsSync).mockImplementation((filePath) => filePath === 'package.json')

      await runInit({ dir: DEFAULT_DIR })

      expect(mockConsoleLog).toHaveBeenCalledWith(
        expect.stringContaining('Updated package.json with attest-it devDependency'),
      )

      const writeCalls = vi.mocked(fs.promises.writeFile).mock.calls
      const packageJsonWrite = writeCalls.find((c) => c[0].toString() === 'package.json')
      expect(packageJsonWrite).toBeDefined()
      if (!packageJsonWrite) throw new Error('expected package.json write')
      const content: unknown = packageJsonWrite[1]
      if (typeof content !== 'string') throw new Error('expected string content')
      const packageJson: unknown = JSON.parse(content)
      expect(packageJson).toMatchObject({
        devDependencies: { 'attest-it': expect.stringMatching(/^\^0\.\d+\.\d+$/) },
      })
    })

    it('should not prompt for confirmation when neither file exists', async () => {
      await runInit({ dir: DEFAULT_DIR })

      expect(confirmAction).not.toHaveBeenCalled()
    })

    it('should overwrite existing files without prompting when --force is set', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true)

      await runInit({ dir: DEFAULT_DIR, force: true })

      expect(confirmAction).not.toHaveBeenCalled()
      expect(fs.promises.writeFile).toHaveBeenCalled()
    })

    it('should prompt once per existing file and proceed when confirmed', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true)
      vi.mocked(confirmAction).mockResolvedValue(true)

      const { policyPath, operationalPath } = resolvedPaths()

      await runInit({ dir: DEFAULT_DIR })

      expect(confirmAction).toHaveBeenCalledWith(
        expect.objectContaining({ message: expect.stringContaining(policyPath) }),
      )
      expect(confirmAction).toHaveBeenCalledWith(
        expect.objectContaining({ message: expect.stringContaining(operationalPath) }),
      )
      expect(fs.promises.writeFile).toHaveBeenCalledWith(
        policyPath,
        POLICY_TEMPLATE_CONTENT,
        'utf-8',
      )
    })

    it('should display the "Configuration created" success message', async () => {
      await runInit({ dir: DEFAULT_DIR })

      expect(mockConsoleLog).toHaveBeenCalledWith(expect.stringContaining('Configuration created:'))
    })

    it('should display next steps referencing both config files', async () => {
      const { policyPath, operationalPath } = resolvedPaths()

      await runInit({ dir: DEFAULT_DIR })

      expect(mockConsoleLog).toHaveBeenCalledWith(expect.stringContaining('Next steps:'))
      expect(mockConsoleLog).toHaveBeenCalledWith(expect.stringContaining('install'))
      expect(mockConsoleLog).toHaveBeenCalledWith(
        expect.stringContaining("attest-it identity create  (if you haven't already)"),
      )
      expect(mockConsoleLog).toHaveBeenCalledWith(expect.stringContaining('attest-it team join'))
      expect(mockConsoleLog).toHaveBeenCalledWith(
        expect.stringContaining(`Edit ${policyPath} to define your gates, and ${operationalPath}`),
      )
    })

    it('should offer shell completion install after a successful default scaffold', async () => {
      const { offerCompletionInstall } = await import('../src/utils/completion-offer.js')

      await runInit({ dir: DEFAULT_DIR })

      expect(offerCompletionInstall).toHaveBeenCalledTimes(1)
    })

    it('should detect pnpm from a pnpm-lock.yaml file and mention it in next steps', async () => {
      vi.mocked(fs.existsSync).mockImplementation((filePath) => filePath === 'pnpm-lock.yaml')

      await runInit({ dir: DEFAULT_DIR })

      expect(mockConsoleLog).toHaveBeenCalledWith(expect.stringContaining('pnpm install'))
    })
  })

  describe('negative cases (default split scaffold)', () => {
    it('should exit with CANCELLED when the user declines to overwrite policy.yaml', async () => {
      vi.mocked(fs.existsSync).mockImplementation((filePath) =>
        filePath.toString().endsWith('policy.yaml'),
      )
      vi.mocked(confirmAction).mockResolvedValue(false)

      await expect(runInit({ dir: DEFAULT_DIR })).rejects.toThrow('process.exit called')

      expect(mockProcessExit).toHaveBeenCalledWith(ExitCode.CANCELLED)
      expect(mockConsoleError).toHaveBeenCalledWith(expect.stringContaining('Init cancelled'))
      expect(fs.promises.writeFile).not.toHaveBeenCalled()
    })

    it('should exit with CANCELLED when the user declines to overwrite config.yaml', async () => {
      vi.mocked(fs.existsSync).mockImplementation(
        (filePath) =>
          filePath.toString().endsWith('.attest-it/config.yaml') ||
          filePath.toString().endsWith('.attest-it\\config.yaml'),
      )
      // First confirm (policy.yaml, which doesn't exist) never happens; second
      // confirm (config.yaml, which exists) is declined.
      vi.mocked(confirmAction).mockResolvedValue(false)

      await expect(runInit({ dir: DEFAULT_DIR })).rejects.toThrow('process.exit called')

      expect(mockProcessExit).toHaveBeenCalledWith(ExitCode.CANCELLED)
      expect(mockConsoleError).toHaveBeenCalledWith(expect.stringContaining('Init cancelled'))
      expect(fs.promises.writeFile).not.toHaveBeenCalled()
    })

    it('should exit with CONFIG_ERROR when writing a config file fails', async () => {
      vi.mocked(fs.promises.writeFile).mockRejectedValue(new Error('Permission denied'))

      await expect(runInit({ dir: DEFAULT_DIR })).rejects.toThrow('process.exit called')

      expect(mockProcessExit).toHaveBeenCalledWith(ExitCode.CONFIG_ERROR)
      expect(mockConsoleError).toHaveBeenCalledWith(expect.stringContaining('Permission denied'))
    })

    it('should exit with CONFIG_ERROR when creating the config directory fails', async () => {
      vi.mocked(fs.promises.mkdir).mockRejectedValue(new Error('Cannot create directory'))

      await expect(runInit({ dir: DEFAULT_DIR })).rejects.toThrow('process.exit called')

      expect(mockProcessExit).toHaveBeenCalledWith(ExitCode.CONFIG_ERROR)
      expect(mockConsoleError).toHaveBeenCalledWith(
        expect.stringContaining('Cannot create directory'),
      )
    })

    it('should exit with CONFIG_ERROR and a generic message for non-Error throwables', async () => {
      vi.mocked(fs.promises.writeFile).mockRejectedValue('string error')

      await expect(runInit({ dir: DEFAULT_DIR })).rejects.toThrow('process.exit called')

      expect(mockProcessExit).toHaveBeenCalledWith(ExitCode.CONFIG_ERROR)
      expect(mockConsoleError).toHaveBeenCalledWith(expect.stringContaining('Unknown error'))
    })
  })

  describe('edge cases (default split scaffold)', () => {
    it('should resolve a custom --dir option', async () => {
      const { configDir, policyPath, operationalPath } = resolvedPaths('custom-dir')

      await runInit({ dir: 'custom-dir' })

      expect(fs.promises.mkdir).toHaveBeenCalledWith(configDir, { recursive: true })
      expect(fs.promises.writeFile).toHaveBeenCalledWith(
        policyPath,
        POLICY_TEMPLATE_CONTENT,
        'utf-8',
      )
      expect(fs.promises.writeFile).toHaveBeenCalledWith(
        operationalPath,
        CONFIG_TEMPLATE_CONTENT,
        'utf-8',
      )
    })

    it('should create nested directories', async () => {
      const { configDir } = resolvedPaths('deep/nested/dir')

      await runInit({ dir: 'deep/nested/dir' })

      expect(fs.promises.mkdir).toHaveBeenCalledWith(configDir, { recursive: true })
    })
  })

  describe('--migrate', () => {
    const unifiedContent = 'version: 1\nsettings: {}\nsuites: {}\n'
    const mockPolicy = { version: 1, settings: {}, team: {}, gates: {} }
    const mockOperational = { version: 1, settings: {}, suites: {} }

    beforeEach(() => {
      // Unified config.yaml exists; nothing else does.
      vi.mocked(fs.existsSync).mockImplementation((filePath) =>
        filePath.toString().endsWith('config.yaml'),
      )
      vi.mocked(fs.promises.readFile).mockImplementation((filePath) => {
        if (filePath.toString().endsWith('config.yaml')) {
          return Promise.resolve(unifiedContent)
        }
        return Promise.resolve(
          JSON.stringify({ name: 'test-project', version: '1.0.0', devDependencies: {} }),
        )
      })
      vi.mocked(migrateUnifiedContent).mockReturnValue({
        policy: mockPolicy,
        operational: mockOperational,
        // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- test double for the core migration return shape
      } as ReturnType<typeof migrateUnifiedContent>)
    })

    it('should migrate an existing unified config.yaml into policy.yaml and config.yaml', async () => {
      const { policyPath, operationalPath } = resolvedPaths()

      await runInit({ dir: DEFAULT_DIR, migrate: true })

      expect(migrateUnifiedContent).toHaveBeenCalledWith(unifiedContent, 'yaml')

      const policyContent = findWrittenContent('policy.yaml')
      expect(YAML.parse(policyContent)).toEqual(mockPolicy)
      expect(policyContent).toContain('migrated from unified config')

      const operationalContent = findWrittenContent(path.join('.attest-it', 'config.yaml'))
      expect(YAML.parse(operationalContent)).toEqual(mockOperational)
      expect(operationalContent).toContain('migrated from unified config')
      expect(operationalPath).toBe(path.join(path.resolve(DEFAULT_DIR), 'config.yaml'))
    })

    it('should print migration success and next-step messages', async () => {
      const { policyPath } = resolvedPaths()

      await runInit({ dir: DEFAULT_DIR, migrate: true })

      expect(mockConsoleLog).toHaveBeenCalledWith(
        expect.stringContaining('Migrated unified config into split configuration:'),
      )
      expect(mockConsoleLog).toHaveBeenCalledWith(expect.stringContaining('Next steps:'))
      expect(mockConsoleLog).toHaveBeenCalledWith(
        expect.stringContaining(`Review and commit ${policyPath} on your default branch`),
      )
      expect(mockConsoleLog).toHaveBeenCalledWith(expect.stringContaining('attest-it verify'))
    })

    it('should not offer shell completion install on the migrate path', async () => {
      const { offerCompletionInstall } = await import('../src/utils/completion-offer.js')

      await runInit({ dir: DEFAULT_DIR, migrate: true })

      expect(offerCompletionInstall).not.toHaveBeenCalled()
    })

    it('should exit with CONFIG_ERROR when no unified config.yaml exists to migrate', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(false)

      await expect(runInit({ dir: DEFAULT_DIR, migrate: true })).rejects.toThrow(
        'process.exit called',
      )

      expect(mockProcessExit).toHaveBeenCalledWith(ExitCode.CONFIG_ERROR)
      expect(mockConsoleError).toHaveBeenCalledWith(
        expect.stringContaining('No unified config found'),
      )
      expect(migrateUnifiedContent).not.toHaveBeenCalled()
    })

    it('should exit with CANCELLED when the user declines to overwrite policy.yaml during migration', async () => {
      // Both the unified config.yaml and an existing policy.yaml are present.
      vi.mocked(fs.existsSync).mockReturnValue(true)
      vi.mocked(confirmAction).mockResolvedValue(false)

      await expect(runInit({ dir: DEFAULT_DIR, migrate: true })).rejects.toThrow(
        'process.exit called',
      )

      expect(mockProcessExit).toHaveBeenCalledWith(ExitCode.CANCELLED)
      expect(mockConsoleError).toHaveBeenCalledWith(expect.stringContaining('Migration cancelled'))
      expect(fs.promises.writeFile).not.toHaveBeenCalled()
    })

    it('should skip the overwrite prompt with --force even if policy.yaml exists', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true)

      await runInit({ dir: DEFAULT_DIR, migrate: true, force: true })

      expect(confirmAction).not.toHaveBeenCalled()
      expect(fs.promises.writeFile).toHaveBeenCalled()
    })
  })
})
