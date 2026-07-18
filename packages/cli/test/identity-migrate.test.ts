/**
 * Tests for `identity migrate` (issue #107).
 *
 * These drive the real `runMigrate` implementation end-to-end against a real
 * temp-directory home (via `setAttestItHomeDir`) and a real VaultKeeper
 * `file` backend (redirected to the same temp directory via
 * `VAULTKEEPER_CONFIG_DIR` -- issue #114's test-isolation guard). Nothing
 * about config read/write, key storage, or signing is mocked: a legacy PEM
 * file is written directly to disk (mirroring a hand-migrated v1 identity),
 * `runMigrate` imports it into VaultKeeper, and the resulting identity is
 * verified to actually sign with its recorded public key.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {
  setAttestItHomeDir,
  saveLocalConfig,
  loadLocalConfig,
  generateEd25519KeyPair,
  isEncryptedPrivateKeyPem,
  signEd25519,
  verifyEd25519,
  KeyProviderRegistry,
  type LocalConfig,
  type PrivateKeyRef,
} from '@attest-it/core'
import { runMigrate, findLegacyIdentities } from '../src/commands/identity/migrate.js'
import { ExitCode } from '../src/utils/exit-codes.js'

/** Narrow a PrivateKeyRef to the v2 'file' variant, failing the test clearly if it isn't. */
function expectFilePrivateKey(privateKey: PrivateKeyRef | undefined): {
  type: 'file'
  id: string
} {
  if (privateKey?.type !== 'file') {
    throw new Error(
      `Expected a file-backed private key reference, got: ${JSON.stringify(privateKey)}`,
    )
  }
  return privateKey
}

/** Retrieve the PEM stored for a v2 file-backed key via the real VaultKeeper filesystem provider. */
async function readStoredFilePem(privateKey: PrivateKeyRef | undefined): Promise<string> {
  const ref = expectFilePrivateKey(privateKey)
  const provider = KeyProviderRegistry.create({ type: 'filesystem', options: {} })
  const result = await provider.getPrivateKey(ref.id)
  try {
    return await fs.promises.readFile(result.keyPath, 'utf8')
  } finally {
    await result.cleanup()
  }
}

