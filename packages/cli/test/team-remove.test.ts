/**
 * Tests for `team remove`'s non-interactive flag and cancellation handling
 * (issues #94/#95).
 *
 * Regression: unlike `team add`/`join`, `team remove` already had a `--force`
 * flag, but the confirmation prompt below it called `confirm()` directly
 * whenever `--force` was omitted -- with no check that stdin was actually an
 * interactive TTY. A closed/piped stdin without `--force` either hung or
 * produced a runaway render loop, the exact class of bug #94 fixed for
 * `identity remove`.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { runRemove } from '../src/commands/team/remove.js'
import * as core from '@attest-it/core'
import type { PolicyConfig } from '@attest-it/core'
import * as fs from 'node:fs/promises'
import * as prompts from '@inquirer/prompts'
import { parseDocument, stringify as stringifyYaml } from 'yaml'
import { ExitCode } from '../src/utils/exit-codes.js'

vi.mock('@attest-it/core', async () => {
  const actual = await vi.importActual<typeof import('@attest-it/core')>('@attest-it/core')
  return {
    ...actual,
    findPolicyPath: vi.fn(),
    loadEditablePolicy: vi.fn(),
    readSealsSync: vi.fn(),
  }
})

vi.mock('node:fs/promises', () => ({
  writeFile: vi.fn(),
}))

vi.mock('node:fs', () => ({
  readFileSync: vi.fn(() => ''),
}))

vi.mock('@inquirer/prompts', () => ({
  confirm: vi.fn(),
}))

const mockConsoleLog = vi.spyOn(console, 'log').mockImplementation(() => undefined)
const mockConsoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
const mockProcessExit = vi.spyOn(process, 'exit').mockImplementation(() => {
  throw new Error('process.exit called')
})

/**
 * `loadEditablePolicy` is mocked directly (rather than the lower-level
 * `parsePolicyContent`) because it now owns parsing *and* keeps a parsed YAML
 * `Document` around for comment-preserving writes -- the real
 * `serializeEditablePolicy` (unmocked) is exercised against that document, so
 * the backing document is seeded from `stringifyYaml(policy)` to match what a
 * real read of `path` would have produced.
 */
function mockPolicy(policy: PolicyConfig, path = '/test/policy.yaml'): void {
  vi.mocked(core.findPolicyPath).mockReturnValue(path)
  vi.mocked(core.loadEditablePolicy).mockReturnValue({
    policy,
    path,
    format: 'yaml',
    document: parseDocument(stringifyYaml(policy)),
  })
}

const BASE_POLICY: PolicyConfig = {
  version: 1,
  settings: {
    maxAgeDays: 30,
    publicKeyPath: '.attest-it/pubkey.pem',
    attestationsPath: '.attest-it/attestations.json',
    sealsPath: '.attest-it/seals.json',
  },
  team: {
    alice: { name: 'Alice', publicKey: 'pk-alice', publicKeyAlgorithm: 'ed25519' },
  },
  gates: {},
}

describe('team remove command', () => {
  const originalIsTTY = process.stdin.isTTY

  beforeEach(() => {
    mockConsoleLog.mockClear()
    mockConsoleError.mockClear()
    mockProcessExit.mockClear()
    vi.clearAllMocks()
    mockPolicy(structuredClone(BASE_POLICY))
    vi.mocked(core.readSealsSync).mockReturnValue({ version: 1, seals: {} })
    Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true })
  })

  afterEach(() => {
    Object.defineProperty(process.stdin, 'isTTY', { value: originalIsTTY, configurable: true })
  })

  it('removes the member after an interactive confirmation', async () => {
    vi.mocked(prompts.confirm).mockResolvedValue(true)

    await runRemove('alice', {})

    expect(fs.writeFile).toHaveBeenCalled()
    expect(mockConsoleLog).toHaveBeenCalledWith(expect.stringContaining('removed successfully'))
  })

  it('exits CANCELLED (not CONFIG_ERROR) when the user declines', async () => {
    vi.mocked(prompts.confirm).mockResolvedValue(false)

    await expect(runRemove('alice', {})).rejects.toThrow('process.exit called')

    expect(fs.writeFile).not.toHaveBeenCalled()
    expect(mockProcessExit).toHaveBeenCalledWith(ExitCode.CANCELLED)
  })

  describe('non-interactive (--force) (issue #94)', () => {
    beforeEach(() => {
      Object.defineProperty(process.stdin, 'isTTY', { value: undefined, configurable: true })
    })

    it('removes non-interactively with --force, never invoking the prompt library', async () => {
      await runRemove('alice', { force: true })

      expect(prompts.confirm).not.toHaveBeenCalled()
      expect(fs.writeFile).toHaveBeenCalled()
    })

    it(
      'fails fast naming --force when no flag is given and stdin is not a TTY ' +
        '(never invokes the prompt library)',
      async () => {
        await expect(runRemove('alice', {})).rejects.toThrow('process.exit called')

        expect(prompts.confirm).not.toHaveBeenCalled()
        expect(fs.writeFile).not.toHaveBeenCalled()
        expect(mockConsoleError).toHaveBeenCalledWith(expect.stringContaining('--force'))
        expect(mockProcessExit).toHaveBeenCalledWith(ExitCode.CONFIG_ERROR)
      },
    )
  })

  describe('cancelled prompt maps to CANCELLED, not CONFIG_ERROR (issue #95)', () => {
    it('maps a force-closed prompt to a clean message and exit code 4', async () => {
      const exitPromptError = new Error('User force closed the prompt with 0 null')
      exitPromptError.name = 'ExitPromptError'
      vi.mocked(prompts.confirm).mockRejectedValueOnce(exitPromptError)

      await expect(runRemove('alice', {})).rejects.toThrow('process.exit called')

      expect(mockConsoleLog).toHaveBeenCalledWith('Cancelled')
      expect(mockConsoleError).not.toHaveBeenCalledWith(
        expect.stringContaining('force closed the prompt'),
      )
      expect(mockProcessExit).toHaveBeenCalledWith(ExitCode.CANCELLED)
    })
  })
})
