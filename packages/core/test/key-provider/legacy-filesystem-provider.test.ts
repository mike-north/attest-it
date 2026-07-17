/**
 * Tests for LegacyFilesystemKeyProvider.
 *
 * @remarks
 * Regression tests for the v1→v2 config migration bug where the `filesystem`
 * config type was resolved via `KeyProviderRegistry.create({ type: 'filesystem' })`,
 * which now maps to the VaultKeeper-backed provider (expecting secret IDs, not
 * raw paths). The fix introduces `filesystem-legacy` as a separate provider type
 * that reads PEM directly from filesystem paths.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import * as os from 'node:os'
import { LegacyFilesystemKeyProvider } from '../../src/key-provider/legacy-filesystem-provider.js'

// `node:os`'s named exports are non-configurable in Vitest's ESM environment,
// so `vi.spyOn(os, 'homedir')` cannot redefine it -- a full module mock is
// required instead. `mockHomedir` is a mutable box the mock factory closes
// over, so each test can point "home" at its own tmp directory; it defaults
// to '' so tests outside the "tilde expansion" block (which don't touch
// homedir) are unaffected.
const mockHomedir = { current: '' }
vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>()
  return { ...actual, homedir: () => mockHomedir.current }
})

describe('LegacyFilesystemKeyProvider', () => {
  let tmpDir: string
  let provider: LegacyFilesystemKeyProvider

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'attest-it-legacy-fs-provider-'))
    provider = new LegacyFilesystemKeyProvider()
  })

  afterEach(async () => {
    try {
      await fs.rm(tmpDir, { recursive: true, force: true })
    } catch {
      // Ignore cleanup errors
    }
  })

  describe('type and displayName', () => {
    it('should have the correct type identifier', () => {
      expect(provider.type).toBe('filesystem-legacy')
    })

    it('should have the correct display name', () => {
      expect(provider.displayName).toBe('Filesystem (Legacy)')
    })
  })

  describe('isAvailable', () => {
    it('should always return true', async () => {
      const isAvailable = await provider.isAvailable()
      expect(isAvailable).toBe(true)
    })
  })

  describe('keyExists', () => {
    it('should return true when the file exists', async () => {
      const keyPath = path.join(tmpDir, 'existing-key.pem')
      await fs.writeFile(
        keyPath,
        '-----BEGIN EC PRIVATE KEY-----\ntest\n-----END EC PRIVATE KEY-----',
      )

      const exists = await provider.keyExists(keyPath)
      expect(exists).toBe(true)
    })

    it('should return false when the file does not exist', async () => {
      const keyPath = path.join(tmpDir, 'nonexistent-key.pem')

      const exists = await provider.keyExists(keyPath)
      expect(exists).toBe(false)
    })
  })

  describe('getPrivateKey', () => {
    it('should return keyPath pointing to the file', async () => {
      const keyPath = path.join(tmpDir, 'test-key.pem')
      await fs.writeFile(
        keyPath,
        '-----BEGIN EC PRIVATE KEY-----\ntest\n-----END EC PRIVATE KEY-----',
      )

      const result = await provider.getPrivateKey(keyPath)

      expect(result.keyPath).toBe(keyPath)
    })

    it('should return a no-op cleanup that leaves the file intact', async () => {
      const keyPath = path.join(tmpDir, 'cleanup-key.pem')
      await fs.writeFile(
        keyPath,
        '-----BEGIN EC PRIVATE KEY-----\ntest\n-----END EC PRIVATE KEY-----',
      )

      const result = await provider.getPrivateKey(keyPath)

      // cleanup should be a function
      expect(typeof result.cleanup).toBe('function')

      // calling cleanup should not remove the file
      await result.cleanup()
      const stillExists = await provider.keyExists(keyPath)
      expect(stillExists).toBe(true)
    })

    it('should throw when the key file does not exist', async () => {
      const keyPath = path.join(tmpDir, 'missing-key.pem')

      await expect(provider.getPrivateKey(keyPath)).rejects.toThrow(/not found/)
    })

    it('should include the missing path in the error message', async () => {
      const keyPath = path.join(tmpDir, 'missing-key.pem')

      await expect(provider.getPrivateKey(keyPath)).rejects.toThrow(keyPath)
    })

    // Regression: a hand-edited v1 config carrying a `~`-prefixed key path
    // (e.g. `~/attest-it/private.pem`) previously failed with "Private key
    // not found" because Node's fs APIs don't perform shell tilde expansion --
    // the raw `~/...` string was passed straight to `fs.access`/`fs.readFile`.
    describe('tilde expansion', () => {
      beforeEach(() => {
        mockHomedir.current = tmpDir
      })

      afterEach(() => {
        mockHomedir.current = ''
      })

      it('keyExists resolves a leading ~ to the home directory', async () => {
        await fs.mkdir(path.join(tmpDir, 'keys'), { recursive: true })
        await fs.writeFile(
          path.join(tmpDir, 'keys', 'tilde-key.pem'),
          '-----BEGIN EC PRIVATE KEY-----\ntest\n-----END EC PRIVATE KEY-----',
        )

        const exists = await provider.keyExists('~/keys/tilde-key.pem')
        expect(exists).toBe(true)
      })

      it('getPrivateKey resolves a leading ~ and returns the expanded path', async () => {
        await fs.mkdir(path.join(tmpDir, 'keys'), { recursive: true })
        const realPath = path.join(tmpDir, 'keys', 'tilde-key.pem')
        await fs.writeFile(
          realPath,
          '-----BEGIN EC PRIVATE KEY-----\ntest\n-----END EC PRIVATE KEY-----',
        )

        const result = await provider.getPrivateKey('~/keys/tilde-key.pem')
        expect(result.keyPath).toBe(realPath)
      })
    })
  })

  describe('generateKeyPair', () => {
    it('should throw with a descriptive error', async () => {
      await expect(
        provider.generateKeyPair({ publicKeyPath: path.join(tmpDir, 'public.pem') }),
      ).rejects.toThrow(/Legacy filesystem provider does not support key generation/)
    })

    it('should mention "identity create" in the error to guide the user', async () => {
      await expect(
        provider.generateKeyPair({ publicKeyPath: path.join(tmpDir, 'public.pem') }),
      ).rejects.toThrow(/identity create/)
    })
  })

  describe('getConfig', () => {
    it('should return a config with type filesystem-legacy', () => {
      const config = provider.getConfig()
      expect(config.type).toBe('filesystem-legacy')
    })

    it('should return an empty options object', () => {
      const config = provider.getConfig()
      expect(config.options).toEqual({})
    })
  })
})