describe('identity migrate', () => {
  let tempHome: string
  let legacyKeysDir: string
  const originalIsTTY = process.stdin.isTTY
  const originalVaultKeeperConfigDir = process.env.VAULTKEEPER_CONFIG_DIR
  const originalPassphraseEnv = process.env.ATTEST_IT_KEY_PASSPHRASE
  let mockProcessExit: ReturnType<typeof vi.spyOn>
  let mockConsoleLog: ReturnType<typeof vi.spyOn>
  let mockConsoleError: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'attest-it-identity-migrate-'))
    legacyKeysDir = fs.mkdtempSync(path.join(os.tmpdir(), 'attest-it-identity-migrate-legacy-'))
    setAttestItHomeDir(tempHome)
    process.env.VAULTKEEPER_CONFIG_DIR = tempHome

    // Non-interactive by default; individual tests override this.
    Object.defineProperty(process.stdin, 'isTTY', { value: undefined, configurable: true })

    mockConsoleLog = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    mockConsoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    mockProcessExit = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called')
    })
  })

  afterEach(() => {
    setAttestItHomeDir(null)
    if (originalVaultKeeperConfigDir === undefined) {
      delete process.env.VAULTKEEPER_CONFIG_DIR
    } else {
      process.env.VAULTKEEPER_CONFIG_DIR = originalVaultKeeperConfigDir
    }
    if (originalPassphraseEnv === undefined) {
      delete process.env.ATTEST_IT_KEY_PASSPHRASE
    } else {
      process.env.ATTEST_IT_KEY_PASSPHRASE = originalPassphraseEnv
    }
    fs.rmSync(tempHome, { recursive: true, force: true })
    fs.rmSync(legacyKeysDir, { recursive: true, force: true })
    Object.defineProperty(process.stdin, 'isTTY', { value: originalIsTTY, configurable: true })
    vi.restoreAllMocks()
  })

  /** Write a legacy v1-style identity (raw PEM file + `type: 'filesystem'` config entry). */
  async function seedLegacyIdentity(
    slug: string,
    options: { passphrase?: string } = {},
  ): Promise<{ keyPath: string; publicKey: string }> {
    const keyPair = generateEd25519KeyPair(
      options.passphrase !== undefined ? { passphrase: options.passphrase } : {},
    )
    const keyPath = path.join(legacyKeysDir, `${slug}.pem`)
    fs.writeFileSync(keyPath, keyPair.privateKey, { mode: 0o600 })

    const existing = await loadLocalConfig()
    const config: LocalConfig = {
      version: 2,
      activeIdentity: existing?.activeIdentity ?? slug,
      identities: {
        ...existing?.identities,
        [slug]: {
          name: slug,
          publicKey: keyPair.publicKey,
          privateKey: { type: 'filesystem', path: keyPath },
        },
      },
    }
    await saveLocalConfig(config)
    return { keyPath, publicKey: keyPair.publicKey }
  }

  describe('successful migration (issue #107 AC: sign works after, legacy file gone)', () => {
    it('imports the key into VaultKeeper, verifies a real sign/verify round-trip, and deletes the legacy file', async () => {
      const { keyPath, publicKey } = await seedLegacyIdentity('alice')

      await runMigrate(undefined, { yes: true, storage: 'file' })

      const config = await loadLocalConfig()
      const identity = config?.identities['alice']
      expect(identity?.privateKey.type).toBe('file')

      // The migrated identity's public key must be unchanged -- it's the
      // same keypair, just relocated storage.
      expect(identity?.publicKey).toBe(publicKey)

      // Signing actually works with the new VaultKeeper-backed key.
      const pem = await readStoredFilePem(identity?.privateKey)
      const signature = signEd25519('post-migration message', pem)
      expect(verifyEd25519('post-migration message', signature, publicKey)).toBe(true)

      // The legacy file was deleted only after verification succeeded.
      expect(fs.existsSync(keyPath)).toBe(false)

      expect(mockConsoleLog).toHaveBeenCalledWith(expect.stringContaining('Deleted legacy'))
      expect(mockProcessExit).not.toHaveBeenCalled()
    })

    it('no longer reports the identity as legacy in the migrated config record', async () => {
      await seedLegacyIdentity('bob')

      await runMigrate(undefined, { yes: true, storage: 'file' })

      const config = await loadLocalConfig()
      // `identity list`/`show` key off `privateKey.type` -- 'filesystem' is
      // the only value that renders as "(legacy)"; anything else (here,
      // 'file') flows through the normal v2 VaultKeeper display path.
      expect(config?.identities['bob']?.privateKey.type).not.toBe('filesystem')
    })

    it('keeps the legacy file when --keep-files is passed', async () => {
      const { keyPath } = await seedLegacyIdentity('carol')

      await runMigrate(undefined, { yes: true, storage: 'file', keepFiles: true })

      expect(fs.existsSync(keyPath)).toBe(true)
      const config = await loadLocalConfig()
      expect(config?.identities['carol']?.privateKey.type).toBe('file')
    })
  })

  describe('passphrase-protected legacy keys (issue #107 AC)', () => {
    it('migrates a passphrase-encrypted legacy key using ATTEST_IT_KEY_PASSPHRASE non-interactively', async () => {
      const { keyPath, publicKey } = await seedLegacyIdentity('dave', {
        passphrase: 'super-secret-passphrase',
      })
      process.env.ATTEST_IT_KEY_PASSPHRASE = 'super-secret-passphrase'

      await runMigrate(undefined, { yes: true, storage: 'file' })

      const config = await loadLocalConfig()
      const identity = config?.identities['dave']
      expect(identity?.privateKey.type).toBe('file')

      const pem = await readStoredFilePem(identity?.privateKey)
      // The imported PEM is byte-identical to the original -- still encrypted.
      expect(isEncryptedPrivateKeyPem(pem)).toBe(true)
      const signature = signEd25519('post-migration message', pem, 'super-secret-passphrase')
      expect(verifyEd25519('post-migration message', signature, publicKey)).toBe(true)

      expect(fs.existsSync(keyPath)).toBe(false)
      expect(mockProcessExit).not.toHaveBeenCalled()
    })

    it('fails fast naming the env var when the key is encrypted and no passphrase is available non-interactively', async () => {
      const { keyPath } = await seedLegacyIdentity('erin', { passphrase: 'another-secret' })

      await expect(runMigrate(undefined, { yes: true, storage: 'file' })).rejects.toThrow(
        'process.exit called',
      )

      expect(mockConsoleError).toHaveBeenCalledWith(
        expect.stringContaining('ATTEST_IT_KEY_PASSPHRASE'),
      )
      // Never touched on failure.
      expect(fs.existsSync(keyPath)).toBe(true)
      const config = await loadLocalConfig()
      expect(config?.identities['erin']?.privateKey.type).toBe('filesystem')
    })
  })

  describe('failed-import path -- fail-closed (issue #107 AC)', () => {
    it('leaves the legacy file untouched and reports a clear error when the round-trip verification fails', async () => {
      // Simulate a corrupted/drifted v1 config: the recorded public key does
      // not actually correspond to the private key on disk. Storing still
      // succeeds (it's an opaque blob to VaultKeeper), but the post-import
      // sign/verify round-trip must catch the mismatch before anything is
      // deleted or written back to config.
      const keyPair = generateEd25519KeyPair()
      const wrongKeyPair = generateEd25519KeyPair()
      const keyPath = path.join(legacyKeysDir, 'frank.pem')
      fs.writeFileSync(keyPath, keyPair.privateKey, { mode: 0o600 })

      const config: LocalConfig = {
        version: 2,
        activeIdentity: 'frank',
        identities: {
          frank: {
            name: 'Frank',
            publicKey: wrongKeyPair.publicKey, // Mismatched on purpose
            privateKey: { type: 'filesystem', path: keyPath },
          },
        },
      }
      await saveLocalConfig(config)

      await expect(runMigrate(undefined, { yes: true, storage: 'file' })).rejects.toThrow(
        'process.exit called',
      )

      expect(mockProcessExit).toHaveBeenCalledWith(ExitCode.CONFIG_ERROR)
      expect(mockConsoleError).toHaveBeenCalledWith(
        expect.stringContaining('Failed to migrate "frank"'),
      )

      // Fail-closed: legacy file untouched, config unchanged.
      expect(fs.existsSync(keyPath)).toBe(true)
      const after = await loadLocalConfig()
      expect(after?.identities['frank']?.privateKey).toEqual({ type: 'filesystem', path: keyPath })

      // No orphaned VaultKeeper secret left behind by the rolled-back import
      // (the backend's own `.key` wrap-key file is expected and untouched).
      const storeDir = path.join(tempHome, 'file')
      const remaining = fs.existsSync(storeDir)
        ? fs.readdirSync(storeDir).filter((f) => f.endsWith('.enc'))
        : []
      expect(remaining).toEqual([])
    })
  })

  describe('idempotency (issue #107 AC)', () => {
    it('exits 0 and says there is nothing to migrate when no legacy identities exist', async () => {
      await seedLegacyIdentity('grace')
      await runMigrate(undefined, { yes: true, storage: 'file' })
      mockConsoleLog.mockClear()

      // Second run: grace is already migrated, so there is nothing left to do.
      await runMigrate(undefined, { yes: true, storage: 'file' })

      expect(mockProcessExit).not.toHaveBeenCalled()
      expect(mockConsoleLog).toHaveBeenCalledWith(expect.stringContaining('nothing to'))
    })

    it('exits 0 for a config with zero identities configured needing migration', async () => {
      const keyPair = generateEd25519KeyPair()
      const config: LocalConfig = {
        version: 2,
        activeIdentity: 'heidi',
        identities: {
          heidi: {
            name: 'Heidi',
            publicKey: keyPair.publicKey,
            privateKey: { type: 'file', id: 'attest-it-heidi-already-migrated' },
          },
        },
      }
      await saveLocalConfig(config)

      await runMigrate(undefined, { yes: true, storage: 'file' })

      expect(mockProcessExit).not.toHaveBeenCalled()
      expect(mockConsoleLog).toHaveBeenCalledWith(expect.stringContaining('nothing to'))
    })
  })

  describe('non-interactive confirmation (issue #107 AC: --yes, no TTY assumptions)', () => {
    it('fails fast naming --yes when no flag is given and stdin is not a TTY', async () => {
      await seedLegacyIdentity('ivan')

      await expect(runMigrate(undefined, { storage: 'file' })).rejects.toThrow(
        'process.exit called',
      )

      expect(mockConsoleError).toHaveBeenCalledWith(expect.stringContaining('--yes'))
      const config = await loadLocalConfig()
      expect(config?.identities['ivan']?.privateKey.type).toBe('filesystem')
    })
  })

  describe('findLegacyIdentities', () => {
    it('returns only filesystem-typed identities', () => {
      const keyPair = generateEd25519KeyPair()
      const config: LocalConfig = {
        version: 2,
        activeIdentity: 'judy',
        identities: {
          judy: {
            name: 'Judy',
            publicKey: keyPair.publicKey,
            privateKey: { type: 'filesystem', path: '/tmp/judy.pem' },
          },
          kim: {
            name: 'Kim',
            publicKey: keyPair.publicKey,
            privateKey: { type: 'file', id: 'attest-it-kim-1' },
          },
        },
      }

      const result = findLegacyIdentities(config)
      expect(result).toEqual([
        { slug: 'judy', identity: config.identities['judy'], legacyPath: '/tmp/judy.pem' },
      ])
    })

    it('throws for an unknown slug', () => {
      const config: LocalConfig = { version: 2, activeIdentity: 'x', identities: {} }
      expect(() => findLegacyIdentities(config, 'nonexistent')).toThrow('not found')
    })

    it('returns an empty list for a slug that already migrated', () => {
      const keyPair = generateEd25519KeyPair()
      const config: LocalConfig = {
        version: 2,
        activeIdentity: 'liam',
        identities: {
          liam: {
            name: 'Liam',
            publicKey: keyPair.publicKey,
            privateKey: { type: 'file', id: 'attest-it-liam-1' },
          },
        },
      }
      expect(findLegacyIdentities(config, 'liam')).toEqual([])
    })
  })
})
