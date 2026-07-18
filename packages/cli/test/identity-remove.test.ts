/**
 * Tests for `identity remove`.
 *
 * Regression (issue #94): deleting a legacy (`type: 'filesystem'`) identity's
 * private key called `unlink` with the raw stored path, so a hand-edited v1
 * config carrying a `~`-prefixed path (e.g. `~/attest-it/private.pem`)
 * silently failed to delete the real file -- Node's fs APIs don't perform
 * shell tilde expansion. The path must be resolved before `unlink`,
 * mirroring the same fix in `LegacyFilesystemKeyProvider`.
 *
 * Regression (issue #101): `identity remove <slug> --yes` reported success
 * and exited 0 without deleting the underlying VaultKeeper-backed secret --
 * only the `config.yaml` entry was removed, leaving the encrypted
 * private-key `.enc` file on disk indefinitely. See the "VaultKeeper `file`
 * secrets" and "cannot auto-delete externally-managed backends" describe
 * blocks below.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as os from 'node:os'
import * as path from 'node:path'
import { unlink, mkdtemp, readdir, rm } from 'node:fs/promises'
import type { LocalConfig } from '@attest-it/core'
import { ExitCode } from '../src/utils/exit-codes.js'

vi.mock('node:fs/promises', async () => {
  const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
  return {
    ...actual,
    // Only `unlink` is mocked (and asserted on) by the legacy-filesystem
    // tests below. Every other fs function passes through to the real
    // implementation so the VaultKeeper `file`-backend tests can exercise
    // real files on disk.
    unlink: vi.fn().mockResolvedValue(undefined),
  }
})

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
const mockConsoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {
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

const { loadLocalConfig, saveLocalConfig, storePrivateKey } = await import('@attest-it/core')
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

const SAMPLE_PEM = `-----BEGIN PRIVATE KEY-----
MC4CAQAwBQYDK2VwBCIEIJ0yoMOEeaMjH9BXmKmBFH32eysYFkBZMhJRbqsZjzax
-----END PRIVATE KEY-----
`

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
    // Only one confirmation now: deleting the key defaults to "on" and is
    // no longer gated behind a second interactive prompt (issue #101).
    vi.mocked(confirm).mockResolvedValueOnce(true)
    const home = os.homedir()

    await runRemove('alice')

    expect(unlink).toHaveBeenCalledWith(`${home}/attest-it/private.pem`)
    // The message shown to the user still displays the original, readable form.
    expect(mockConsoleLog).toHaveBeenCalledWith(expect.stringContaining('~/attest-it/private.pem'))
  })

  it('deletes a legacy filesystem key path with no leading ~ unchanged', async () => {
    vi.mocked(loadLocalConfig).mockResolvedValue(mockLocalConfig())
    vi.mocked(confirm).mockResolvedValueOnce(true)

    await runRemove('bob')

    expect(unlink).toHaveBeenCalledWith('/tmp/bob.pem')
  })

  it('does not delete the key file when --keep-key is passed', async () => {
    vi.mocked(loadLocalConfig).mockResolvedValue(mockLocalConfig())
    vi.mocked(confirm).mockResolvedValueOnce(true)

    await runRemove('alice', { keepKey: true })

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

  it('removes non-interactively with --yes, deleting the private key by default (issue #101)', async () => {
    vi.mocked(loadLocalConfig).mockResolvedValue(mockLocalConfig())

    await runRemove('bob', { yes: true })

    expect(confirm).not.toHaveBeenCalled()
    expect(unlink).toHaveBeenCalledWith('/tmp/bob.pem') // default is to delete the key material
    expect(saveLocalConfig).toHaveBeenCalled()
    expect(mockProcessExit).not.toHaveBeenCalled()
  })

  it('--yes with --keep-key skips key deletion, still without prompting', async () => {
    vi.mocked(loadLocalConfig).mockResolvedValue(mockLocalConfig())

    await runRemove('bob', { yes: true, keepKey: true })

    expect(confirm).not.toHaveBeenCalled()
    expect(unlink).not.toHaveBeenCalled()
    expect(saveLocalConfig).toHaveBeenCalled()
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

// Regression coverage for issue #133: removing the *last* identity deleted
// the private key from storage first, then failed the "cannot remove last
// identity" guard -- leaving an orphaned config entry pointing at key
// material that no longer existed. The guard must run, and refuse, before
// any destructive delete. Against the pre-fix implementation this test
// fails: `unlink` (the legacy-filesystem deletion path) is called even
// though the removal is ultimately refused.
describe('identity remove — refuses the last identity before deleting its key (issue #133)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.defineProperty(process.stdin, 'isTTY', { value: undefined, configurable: true })
  })
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('does not delete the private key when the removal is refused as the last identity', async () => {
    vi.mocked(loadLocalConfig).mockResolvedValue(
      mockLocalConfig({
        activeIdentity: 'alice',
        identities: {
          alice: {
            name: 'Alice',
            publicKey: 'pk-alice',
            privateKey: { type: 'filesystem', path: '/tmp/alice.pem' },
          },
        },
      }),
    )

    await runRemove('alice', { yes: true })

    expect(unlink).not.toHaveBeenCalled()
    expect(saveLocalConfig).not.toHaveBeenCalled()
    expect(mockConsoleError).toHaveBeenCalledWith(
      expect.stringContaining('Cannot remove last identity'),
    )
    expect(mockProcessExit).toHaveBeenCalledWith(ExitCode.CONFIG_ERROR)
  })
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

// Regression coverage for issue #101: `identity remove <slug> --yes` reported
// success and exited 0 without deleting the underlying VaultKeeper-managed
// secret -- only the config.yaml entry was removed, leaving the encrypted
// private-key `.enc` file on disk indefinitely. This test stores a real
// secret via the real VaultKeeper `file` backend (redirected to a temp
// directory via `VAULTKEEPER_CONFIG_DIR`), then asserts -- via a genuine
// before/after diff of the backend's on-disk store -- that `identity remove`
// deletes exactly that secret's `.enc` file. Against the pre-fix
// implementation (which only logged an inert "use the VaultKeeper CLI" note
// and never called any deletion API) this test fails: the `.enc` file for
// the removed identity is still present in `after`.
describe('identity remove — deletes VaultKeeper `file` secrets by default (issue #101)', () => {
  let configDir: string
  const originalConfigDir = process.env.VAULTKEEPER_CONFIG_DIR

  beforeEach(async () => {
    vi.clearAllMocks()
    Object.defineProperty(process.stdin, 'isTTY', { value: undefined, configurable: true })
    configDir = await mkdtemp(path.join(os.tmpdir(), 'attest-it-identity-remove-'))
    process.env.VAULTKEEPER_CONFIG_DIR = configDir
  })

  afterEach(async () => {
    vi.clearAllMocks()
    if (originalConfigDir === undefined) {
      delete process.env.VAULTKEEPER_CONFIG_DIR
    } else {
      process.env.VAULTKEEPER_CONFIG_DIR = originalConfigDir
    }
    await rm(configDir, { recursive: true, force: true })
  })

  it('deletes the underlying .enc secret file, not just the config entry', async () => {
    const { secretId } = await storePrivateKey('file', SAMPLE_PEM, 'carol')

    vi.mocked(loadLocalConfig).mockResolvedValue(
      mockLocalConfig({
        activeIdentity: 'bob',
        identities: {
          carol: {
            name: 'Carol',
            publicKey: 'pk-carol',
            privateKey: { type: 'file', id: secretId },
          },
          bob: {
            name: 'Bob',
            publicKey: 'pk-bob',
            privateKey: { type: 'filesystem', path: '/tmp/bob.pem' },
          },
        },
      }),
    )

    const storeDir = path.join(configDir, 'file')
    const before = await readdir(storeDir)
    // Sanity check: the secret really is on disk before removal, and the
    // stored filename is the hex-encoded secret id -- matching the
    // reproduction in issue #101 ("filenames hex-decode to
    // attest-it-<display name>-<uuid>").
    const secretFilename = `${Buffer.from(secretId, 'utf8').toString('hex')}.enc`
    expect(before).toContain(secretFilename)

    await runRemove('carol', { yes: true })

    const after = await readdir(storeDir)
    expect(after).not.toContain(secretFilename)

    // Before/after diff: exactly the removed identity's secret is gone;
    // nothing else in the store (e.g. the backend's own wrap key file) was
    // touched.
    const removedFiles = before.filter((f) => !after.includes(f))
    expect(removedFiles).toEqual([secretFilename])

    expect(saveLocalConfig).toHaveBeenCalled()
    expect(mockConsoleLog).toHaveBeenCalledWith(expect.stringContaining('Deleted private key'))
  })
})

// Regression coverage for issue #101: for backends attest-it cannot
// unilaterally delete from (1Password, macOS Keychain, YubiKey), the
// pre-fix code logged an inert note pointing at a nonexistent "VaultKeeper
// CLI" and still reported `Identity "<slug>" removed` as an unqualified
// success -- silently implying full cleanup. The fix must always print an
// explicit, actionable warning (never hidden behind the success message)
// whenever key material remains.
describe('identity remove — cannot auto-delete externally-managed backends (issue #101)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.defineProperty(process.stdin, 'isTTY', { value: undefined, configurable: true })
  })
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('prints an actionable warning for a 1Password-backed key instead of silently leaving it', async () => {
    vi.mocked(loadLocalConfig).mockResolvedValue(
      mockLocalConfig({
        activeIdentity: 'bob',
        identities: {
          dave: {
            name: 'Dave',
            publicKey: 'pk-dave',
            privateKey: { type: '1password', id: 'attest-it-dave-secret-id', vault: 'Private' },
          },
          bob: {
            name: 'Bob',
            publicKey: 'pk-bob',
            privateKey: { type: 'filesystem', path: '/tmp/bob.pem' },
          },
        },
      }),
    )

    await runRemove('dave', { yes: true })

    // Explicit, actionable warning -- names the secret id and gives a
    // concrete removal command, not just "it wasn't deleted".
    expect(mockConsoleWarn).toHaveBeenCalledWith(expect.stringContaining('NOT deleted'))
    expect(mockConsoleLog).toHaveBeenCalledWith(expect.stringContaining('attest-it-dave-secret-id'))
    expect(mockConsoleLog).toHaveBeenCalledWith(expect.stringContaining('op item delete'))

    // The identity entry is still removed from config -- this is not a
    // failure of the `remove` operation, only of automatic key cleanup.
    expect(saveLocalConfig).toHaveBeenCalled()
    expect(mockProcessExit).not.toHaveBeenCalled()
  })

  it('prints an actionable warning for a macOS Keychain-backed key instead of silently leaving it', async () => {
    vi.mocked(loadLocalConfig).mockResolvedValue(
      mockLocalConfig({
        activeIdentity: 'bob',
        identities: {
          erin: {
            name: 'Erin',
            publicKey: 'pk-erin',
            privateKey: { type: 'keychain', id: 'attest-it-erin-secret-id' },
          },
          bob: {
            name: 'Bob',
            publicKey: 'pk-bob',
            privateKey: { type: 'filesystem', path: '/tmp/bob.pem' },
          },
        },
      }),
    )

    await runRemove('erin', { yes: true })

    expect(mockConsoleWarn).toHaveBeenCalledWith(expect.stringContaining('NOT deleted'))
    expect(mockConsoleLog).toHaveBeenCalledWith(expect.stringContaining('attest-it-erin-secret-id'))
    expect(saveLocalConfig).toHaveBeenCalled()
  })
})
