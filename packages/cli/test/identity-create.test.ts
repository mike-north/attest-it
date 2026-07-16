/**
 * Tests for `identity create`'s non-interactive flags (issue #80).
 *
 * These drive the real `runCreate` implementation end-to-end against a real
 * temp-directory home (via `setAttestItHomeDir`), so identity files and
 * config are genuinely written and read back -- not mocked away. Key-backend
 * availability checks (1Password/Keychain/YubiKey) are stubbed to simulate a
 * bare CI machine where only the filesystem backend is usable, which is the
 * primary non-interactive use case this issue targets.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { Readable } from 'node:stream'
import {
  setAttestItHomeDir,
  loadLocalConfig,
  OnePasswordKeyProvider,
  MacOSKeychainKeyProvider,
  YubiKeyProvider,
  isEncryptedPrivateKeyPem,
  signEd25519,
  type PrivateKeyRef,
} from '@attest-it/core'
import { runCreate, slugify, deriveUniqueSlug } from '../src/commands/identity/create.js'
import { ExitCode } from '../src/utils/exit-codes.js'

/** Narrow a PrivateKeyRef to the 'file' variant, failing the test clearly if it isn't. */
function expectFilePrivateKey(privateKey: PrivateKeyRef | undefined): {
  type: 'file'
  path: string
} {
  if (privateKey?.type !== 'file') {
    throw new Error(
      `Expected a file-backed private key reference, got: ${JSON.stringify(privateKey)}`,
    )
  }
  return privateKey
}

describe('slugify', () => {
  it('should lowercase and hyphenate a display name', () => {
    expect(slugify('CI Bot')).toBe('ci-bot')
  })

  it('should collapse non-alphanumeric runs into a single hyphen', () => {
    expect(slugify('Jane   Q. Public!!')).toBe('jane-q-public')
  })

  it('should strip leading and trailing hyphens', () => {
    expect(slugify('--Weird Name--')).toBe('weird-name')
  })

  it('should fall back to "identity" when nothing alphanumeric remains', () => {
    expect(slugify('!!!')).toBe('identity')
  })
})

describe('deriveUniqueSlug', () => {
  it('should return the plain slug when there is no collision', () => {
    expect(deriveUniqueSlug('Jane Doe', {})).toBe('jane-doe')
  })

  it('should append -2 on a single collision', () => {
    expect(deriveUniqueSlug('Jane Doe', { 'jane-doe': {} })).toBe('jane-doe-2')
  })

  it('should keep incrementing past multiple collisions', () => {
    expect(
      deriveUniqueSlug('Jane Doe', {
        'jane-doe': {},
        'jane-doe-2': {},
        'jane-doe-3': {},
      }),
    ).toBe('jane-doe-4')
  })

  it('should handle an undefined existing-identities map', () => {
    expect(deriveUniqueSlug('Jane Doe', undefined)).toBe('jane-doe')
  })
})

/** Replace process.stdin with a fake readable stream for the duration of one test. */
function withFakeStdin<T>(content: string, fn: () => Promise<T>): Promise<T> {
  const fake = content.length === 0 ? Readable.from([]) : Readable.from([content])
  const original = process.stdin
  Object.defineProperty(process, 'stdin', { value: fake, configurable: true })
  return fn().finally(() => {
    Object.defineProperty(process, 'stdin', { value: original, configurable: true })
  })
}

