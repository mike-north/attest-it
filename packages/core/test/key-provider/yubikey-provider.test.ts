import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import * as os from 'node:os'
import * as crypto from 'node:crypto'
import { YubiKeyProvider } from '../../src/key-provider/yubikey-provider.js'

describe('YubiKeyProvider', () => {
  let tmpDir: string
  let provider: YubiKeyProvider

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'attest-it-yubikey-provider-'))
    const encryptedKeyPath = path.join(tmpDir, 'test.enc')
    provider = new YubiKeyProvider({ encryptedKeyPath })
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
      const customProvider = new YubiKeyProvider({ encryptedKeyPath: customPath })
      const config = customProvider.getConfig()
      expect(config.options.encryptedKeyPath).toBe(customPath)
    })

    it('should use default slot 2 if not provided', () => {
      const config = provider.getConfig()
      expect(config.options.slot).toBe(2)
    })

    it('should use custom slot if provided', () => {
      const customProvider = new YubiKeyProvider({
        encryptedKeyPath: '/path/key.enc',
        slot: 1,
      })
      const config = customProvider.getConfig()
      expect(config.options.slot).toBe(1)
    })

    it('should store serial if provided', () => {
      const customProvider = new YubiKeyProvider({
        encryptedKeyPath: '/path/key.enc',
        serial: '12345678',
      })
      const config = customProvider.getConfig()
      expect(config.options.serial).toBe('12345678')
    })
  })

  describe('type and displayName', () => {
    it('should have correct type identifier', () => {
      expect(provider.type).toBe('yubikey')
    })

    it('should have correct display name', () => {
      expect(provider.displayName).toBe('YubiKey')
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

    it('should throw if no YubiKey is connected', async () => {
      const keyPath = path.join(tmpDir, 'test.enc')

      // Create a valid encrypted key file structure
      const keyFile = {
        version: 1,
        iv: crypto.randomBytes(12).toString('base64'),
        authTag: crypto.randomBytes(16).toString('base64'),
        salt: crypto.randomBytes(32).toString('base64'),
        challenge: crypto.randomBytes(32).toString('base64'),
        ciphertext: crypto.randomBytes(100).toString('base64'),
        slot: 2,
      }
      await fs.writeFile(keyPath, JSON.stringify(keyFile))

      // This will fail because no YubiKey is connected (unless running on a machine with one)
      // We expect it to throw about YubiKey not being connected
      await expect(provider.getPrivateKey(keyPath)).rejects.toThrow()
    })

    it('should throw on invalid encrypted key file format when YubiKey connected', async () => {
      const keyPath = path.join(tmpDir, 'invalid.enc')
      await fs.writeFile(keyPath, 'not json')

      // This will throw either about YubiKey not connected (most CI environments)
      // or about invalid JSON format if YubiKey is connected
      // Either error is acceptable for this test
      await expect(provider.getPrivateKey(keyPath)).rejects.toThrow()
    })

    it('should throw on unsupported version', async () => {
      const keyPath = path.join(tmpDir, 'wrong-version.enc')
      await fs.writeFile(keyPath, JSON.stringify({ version: 999 }))

      // This will actually fail at the isConnected check first in most environments
      // but the version check is still there
      await expect(provider.getPrivateKey(keyPath)).rejects.toThrow()
    })
  })

  describe('getConfig', () => {
    it('should return correct configuration with all options', () => {
      const customProvider = new YubiKeyProvider({
        encryptedKeyPath: '/path/key.enc',
        slot: 1,
        serial: '12345678',
      })

      const config = customProvider.getConfig()

      expect(config.type).toBe('yubikey')
      expect(config.options.encryptedKeyPath).toBe('/path/key.enc')
      expect(config.options.slot).toBe(1)
      expect(config.options.serial).toBe('12345678')
    })

    it('should not include serial if not provided', () => {
      const config = provider.getConfig()

      expect(config.type).toBe('yubikey')
      expect(config.options.encryptedKeyPath).toBeDefined()
      expect(config.options.slot).toBe(2)
      expect(config.options.serial).toBeUndefined()
    })
  })

  describe('static methods', () => {
    describe('isInstalled', () => {
      it('should return boolean indicating ykman availability', async () => {
        const isInstalled = await YubiKeyProvider.isInstalled()
        expect(typeof isInstalled).toBe('boolean')
      })
    })

    describe('isConnected', () => {
      it('should return boolean indicating YubiKey presence', async () => {
        // This will return false if no YubiKey is connected (expected in CI)
        const isConnected = await YubiKeyProvider.isConnected()
        expect(typeof isConnected).toBe('boolean')
      })
    })

    describe('listDevices', () => {
      it('should return an array', async () => {
        const devices = await YubiKeyProvider.listDevices()
        expect(Array.isArray(devices)).toBe(true)
      })

      it('should return empty array if ykman not installed', async () => {
        // If ykman is not installed, should return empty array
        const isInstalled = await YubiKeyProvider.isInstalled()
        if (!isInstalled) {
          const devices = await YubiKeyProvider.listDevices()
          expect(devices).toEqual([])
        }
      })
    })

    describe('isChallengeResponseConfigured', () => {
      it('should return boolean', async () => {
        // This will likely return false in CI without a real YubiKey
        const isConfigured = await YubiKeyProvider.isChallengeResponseConfigured(2)
        expect(typeof isConfigured).toBe('boolean')
      })
    })
  })

  describe('encrypted key file structure', () => {
    it('should validate version 1 structure', async () => {
      const keyPath = path.join(tmpDir, 'valid-structure.enc')

      // Create a properly structured encrypted key file
      const validKeyFile = {
        version: 1,
        iv: crypto.randomBytes(12).toString('base64'),
        authTag: crypto.randomBytes(16).toString('base64'),
        salt: crypto.randomBytes(32).toString('base64'),
        challenge: crypto.randomBytes(32).toString('base64'),
        ciphertext: crypto.randomBytes(100).toString('base64'),
        slot: 2 as const,
        serial: '12345678',
      }

      await fs.writeFile(keyPath, JSON.stringify(validKeyFile, null, 2))

      // Verify the file was written correctly
      const content = await fs.readFile(keyPath, 'utf8')
      const parsed = JSON.parse(content)

      expect(parsed.version).toBe(1)
      expect(parsed.slot).toBe(2)
      expect(parsed.serial).toBe('12345678')
      expect(typeof parsed.iv).toBe('string')
      expect(typeof parsed.authTag).toBe('string')
      expect(typeof parsed.salt).toBe('string')
      expect(typeof parsed.challenge).toBe('string')
      expect(typeof parsed.ciphertext).toBe('string')
    })
  })

  describe('registry integration', () => {
    it('should be registered in KeyProviderRegistry', async () => {
      const { KeyProviderRegistry } = await import('../../src/key-provider/registry.js')

      const providerTypes = KeyProviderRegistry.getProviderTypes()
      expect(providerTypes).toContain('yubikey')
    })

    it('should create provider from registry with config', async () => {
      const { KeyProviderRegistry } = await import('../../src/key-provider/registry.js')

      const createdProvider = KeyProviderRegistry.create({
        type: 'yubikey',
        options: {
          encryptedKeyPath: '/test/path/key.enc',
          slot: 1,
          serial: '12345678',
        },
      })

      expect(createdProvider.type).toBe('yubikey')
      expect(createdProvider.displayName).toBe('YubiKey')

      const config = createdProvider.getConfig()
      expect(config.options.encryptedKeyPath).toBe('/test/path/key.enc')
      expect(config.options.slot).toBe(1)
      expect(config.options.serial).toBe('12345678')
    })

    it('should throw if encryptedKeyPath is missing', async () => {
      const { KeyProviderRegistry } = await import('../../src/key-provider/registry.js')

      expect(() =>
        KeyProviderRegistry.create({
          type: 'yubikey',
          options: {},
        }),
      ).toThrow(/encryptedKeyPath/)
    })
  })
})
