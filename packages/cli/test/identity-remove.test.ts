/**
 * Tests for `identity remove`.
 *
 * Regression: deleting a legacy (`type: 'filesystem'`) identity's private key
 * called `unlink` with the raw stored path, so a hand-edited v1 config
 * carrying a `~`-prefixed path (e.g. `~/attest-it/private.pem`) silently
 * failed to delete the real file -- Node's fs APIs don't perform shell tilde
 * expansion. The path must be resolved before `unlink`, mirroring the same
 * fix in `LegacyFilesystemKeyProvider`.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as os from 'node:os'
import { unlink } from 'node:fs/promises'
import type { LocalConfig } from '@attest-it/core'
import { ExitCode } from '../src/utils/exit-codes.js'

vi.mock('node:fs/promises', () => ({
  unlink: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@inquirer/prompts', () => ({
  confirm: vi.fn(),
}))

vi.mock('@attest-it/core', async () => {
  const actual = await vi.importActual<typeof import('@attest-it/core')>('@attest-it/core')
  return {
    ...actual,
    loadLocalConfig: vi.fn(),
    saveLocalConfig: vi.fn(),
  }
})

const mockConsoleLog = vi.spyOn(console, 'log').mockImplementation(() => {
  // Intentionally empty
})
const mockConsoleError = vi.spyOn(console, 'error').mockImplementation(() => {
  // Intentionally empty
})
const mockProcessExit = vi
  .spyOn(process, 'exit')
  // @ts-expect-error - Mocking process.exit which has a complex signature
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  .mockImplementation(() => {})

const { loadLocalConfig, saveLocalConfig } = await import('@attest-it/core')
const { confirm } = await import('@inquirer/prompts')
const { runRemove } = await import('../src/commands/identity/remove.js')

function mockLocalConfig(overrides?: Partial<LocalConfig>): LocalConfig {
  return {
    version: 2,
    activeIdentity: 'alice',
    identities: {
      alice: {
        name: 'Alice',
        publicKey: 'pk-alice',
        privateKey: { type: 'filesystem', path: '~/attest-it/private.pem' },
      },
      bob: {
        name: 'Bob',
        publicKey: 'pk-bob',
        privateKey: { type: 'filesystem', path: '/tmp/bob.pem' },
      },
    },
    ...overrides,
  }
}

describe('identity remove', () => {
  const originalIsTTY = process.stdin.isTTY

  beforeEach(() => {
    vi.clearAllMocks()
    // Most of these tests exercise the interactive confirmation prompts,
    // only reachable with an interactive TTY (see issue #94's TTY guard).
    // The dedicated non-interactive describe blocks below override this
    // per-test.
    Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true })
  })
  afterEach(() => {
    vi.clearAllMocks()
    Object.defineProperty(process.stdin, 'isTTY', { value: originalIsTTY, configurable: true })
  })

  it('resolves a leading ~ in a legacy filesystem key path before deleting it', async () => {
    vi.mocked(loadLocalConfig).mockResolvedValue(mockLocalConfig())
    vi.mocked(confirm).mockResolvedValueOnce(true).mockResolvedValueOnce(true)
    const home = os.homedir()

    await runRemove('alice')

    expect(unlink).toHaveBeenCalledWith(`${home}/attest-it/private.pem`)
    // The message shown to the user still displays the original, readable form.
    expect(mockConsoleLog).toHaveBeenCalledWith(expect.stringContaining('~/attest-it/private.pem'))
  })

  it('deletes a legacy filesystem key path with no leading ~ unchanged', async () => {
    vi.mocked(loadLocalConfig).mockResolvedValue(mockLocalConfig())
    vi.mocked(confirm).mockResolvedValueOnce(true).mockResolvedValueOnce(true)

    await runRemove('bob')

    expect(unlink).toHaveBeenCalledWith('/tmp/bob.pem')
  })

  it('does not delete the key file when the user declines', async () => {
    vi.mocked(loadLocalConfig).mockResolvedValue(mockLocalConfig())
    vi.mocked(confirm).mockResolvedValueOnce(true).mockResolvedValueOnce(false)

    await runRemove('alice')

    expect(unlink).not.toHaveBeenCalled()
    expect(saveLocalConfig).toHaveBeenCalled()
  })
})

// Regression coverage for issue #94: `identity remove` had no non-interactive
// flag at all, and handing a closed/piped stdin directly to `confirm()`
// either hung (an unclosed pipe) or produced a ~20MB runaway
// terminal-escape-code render loop (a pipe that does close, e.g. `yes |`).
describe('identity remove — non-interactive (--yes) (issue #94)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.defineProperty(process.stdin, 'isTTY', { value: undefined, configurable: true })
  })
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('removes non-interactively with --yes, never invoking the prompt library', async () => {
    vi.mocked(loadLocalConfig).mockResolvedValue(mockLocalConfig())

    await runRemove('bob', { yes: true })

    expect(confirm).not.toHaveBeenCalled()
    expect(unlink).not.toHaveBeenCalled() // --delete-key not given: safer default
    expect(saveLocalConfig).toHaveBeenCalled()
    expect(mockProcessExit).not.toHaveBeenCalled()
  })

  it('--yes with --delete-key also deletes the private key file, still without prompting', async () => {
    vi.mocked(loadLocalConfig).mockResolvedValue(mockLocalConfig())

    await runRemove('bob', { yes: true, deleteKey: true })

    expect(confirm).not.toHaveBeenCalled()
    expect(unlink).toHaveBeenCalledWith('/tmp/bob.pem')
  })

  it(
    'fails fast naming --yes when no flag is given and stdin is not a TTY ' +
      '(never invokes the prompt library, bounded output)',
    async () => {
      vi.mocked(loadLocalConfig).mockResolvedValue(mockLocalConfig())

      await runRemove('bob')

      expect(confirm).not.toHaveBeenCalled()
      expect(unlink).not.toHaveBeenCalled()
      expect(saveLocalConfig).not.toHaveBeenCalled()
      expect(mockConsoleError).toHaveBeenCalledWith(expect.stringContaining('--yes'))
      expect(mockProcessExit).toHaveBeenCalledWith(ExitCode.CONFIG_ERROR)
    },
  )
})

// Regression coverage for issue #95: exit code 3 (CONFIG_ERROR) was
// overloaded to also cover a force-closed/interrupted prompt, surfacing
// @inquirer/core's raw "User force closed the prompt with 0 null" message.
describe('identity remove — cancelled prompt maps to CANCELLED, not CONFIG_ERROR (issue #95)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true })
  })
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('maps a force-closed prompt to a clean "Cancelled" message and exit code 4', async () => {
    vi.mocked(loadLocalConfig).mockResolvedValue(mockLocalConfig())
    const rawInquirerMessage = 'User force closed the prompt with 0 null'
    const exitPromptError = new Error(rawInquirerMessage)
    exitPromptError.name = 'ExitPromptError'
    vi.mocked(confirm).mockRejectedValueOnce(exitPromptError)

    await runRemove('bob')

    expect(mockConsoleLog).toHaveBeenCalledWith('Cancelled')
    expect(mockConsoleError).not.toHaveBeenCalledWith(expect.stringContaining(rawInquirerMessage))
    expect(mockProcessExit).toHaveBeenCalledWith(ExitCode.CANCELLED)
  })
})