describe('runCreate (non-interactive)', () => {
  let tempHome: string
  const originalIsTTY = process.stdin.isTTY
  let mockProcessExit: ReturnType<typeof vi.spyOn>
  let mockConsoleError: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'attest-it-identity-create-'))
    setAttestItHomeDir(tempHome)

    // Simulate a bare CI machine: only the filesystem backend is usable.
    vi.spyOn(OnePasswordKeyProvider, 'isInstalled').mockResolvedValue(false)
    vi.spyOn(MacOSKeychainKeyProvider, 'isAvailable').mockReturnValue(false)
    vi.spyOn(YubiKeyProvider, 'isInstalled').mockResolvedValue(false)

    // Non-interactive by default; individual tests override this.
    Object.defineProperty(process.stdin, 'isTTY', { value: undefined, configurable: true })

    vi.spyOn(console, 'log').mockImplementation(() => undefined)
    mockConsoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mockProcessExit = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called')
    })
  })

  afterEach(() => {
    setAttestItHomeDir(null)
    fs.rmSync(tempHome, { recursive: true, force: true })
    Object.defineProperty(process.stdin, 'isTTY', { value: originalIsTTY, configurable: true })
    vi.restoreAllMocks()
  })

  describe('required flags', () => {
    it('should fail fast naming --name when missing and stdin is not a TTY', async () => {
      await expect(runCreate({ storage: 'file' })).rejects.toThrow('process.exit called')

      expect(mockProcessExit).toHaveBeenCalledWith(ExitCode.CONFIG_ERROR)
      expect(mockConsoleError).toHaveBeenCalledWith(expect.stringContaining('--name'))
    })

    it('should fail fast naming --storage when missing and stdin is not a TTY', async () => {
      await expect(runCreate({ name: 'CI Bot' })).rejects.toThrow('process.exit called')

      expect(mockProcessExit).toHaveBeenCalledWith(ExitCode.CONFIG_ERROR)
      expect(mockConsoleError).toHaveBeenCalledWith(expect.stringContaining('--storage'))
    })

    it('should reject an unknown --storage value', async () => {
      await expect(runCreate({ name: 'CI Bot', storage: 'floppy-disk' })).rejects.toThrow(
        'process.exit called',
      )

      expect(mockConsoleError).toHaveBeenCalledWith(
        expect.stringContaining('Unknown --storage value'),
      )
    })

    it('should reject --storage keychain when macOS Keychain is unavailable', async () => {
      await expect(
        runCreate({ name: 'CI Bot', storage: 'keychain', slug: 'ci-bot' }),
      ).rejects.toThrow('process.exit called')

      expect(mockConsoleError).toHaveBeenCalledWith(
        expect.stringContaining('macOS Keychain is not available'),
      )
    })
  })

  describe('successful non-interactive creation (--storage file)', () => {
    it('should create an identity with zero prompts given --name, --storage, and --slug', async () => {
      await runCreate({
        name: 'CI Bot',
        slug: 'ci-bot',
        email: 'ci-bot@example.com',
        github: 'ci-bot-gh',
        storage: 'file',
      })

      const config = await loadLocalConfig()
      expect(config).not.toBeNull()
      expect(config?.activeIdentity).toBe('ci-bot')
      const identity = config?.identities['ci-bot']
      expect(identity).toMatchObject({
        name: 'CI Bot',
        email: 'ci-bot@example.com',
        github: 'ci-bot-gh',
      })
      expect(identity?.privateKey.type).toBe('file')
      expect(mockProcessExit).not.toHaveBeenCalled()
    })

    it('should auto-derive a slug from --name when --slug is omitted', async () => {
      await runCreate({ name: 'Jane Q. Public', storage: 'file' })

      const config = await loadLocalConfig()
      expect(config?.activeIdentity).toBe('jane-q-public')
      expect(config?.identities['jane-q-public']).toBeDefined()
    })

    it('should default email and github to unset when omitted non-interactively', async () => {
      await runCreate({ name: 'CI Bot', storage: 'file' })

      const config = await loadLocalConfig()
      const identity = config?.identities['ci-bot']
      expect(identity?.email).toBeUndefined()
      expect(identity?.github).toBeUndefined()
    })

    it('should fail with a clear error when --slug collides with an existing identity', async () => {
      await runCreate({ name: 'CI Bot', slug: 'ci-bot', storage: 'file' })
      mockProcessExit.mockClear()

      await expect(
        runCreate({ name: 'Another Bot', slug: 'ci-bot', storage: 'file' }),
      ).rejects.toThrow('process.exit called')

      expect(mockConsoleError).toHaveBeenCalledWith(expect.stringContaining('already exists'))
    })
  })

  describe('--passphrase-stdin', () => {
    it('should encrypt the private key file using a passphrase piped via stdin', async () => {
      await withFakeStdin('super-secret-passphrase\n', () =>
        runCreate({
          name: 'CI Bot',
          slug: 'ci-bot',
          storage: 'file',
          passphraseStdin: true,
        }),
      )

      const config = await loadLocalConfig()
      const identity = config?.identities['ci-bot']
      const filePath = expectFilePrivateKey(identity?.privateKey).path
      const pem = fs.readFileSync(filePath, 'utf8')

      expect(isEncryptedPrivateKeyPem(pem)).toBe(true)
      // Round-trip: the encrypted key must actually be usable with the passphrase.
      const signature = signEd25519('some data', pem, 'super-secret-passphrase')
      expect(typeof signature).toBe('string')
    })

    it('should fail fast when --passphrase-stdin is set but stdin is empty', async () => {
      await withFakeStdin('', async () => {
        await expect(
          runCreate({ name: 'CI Bot', slug: 'ci-bot', storage: 'file', passphraseStdin: true }),
        ).rejects.toThrow('process.exit called')
      })

      expect(mockConsoleError).toHaveBeenCalledWith(expect.stringContaining('stdin was empty'))
    })

    it('should leave the private key unencrypted when --passphrase-stdin is not set', async () => {
      await runCreate({ name: 'CI Bot', slug: 'ci-bot', storage: 'file' })

      const config = await loadLocalConfig()
      const identity = config?.identities['ci-bot']
      const filePath = expectFilePrivateKey(identity?.privateKey).path
      const pem = fs.readFileSync(filePath, 'utf8')

      expect(isEncryptedPrivateKeyPem(pem)).toBe(false)
    })
  })
})
