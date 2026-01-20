import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import * as os from 'node:os'
import * as crypto from 'node:crypto'
import {
  PassphraseKeyProvider,
  encryptPrivateKeyWithPassphrase,
  decryptPrivateKeyWithPassphrase,
} from '../../src/key-provider/passphrase-provider.js'

describe('PassphraseKeyProvider', () => {
  let tmpDir: string
  let provider: PassphraseKeyProvider

  // Mock passphrase prompt to return a fixed passphrase
  const testPassphrase = 'test-passphrase-12345'
  const mockPromptPassphrase = vi.fn().mockResolvedValue(testPassphrase)

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'attest-it-passphrase-provider-'))
    const encryptedKeyPath = path.join(tmpDir, 'test.enc')
    provider = new PassphraseKeyProvider({
      encryptedKeyPath,
      promptPassphrase: mockPromptPassphrase,
    })
    mockPromptPassphrase.mockClear()
  })

  afterEach(async () => {
    try {
      await fs.rm(tmpDir, { recursive: true, force: true })
    } catch {
      // Ignore cleanup errors
    }
  })

  describe('constructor', () => {
    it('should use provided encryptedKeyPath', () => {
      const customPath = '/custom/path/key.enc'
      const customProvider = new PassphraseKeyProvider({
        encryptedKeyPath: customPath,
        promptPassphrase: mockPromptPassphrase,
      })
      const config = customProvider.getConfig()
      expect(config.options.encryptedKeyPath).toBe(customPath)
    })
  })

  describe('type and displayName', () => {
    it('should have correct type identifier', () => {
      expect(provider.type).toBe('passphrase')
    })

    it('should have correct display name', () => {
      expect(provider.displayName).toBe('Passphrase-protected')
    })
  })

  describe('isAvailable', () => {
    it('should always return true (static)', () => {
      expect(PassphraseKeyProvider.isAvailable()).toBe(true)
    })

    it('should always return true (instance)', async () => {
      const isAvailable = await provider.isAvailable()
      expect(isAvailable).toBe(true)
    })
  })

  describe('keyExists', () => {
    it('should return true if encrypted key file exists', async () => {
      const keyPath = path.join(tmpDir, 'existing-key.enc')
      await fs.writeFile(keyPath, JSON.stringify({ version: 1 }))

      const exists = await provider.keyExists(keyPath)
      expect(exists).toBe(true)
    })

    it('should return false if encrypted key file does not exist', async () => {
      const keyPath = path.join(tmpDir, 'nonexistent-key.enc')

      const exists = await provider.keyExists(keyPath)
      expect(exists).toBe(false)
    })
  })

  describe('getPrivateKey', () => {
    it('should throw if encrypted key file does not exist', async () => {
      const keyPath = path.join(tmpDir, 'nonexistent.enc')

      await expect(provider.getPrivateKey(keyPath)).rejects.toThrow(/not found/)
    })

    it('should throw on invalid encrypted key file format', async () => {
      const keyPath = path.join(tmpDir, 'invalid.enc')
      await fs.writeFile(keyPath, 'not json')

      await expect(provider.getPrivateKey(keyPath)).rejects.toThrow(/Invalid encrypted key file/)
    })

    it('should throw on unsupported version', async () => {
      const keyPath = path.join(tmpDir, 'wrong-version.enc')
      await fs.writeFile(keyPath, JSON.stringify({ version: 999 }))

      await expect(provider.getPrivateKey(keyPath)).rejects.toThrow(/Unsupported/)
    })

    it('should throw if passphrase is empty', async () => {
      const keyPath = path.join(tmpDir, 'test.enc')

      // Create a valid encrypted key file
      const privateKey = '-----BEGIN PRIVATE KEY-----\ntest\n-----END PRIVATE KEY-----'
      const encrypted = await encryptPrivateKeyWithPassphrase(privateKey, testPassphrase)
      await fs.writeFile(keyPath, encrypted)

      // Mock returns empty passphrase
      const emptyPrompt = vi.fn().mockResolvedValue('')
      const emptyProvider = new PassphraseKeyProvider({
        encryptedKeyPath: keyPath,
        promptPassphrase: emptyPrompt,
      })

      await expect(emptyProvider.getPrivateKey(keyPath)).rejects.toThrow(/required/)
    })

    it('should throw on incorrect passphrase', async () => {
      const keyPath = path.join(tmpDir, 'test.enc')

      // Create a valid encrypted key file
      const privateKey = '-----BEGIN PRIVATE KEY-----\ntest\n-----END PRIVATE KEY-----'
      const encrypted = await encryptPrivateKeyWithPassphrase(privateKey, testPassphrase)
      await fs.writeFile(keyPath, encrypted)

      // Mock returns wrong passphrase
      const wrongPrompt = vi.fn().mockResolvedValue('wrong-passphrase')
      const wrongProvider = new PassphraseKeyProvider({
        encryptedKeyPath: keyPath,
        promptPassphrase: wrongPrompt,
      })

      await expect(wrongProvider.getPrivateKey(keyPath)).rejects.toThrow(/Failed to decrypt/)
    })

    it('should decrypt and return key path on correct passphrase', async () => {
      const keyPath = path.join(tmpDir, 'test.enc')

      // Create a valid encrypted key file
      const privateKey = '-----BEGIN PRIVATE KEY-----\ntest-key-content\n-----END PRIVATE KEY-----'
      const encrypted = await encryptPrivateKeyWithPassphrase(privateKey, testPassphrase)
      await fs.writeFile(keyPath, encrypted)

      const result = await provider.getPrivateKey(keyPath)

      expect(result.keyPath).toBeTruthy()
      expect(typeof result.cleanup).toBe('function')

      // Verify the decrypted content
      const decryptedContent = await fs.readFile(result.keyPath, 'utf8')
      expect(decryptedContent).toBe(privateKey)

      // Clean up
      await result.cleanup()
    })

    it('should prompt for passphrase', async () => {
      const keyPath = path.join(tmpDir, 'test.enc')

      // Create a valid encrypted key file
      const privateKey = '-----BEGIN PRIVATE KEY-----\ntest\n-----END PRIVATE KEY-----'
      const encrypted = await encryptPrivateKeyWithPassphrase(privateKey, testPassphrase)
      await fs.writeFile(keyPath, encrypted)

      await provider.getPrivateKey(keyPath)

      expect(mockPromptPassphrase).toHaveBeenCalledTimes(1)
      expect(mockPromptPassphrase).toHaveBeenCalledWith(expect.stringContaining('passphrase'))
    })
  })

  describe('generateKeyPair', () => {
    it('should generate keypair and store encrypted', async () => {
      const encryptedPath = path.join(tmpDir, 'generated.enc')
      const publicKeyPath = path.join(tmpDir, 'public.pem')

      // Mock confirms passphrase (called twice)
      mockPromptPassphrase.mockResolvedValueOnce(testPassphrase)
      mockPromptPassphrase.mockResolvedValueOnce(testPassphrase)

      const genProvider = new PassphraseKeyProvider({
        encryptedKeyPath: encryptedPath,
        promptPassphrase: mockPromptPassphrase,
      })

      const result = await genProvider.generateKeyPair({
        publicKeyPath,
        force: false,
      })

      expect(result.privateKeyRef).toBe(encryptedPath)
      expect(result.publicKeyPath).toBe(publicKeyPath)
      expect(result.storageDescription).toContain('Passphrase-protected')

      // Verify encrypted file exists
      const encryptedExists = await genProvider.keyExists(encryptedPath)
      expect(encryptedExists).toBe(true)

      // Verify public key exists
      const publicExists = await genProvider.keyExists(publicKeyPath)
      expect(publicExists).toBe(true)

      // Verify we can decrypt and use the key
      mockPromptPassphrase.mockResolvedValueOnce(testPassphrase)
      const keyResult = await genProvider.getPrivateKey(encryptedPath)
      expect(keyResult.keyPath).toBeTruthy()
      await keyResult.cleanup()
    })

    it('should fail if passphrases do not match', async () => {
      const encryptedPath = path.join(tmpDir, 'mismatch.enc')
      const publicKeyPath = path.join(tmpDir, 'public.pem')

      // First passphrase
      mockPromptPassphrase.mockResolvedValueOnce(testPassphrase)
      // Confirm with different passphrase
      mockPromptPassphrase.mockResolvedValueOnce('different-passphrase')

      const genProvider = new PassphraseKeyProvider({
        encryptedKeyPath: encryptedPath,
        promptPassphrase: mockPromptPassphrase,
      })

      await expect(
        genProvider.generateKeyPair({
          publicKeyPath,
          force: false,
        }),
      ).rejects.toThrow(/do not match/)
    })

    it('should fail if passphrase is too short', async () => {
      const encryptedPath = path.join(tmpDir, 'short.enc')
      const publicKeyPath = path.join(tmpDir, 'public.pem')

      // Short passphrase
      mockPromptPassphrase.mockResolvedValueOnce('short')

      const genProvider = new PassphraseKeyProvider({
        encryptedKeyPath: encryptedPath,
        promptPassphrase: mockPromptPassphrase,
      })

      await expect(
        genProvider.generateKeyPair({
          publicKeyPath,
          force: false,
        }),
      ).rejects.toThrow(/at least 8 characters/)
    })

    it('should fail if key exists without force', async () => {
      const encryptedPath = path.join(tmpDir, 'existing.enc')
      const publicKeyPath = path.join(tmpDir, 'public.pem')

      // Create existing file
      await fs.writeFile(encryptedPath, 'existing content')

      mockPromptPassphrase.mockResolvedValue(testPassphrase)

      const genProvider = new PassphraseKeyProvider({
        encryptedKeyPath: encryptedPath,
        promptPassphrase: mockPromptPassphrase,
      })

      await expect(
        genProvider.generateKeyPair({
          publicKeyPath,
          force: false,
        }),
      ).rejects.toThrow(/already exists/)
    })
  })

  describe('getConfig', () => {
    it('should return correct configuration', () => {
      const encryptedPath = '/test/path/key.enc'
      const customProvider = new PassphraseKeyProvider({
        encryptedKeyPath: encryptedPath,
        promptPassphrase: mockPromptPassphrase,
      })

      const config = customProvider.getConfig()

      expect(config.type).toBe('passphrase')
      expect(config.options.encryptedKeyPath).toBe(encryptedPath)
    })
  })

  describe('registry integration', () => {
    it('should be registered in KeyProviderRegistry', async () => {
      const { KeyProviderRegistry } = await import('../../src/key-provider/registry.js')

      const providerTypes = KeyProviderRegistry.getProviderTypes()
      expect(providerTypes).toContain('passphrase')
    })

    it('should create provider from registry with config', async () => {
      const { KeyProviderRegistry } = await import('../../src/key-provider/registry.js')

      const createdProvider = KeyProviderRegistry.create({
        type: 'passphrase',
        options: {
          encryptedKeyPath: '/test/path/key.enc',
        },
      })

      expect(createdProvider.type).toBe('passphrase')
      expect(createdProvider.displayName).toBe('Passphrase-protected')

      const config = createdProvider.getConfig()
      expect(config.options.encryptedKeyPath).toBe('/test/path/key.enc')
    })

    it('should throw if encryptedKeyPath is missing', async () => {
      const { KeyProviderRegistry } = await import('../../src/key-provider/registry.js')

      expect(() =>
        KeyProviderRegistry.create({
          type: 'passphrase',
          options: {},
        }),
      ).toThrow(/encryptedKeyPath/)
    })
  })

  describe('utility functions', () => {
    describe('encryptPrivateKeyWithPassphrase', () => {
      it('should encrypt private key content', async () => {
        const privateKey = '-----BEGIN PRIVATE KEY-----\ntest\n-----END PRIVATE KEY-----'
        const encrypted = await encryptPrivateKeyWithPassphrase(privateKey, testPassphrase)

        const parsed = JSON.parse(encrypted)
        expect(parsed.version).toBe(1)
        expect(parsed.iv).toBeTruthy()
        expect(parsed.authTag).toBeTruthy()
        expect(parsed.salt).toBeTruthy()
        expect(parsed.ciphertext).toBeTruthy()
        expect(parsed.iterations).toBeGreaterThan(0)
      })

      it('should reject short passphrases', async () => {
        const privateKey = '-----BEGIN PRIVATE KEY-----\ntest\n-----END PRIVATE KEY-----'

        await expect(encryptPrivateKeyWithPassphrase(privateKey, 'short')).rejects.toThrow(
          /at least 8 characters/,
        )
      })
    })

    describe('decryptPrivateKeyWithPassphrase', () => {
      it('should decrypt encrypted content', async () => {
        const privateKey = '-----BEGIN PRIVATE KEY-----\ntest-content\n-----END PRIVATE KEY-----'
        const encrypted = await encryptPrivateKeyWithPassphrase(privateKey, testPassphrase)
        const decrypted = await decryptPrivateKeyWithPassphrase(encrypted, testPassphrase)

        expect(decrypted).toBe(privateKey)
      })

      it('should throw on wrong passphrase', async () => {
        const privateKey = '-----BEGIN PRIVATE KEY-----\ntest\n-----END PRIVATE KEY-----'
        const encrypted = await encryptPrivateKeyWithPassphrase(privateKey, testPassphrase)

        await expect(
          decryptPrivateKeyWithPassphrase(encrypted, 'wrong-passphrase'),
        ).rejects.toThrow(/Failed to decrypt/)
      })

      it('should throw on invalid JSON', async () => {
        await expect(decryptPrivateKeyWithPassphrase('not json', testPassphrase)).rejects.toThrow(
          /Invalid encrypted key file/,
        )
      })

      it('should throw on unsupported version', async () => {
        const invalidContent = JSON.stringify({ version: 99 })

        await expect(
          decryptPrivateKeyWithPassphrase(invalidContent, testPassphrase),
        ).rejects.toThrow(/Unsupported/)
      })
    })

    describe('round-trip encryption/decryption', () => {
      it('should preserve content through encrypt/decrypt cycle', async () => {
        const testContent = `-----BEGIN PRIVATE KEY-----
MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQC7aaW7U1NYXTFB
... more key content ...
-----END PRIVATE KEY-----`

        const encrypted = await encryptPrivateKeyWithPassphrase(testContent, testPassphrase)
        const decrypted = await decryptPrivateKeyWithPassphrase(encrypted, testPassphrase)

        expect(decrypted).toBe(testContent)
      })

      it('should produce different ciphertext for same content', async () => {
        const privateKey = '-----BEGIN PRIVATE KEY-----\ntest\n-----END PRIVATE KEY-----'

        const encrypted1 = await encryptPrivateKeyWithPassphrase(privateKey, testPassphrase)
        const encrypted2 = await encryptPrivateKeyWithPassphrase(privateKey, testPassphrase)

        // Different salt/IV means different ciphertext
        const parsed1 = JSON.parse(encrypted1)
        const parsed2 = JSON.parse(encrypted2)

        expect(parsed1.salt).not.toBe(parsed2.salt)
        expect(parsed1.iv).not.toBe(parsed2.iv)
        expect(parsed1.ciphertext).not.toBe(parsed2.ciphertext)

        // But both should decrypt to the same content
        const decrypted1 = await decryptPrivateKeyWithPassphrase(encrypted1, testPassphrase)
        const decrypted2 = await decryptPrivateKeyWithPassphrase(encrypted2, testPassphrase)

        expect(decrypted1).toBe(privateKey)
        expect(decrypted2).toBe(privateKey)
      })
    })
  })
})
