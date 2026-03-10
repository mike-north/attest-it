import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import * as os from 'node:os'
import { FilesystemKeyProvider } from '../../src/key-provider/filesystem-provider.js'
import { getDefaultPrivateKeyPath } from '../../src/key-utils.js'

describe('FilesystemKeyProvider', () => {
  let tmpDir: string
  let provider: FilesystemKeyProvider

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'attest-it-fs-provider-'))
    const privateKeyPath = path.join(tmpDir, 'private.pem')
    provider = new FilesystemKeyProvider({ privateKeyPath })
  })

  afterEach(async () => {
    try {
      await fs.rm(tmpDir, { recursive: true, force: true })
    } catch {
      // Ignore cleanup errors
    }
  })

  describe('constructor', () => {
    it('should use custom privateKeyPath if provided', () => {
      const customPath = '/custom/path/key.pem'
      const customProvider = new FilesystemKeyProvider({ privateKeyPath: customPath })
      const config = customProvider.getConfig()
      expect(config.options.privateKeyPath).toBe(customPath)
    })

    it('should use default path if not provided', () => {
      const defaultProvider = new FilesystemKeyProvider()
      const config = defaultProvider.getConfig()
      expect(config.options.privateKeyPath).toBe(getDefaultPrivateKeyPath())
    })
  })

  describe('type and displayName', () => {
    it('should have correct type identifier', () => {
      expect(provider.type).toBe('filesystem')
    })

    it('should have correct display name', () => {
      expect(provider.displayName).toBe('Filesystem')
    })
  })

  describe('isAvailable', () => {
    it('should always return true', async () => {
      const isAvailable = await provider.isAvailable()
      expect(isAvailable).toBe(true)
    })
  })

  describe('keyExists', () => {
    it('should return true if key file exists', async () => {
      const keyPath = path.join(tmpDir, 'existing-key.pem')
      await fs.writeFile(keyPath, 'test key content')

      const exists = await provider.keyExists(keyPath)
      expect(exists).toBe(true)
    })

    it('should return false if key file does not exist', async () => {
      const keyPath = path.join(tmpDir, 'nonexistent-key.pem')

      const exists = await provider.keyExists(keyPath)
      expect(exists).toBe(false)
    })

    it('should return false for directory path', async () => {
      const exists = await provider.keyExists(tmpDir)
      // Directories don't count as key files
      expect(exists).toBe(true) // fs.access will succeed for directories
    })
  })

  describe('getPrivateKey', () => {
    it('should return key path directly with no-op cleanup', async () => {
      const keyPath = path.join(tmpDir, 'test-key.pem')
      await fs.writeFile(keyPath, 'test key content')

      const result = await provider.getPrivateKey(keyPath)

      expect(result.keyPath).toBe(keyPath)
      expect(typeof result.cleanup).toBe('function')

      // Verify key file still exists
      const exists = await provider.keyExists(keyPath)
      expect(exists).toBe(true)

      // Call cleanup and verify file still exists (no-op)
      await result.cleanup()
      const stillExists = await provider.keyExists(keyPath)
      expect(stillExists).toBe(true)
    })

    it('should throw if key does not exist', async () => {
      const keyPath = path.join(tmpDir, 'nonexistent.pem')

      await expect(provider.getPrivateKey(keyPath)).rejects.toThrow(/not found/)
    })
  })

  describe('generateKeyPair', () => {
    it('should generate keypair and return correct paths', async () => {
      const privatePath = path.join(tmpDir, 'generated-private.pem')
      const publicKeyPath = path.join(tmpDir, 'generated-public.pem')

      const customProvider = new FilesystemKeyProvider({ privateKeyPath: privatePath })

      const result = await customProvider.generateKeyPair({
        publicKeyPath,
        force: false,
      })

      expect(result.privateKeyRef).toBe(privatePath)
      expect(result.publicKeyPath).toBe(publicKeyPath)
      expect(result.storageDescription).toContain('Filesystem')
      expect(result.storageDescription).toContain(privatePath)

      // Verify both files exist
      const privateExists = await customProvider.keyExists(privatePath)
      const publicExists = await customProvider.keyExists(publicKeyPath)
      expect(privateExists).toBe(true)
      expect(publicExists).toBe(true)
    })

    it('should fail if keys exist without force', async () => {
      const privatePath = path.join(tmpDir, 'duplicate-private.pem')
      const publicKeyPath = path.join(tmpDir, 'duplicate-public.pem')

      const customProvider = new FilesystemKeyProvider({ privateKeyPath: privatePath })

      // Generate first keypair
      await customProvider.generateKeyPair({ publicKeyPath })

      // Try to generate again without force
      await expect(customProvider.generateKeyPair({ publicKeyPath, force: false })).rejects.toThrow(
        /already exist/,
      )
    })

    it('should overwrite keys when force is true', async () => {
      const privatePath = path.join(tmpDir, 'force-private.pem')
      const publicKeyPath = path.join(tmpDir, 'force-public.pem')

      const customProvider = new FilesystemKeyProvider({ privateKeyPath: privatePath })

      // Generate first keypair
      await customProvider.generateKeyPair({ publicKeyPath })
      const firstPrivate = await fs.readFile(privatePath, 'utf8')

      // Overwrite with force
      await customProvider.generateKeyPair({ publicKeyPath, force: true })
      const secondPrivate = await fs.readFile(privatePath, 'utf8')

      // Keys should be different
      expect(secondPrivate).not.toBe(firstPrivate)
    })
  })

  describe('tilde expansion', () => {
    // We create a real subdirectory under os.homedir() so that paths expressed
    // as ~/... resolve correctly via os.homedir().  The subdir is removed in
    // afterEach alongside the regular tmpDir cleanup.
    let homeTmpDir: string
    let homeTmpRelative: string // e.g. ".attest-it-test-abc123"

    beforeEach(async () => {
      // mkdtemp with a prefix inside homedir gives us a unique directory
      homeTmpDir = await fs.mkdtemp(path.join(os.homedir(), '.attest-it-test-'))
      homeTmpRelative = path.relative(os.homedir(), homeTmpDir)
    })

    afterEach(async () => {
      try {
        await fs.rm(homeTmpDir, { recursive: true, force: true })
      } catch {
        // Ignore cleanup errors
      }
    })

    it('should expand ~ in keyExists when key file exists', async () => {
      const keyFile = path.join(homeTmpDir, 'tilde-key.pem')
      await fs.writeFile(keyFile, 'test key content', 'utf-8')

      const tildeRef = `~/${homeTmpRelative}/tilde-key.pem`
      const exists = await provider.keyExists(tildeRef)
      expect(exists).toBe(true)
    })

    it('should expand ~ in keyExists when key file does not exist', async () => {
      const tildeRef = `~/${homeTmpRelative}/nonexistent.pem`
      const exists = await provider.keyExists(tildeRef)
      expect(exists).toBe(false)
    })

    it('should expand ~ in getPrivateKey and return the absolute resolved path', async () => {
      const keyFile = path.join(homeTmpDir, 'tilde-key.pem')
      await fs.writeFile(keyFile, 'test key content', 'utf-8')

      const tildeRef = `~/${homeTmpRelative}/tilde-key.pem`
      const result = await provider.getPrivateKey(tildeRef)

      // The returned keyPath must be the expanded absolute path, not the tilde form
      expect(result.keyPath).toBe(keyFile)
      expect(result.keyPath).not.toContain('~')
    })

    it('should throw in getPrivateKey when tilde-prefixed key does not exist', async () => {
      const tildeRef = `~/${homeTmpRelative}/missing.pem`
      await expect(provider.getPrivateKey(tildeRef)).rejects.toThrow(/not found/)
    })
  })

  describe('getConfig', () => {
    it('should return correct configuration', () => {
      const privateKeyPath = path.join(tmpDir, 'config-key.pem')
      const customProvider = new FilesystemKeyProvider({ privateKeyPath })

      const config = customProvider.getConfig()

      expect(config.type).toBe('filesystem')
      expect(config.options.privateKeyPath).toBe(privateKeyPath)
    })
  })

  describe('generateKeyPair produces Ed25519 keys', () => {
    it('should generate Ed25519 keypair with PEM private key', async () => {
      const privatePath = path.join(tmpDir, 'ed25519-private.pem')
      const publicKeyPath = path.join(tmpDir, 'ed25519-public.pem')

      const customProvider = new FilesystemKeyProvider({ privateKeyPath: privatePath })

      const result = await customProvider.generateKeyPair({
        publicKeyPath,
      })

      expect(result.privateKeyRef).toBe(privatePath)
      expect(result.publicKeyPath).toBe(publicKeyPath)
      expect(result.encrypted).toBe(false)

      // Verify private key is PEM-encoded Ed25519
      const privateContent = await fs.readFile(privatePath, 'utf8')
      expect(privateContent).toContain('BEGIN PRIVATE KEY')

      // Verify public key is base64-encoded
      const publicContent = await fs.readFile(publicKeyPath, 'utf8')
      expect(publicContent.trim().length).toBeGreaterThan(0)
    })
  })

  describe('integration: sign with FilesystemKeyProvider', () => {
    it('should successfully sign data using Ed25519 keys from provider', async () => {
      const privatePath = path.join(tmpDir, 'sign-private.pem')
      const publicKeyPath = path.join(tmpDir, 'sign-public.pem')

      // Import Ed25519 crypto functions
      const { sign, verify } = await import('../../src/crypto/ed25519.js')

      // Create provider and generate keys
      const signingProvider = new FilesystemKeyProvider({ privateKeyPath: privatePath })
      await signingProvider.generateKeyPair({ publicKeyPath })

      // Read the generated keys
      const privateKeyPem = await fs.readFile(privatePath, 'utf-8')
      const publicKeyBase64 = await fs.readFile(publicKeyPath, 'utf-8')

      // Sign data using Ed25519
      const testData = 'test data for signing'
      const signature = sign(testData, privateKeyPem)

      expect(signature).toBeTruthy()
      expect(typeof signature).toBe('string')

      // Verify signature using Ed25519
      const isValid = verify(testData, signature, publicKeyBase64)

      expect(isValid).toBe(true)
    })
  })
})
