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
  beforeEach(() => vi.clearAllMocks())
  afterEach(() => vi.clearAllMocks())

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
