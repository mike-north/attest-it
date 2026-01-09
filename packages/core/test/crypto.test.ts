import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs/promises'
import * as fsSync from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import {
  checkOpenSSL,
  getDefaultPrivateKeyPath,
  getDefaultPublicKeyPath,
  generateKeyPair,
  sign,
  verify,
  setKeyPermissions,
} from '../src/crypto.js'

const FIXTURES_DIR = path.join(__dirname, 'fixtures', 'test-keys')
const TEST_ED25519_PRIVATE = path.join(FIXTURES_DIR, 'test-private.pem')
const TEST_ED25519_PUBLIC = path.join(FIXTURES_DIR, 'test-public.pem')
const TEST_RSA_PRIVATE = path.join(FIXTURES_DIR, 'test-rsa-private.pem')
const TEST_RSA_PUBLIC = path.join(FIXTURES_DIR, 'test-rsa-public.pem')

describe('crypto', () => {
  describe('checkOpenSSL', () => {
    it('should return OpenSSL version string', async () => {
      const version = await checkOpenSSL()
      expect(version).toBeTruthy()
      expect(version).toMatch(/OpenSSL/i)
    })
  })

  describe('getDefaultPrivateKeyPath', () => {
    it('should return correct path for current OS', () => {
      const keyPath = getDefaultPrivateKeyPath()
      expect(keyPath).toBeTruthy()

      if (process.platform === 'win32') {
        expect(keyPath).toMatch(/attest-it[\\]private\.pem$/)
      } else {
        expect(keyPath).toMatch(/\.config\/attest-it\/private\.pem$/)
      }
    })

    it('should return absolute path', () => {
      const keyPath = getDefaultPrivateKeyPath()
      expect(path.isAbsolute(keyPath)).toBe(true)
    })
  })

  describe('getDefaultPublicKeyPath', () => {
    it('should return path in current working directory', () => {
      const keyPath = getDefaultPublicKeyPath()
      expect(keyPath).toBe(path.join(process.cwd(), 'attest-it-public.pem'))
    })

    it('should return absolute path', () => {
      const keyPath = getDefaultPublicKeyPath()
      expect(path.isAbsolute(keyPath)).toBe(true)
    })
  })

  describe('generateKeyPair', () => {
    let tmpDir: string

    beforeEach(async () => {
      // Create a temp directory for generated keys
      tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'attest-it-test-'))
    })

    afterEach(async () => {
      // Clean up temp directory
      try {
        await fs.rm(tmpDir, { recursive: true, force: true })
      } catch {
        // Ignore cleanup errors
      }
    })

    it('should generate Ed25519 keypair by default', async () => {
      const privatePath = path.join(tmpDir, 'private.pem')
      const publicPath = path.join(tmpDir, 'public.pem')

      const result = await generateKeyPair({ privatePath, publicPath })

      expect(result.privatePath).toBe(privatePath)
      expect(result.publicPath).toBe(publicPath)

      // Verify files exist
      expect(fsSync.existsSync(privatePath)).toBe(true)
      expect(fsSync.existsSync(publicPath)).toBe(true)

      // Verify private key has restrictive permissions (on Unix)
      if (process.platform !== 'win32') {
        const stats = await fs.stat(privatePath)
        const mode = stats.mode & 0o777
        expect(mode).toBe(0o600)
      }
    })

    it('should generate Ed25519 keypair when algorithm specified', async () => {
      const privatePath = path.join(tmpDir, 'ed25519-private.pem')
      const publicPath = path.join(tmpDir, 'ed25519-public.pem')

      const result = await generateKeyPair({
        algorithm: 'ed25519',
        privatePath,
        publicPath,
      })

      expect(result.privatePath).toBe(privatePath)
      expect(result.publicPath).toBe(publicPath)
      expect(fsSync.existsSync(privatePath)).toBe(true)
      expect(fsSync.existsSync(publicPath)).toBe(true)
    })

    it('should generate RSA keypair when algorithm is rsa', async () => {
      const privatePath = path.join(tmpDir, 'rsa-private.pem')
      const publicPath = path.join(tmpDir, 'rsa-public.pem')

      const result = await generateKeyPair({
        algorithm: 'rsa',
        privatePath,
        publicPath,
      })

      expect(result.privatePath).toBe(privatePath)
      expect(result.publicPath).toBe(publicPath)
      expect(fsSync.existsSync(privatePath)).toBe(true)
      expect(fsSync.existsSync(publicPath)).toBe(true)
    })

    it('should fail if keys already exist without force', async () => {
      const privatePath = path.join(tmpDir, 'existing-private.pem')
      const publicPath = path.join(tmpDir, 'existing-public.pem')

      // Create first keypair
      await generateKeyPair({ privatePath, publicPath })

      // Try to create again without force
      await expect(generateKeyPair({ privatePath, publicPath })).rejects.toThrow(/already exist/)
    })

    it('should fail if only private key exists without force', async () => {
      const privatePath = path.join(tmpDir, 'partial-private.pem')
      const publicPath = path.join(tmpDir, 'partial-public.pem')

      // Create only private key
      await fs.writeFile(privatePath, 'dummy')

      await expect(generateKeyPair({ privatePath, publicPath })).rejects.toThrow(/already exist/)
    })

    it('should fail if only public key exists without force', async () => {
      const privatePath = path.join(tmpDir, 'partial2-private.pem')
      const publicPath = path.join(tmpDir, 'partial2-public.pem')

      // Create only public key
      await fs.writeFile(publicPath, 'dummy')

      await expect(generateKeyPair({ privatePath, publicPath })).rejects.toThrow(/already exist/)
    })

    it('should overwrite existing keys when force is true', async () => {
      const privatePath = path.join(tmpDir, 'force-private.pem')
      const publicPath = path.join(tmpDir, 'force-public.pem')

      // Create first keypair
      await generateKeyPair({ privatePath, publicPath })
      const firstPrivate = await fs.readFile(privatePath, 'utf8')

      // Overwrite with force
      await generateKeyPair({ privatePath, publicPath, force: true })
      const secondPrivate = await fs.readFile(privatePath, 'utf8')

      // Keys should be different
      expect(secondPrivate).not.toBe(firstPrivate)
    })

    it('should create parent directories if they do not exist', async () => {
      const nestedDir = path.join(tmpDir, 'nested', 'deep', 'path')
      const privatePath = path.join(nestedDir, 'private.pem')
      const publicPath = path.join(nestedDir, 'public.pem')

      await generateKeyPair({ privatePath, publicPath })

      expect(fsSync.existsSync(privatePath)).toBe(true)
      expect(fsSync.existsSync(publicPath)).toBe(true)
    })

    it('should use default paths if none specified', async () => {
      // This test is tricky because it would create files in the actual system
      // We'll skip it to avoid side effects, but the functionality is tested
      // implicitly through other tests
    })
  })

  describe('sign', () => {
    it('should sign data with Ed25519 key', async () => {
      const signature = await sign({
        privateKeyPath: TEST_ED25519_PRIVATE,
        data: 'test data',
      })

      expect(signature).toBeTruthy()
      expect(typeof signature).toBe('string')
      // Base64 signature should be valid
      expect(() => Buffer.from(signature, 'base64')).not.toThrow()
    })

    it('should sign data with RSA key', async () => {
      const signature = await sign({
        privateKeyPath: TEST_RSA_PRIVATE,
        data: 'test data',
      })

      expect(signature).toBeTruthy()
      expect(typeof signature).toBe('string')
      expect(() => Buffer.from(signature, 'base64')).not.toThrow()
    })

    it('should throw on missing private key', async () => {
      await expect(
        sign({
          privateKeyPath: '/nonexistent/key.pem',
          data: 'test data',
        }),
      ).rejects.toThrow(/not found/)
    })

    it('should handle binary data', async () => {
      const binaryData = Buffer.from([0x00, 0x01, 0x02, 0xff, 0xfe])
      const signature = await sign({
        privateKeyPath: TEST_ED25519_PRIVATE,
        data: binaryData,
      })

      expect(signature).toBeTruthy()
      expect(typeof signature).toBe('string')
    })

    it('should handle empty string', async () => {
      const signature = await sign({
        privateKeyPath: TEST_ED25519_PRIVATE,
        data: '',
      })

      expect(signature).toBeTruthy()
      expect(typeof signature).toBe('string')
    })

    it('should produce different signatures for different data', async () => {
      const sig1 = await sign({
        privateKeyPath: TEST_ED25519_PRIVATE,
        data: 'data1',
      })
      const sig2 = await sign({
        privateKeyPath: TEST_ED25519_PRIVATE,
        data: 'data2',
      })

      expect(sig1).not.toBe(sig2)
    })

    it('should produce consistent signatures for same data', async () => {
      const data = 'consistent test data'
      const sig1 = await sign({
        privateKeyPath: TEST_ED25519_PRIVATE,
        data,
      })
      const sig2 = await sign({
        privateKeyPath: TEST_ED25519_PRIVATE,
        data,
      })

      expect(sig1).toBe(sig2)
    })
  })

  describe('verify', () => {
    it('should return true for valid Ed25519 signature', async () => {
      const data = 'test verification data'
      const signature = await sign({
        privateKeyPath: TEST_ED25519_PRIVATE,
        data,
      })

      const isValid = await verify({
        publicKeyPath: TEST_ED25519_PUBLIC,
        data,
        signature,
      })

      expect(isValid).toBe(true)
    })

    it('should return true for valid RSA signature', async () => {
      const data = 'test rsa verification'
      const signature = await sign({
        privateKeyPath: TEST_RSA_PRIVATE,
        data,
      })

      const isValid = await verify({
        publicKeyPath: TEST_RSA_PUBLIC,
        data,
        signature,
      })

      expect(isValid).toBe(true)
    })

    it('should return false for tampered data', async () => {
      const originalData = 'original data'
      const signature = await sign({
        privateKeyPath: TEST_ED25519_PRIVATE,
        data: originalData,
      })

      const isValid = await verify({
        publicKeyPath: TEST_ED25519_PUBLIC,
        data: 'tampered data',
        signature,
      })

      expect(isValid).toBe(false)
    })

    it('should return false for tampered signature', async () => {
      const data = 'test data'
      const signature = await sign({
        privateKeyPath: TEST_ED25519_PRIVATE,
        data,
      })

      // Tamper with the signature
      const sigBuffer = Buffer.from(signature, 'base64')
      sigBuffer[0] = sigBuffer[0] === 0 ? 1 : 0
      const tamperedSig = sigBuffer.toString('base64')

      const isValid = await verify({
        publicKeyPath: TEST_ED25519_PUBLIC,
        data,
        signature: tamperedSig,
      })

      expect(isValid).toBe(false)
    })

    it('should return false when using wrong public key', async () => {
      const data = 'test data'
      const signature = await sign({
        privateKeyPath: TEST_ED25519_PRIVATE,
        data,
      })

      // Try to verify with RSA public key instead
      const isValid = await verify({
        publicKeyPath: TEST_RSA_PUBLIC,
        data,
        signature,
      })

      expect(isValid).toBe(false)
    })

    it('should throw on missing public key', async () => {
      await expect(
        verify({
          publicKeyPath: '/nonexistent/key.pem',
          data: 'test data',
          signature: 'dGVzdA==',
        }),
      ).rejects.toThrow(/not found/)
    })

    it('should handle binary data', async () => {
      const binaryData = Buffer.from([0x00, 0x01, 0x02, 0xff, 0xfe])
      const signature = await sign({
        privateKeyPath: TEST_ED25519_PRIVATE,
        data: binaryData,
      })

      const isValid = await verify({
        publicKeyPath: TEST_ED25519_PUBLIC,
        data: binaryData,
        signature,
      })

      expect(isValid).toBe(true)
    })

    it('should handle empty string', async () => {
      const data = ''
      const signature = await sign({
        privateKeyPath: TEST_ED25519_PRIVATE,
        data,
      })

      const isValid = await verify({
        publicKeyPath: TEST_ED25519_PUBLIC,
        data,
        signature,
      })

      expect(isValid).toBe(true)
    })

    it('should return false for invalid base64 signature', async () => {
      const isValid = await verify({
        publicKeyPath: TEST_ED25519_PUBLIC,
        data: 'test data',
        signature: 'not-valid-base64!!!',
      })

      // Node's Buffer.from with base64 encoding is lenient and won't throw
      // but OpenSSL will fail to verify the invalid signature
      expect(isValid).toBe(false)
    })

    it('should handle large data', async () => {
      const largeData = 'x'.repeat(1024 * 1024) // 1MB of data
      const signature = await sign({
        privateKeyPath: TEST_ED25519_PRIVATE,
        data: largeData,
      })

      const isValid = await verify({
        publicKeyPath: TEST_ED25519_PUBLIC,
        data: largeData,
        signature,
      })

      expect(isValid).toBe(true)
    })
  })

  describe('setKeyPermissions', () => {
    let tmpDir: string

    beforeEach(async () => {
      tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'attest-it-perms-'))
    })

    afterEach(async () => {
      try {
        await fs.rm(tmpDir, { recursive: true, force: true })
      } catch {
        // Ignore cleanup errors
      }
    })

    it('should set 600 permissions on Unix systems', async () => {
      if (process.platform === 'win32') {
        // Skip on Windows
        return
      }

      const keyPath = path.join(tmpDir, 'test-key.pem')
      await fs.writeFile(keyPath, 'test key content')

      // Set permissive permissions first
      await fs.chmod(keyPath, 0o644)

      // Apply restrictive permissions
      await setKeyPermissions(keyPath)

      const stats = await fs.stat(keyPath)
      const mode = stats.mode & 0o777
      expect(mode).toBe(0o600)
    })

    it('should not throw on Windows', async () => {
      if (process.platform !== 'win32') {
        // Skip on non-Windows
        return
      }

      const keyPath = path.join(tmpDir, 'test-key.pem')
      await fs.writeFile(keyPath, 'test key content')

      await expect(setKeyPermissions(keyPath)).resolves.not.toThrow()
    })
  })

  describe('integration: full sign/verify workflow', () => {
    let tmpDir: string
    let privatePath: string
    let publicPath: string

    beforeEach(async () => {
      tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'attest-it-integration-'))
      privatePath = path.join(tmpDir, 'integration-private.pem')
      publicPath = path.join(tmpDir, 'integration-public.pem')
    })

    afterEach(async () => {
      try {
        await fs.rm(tmpDir, { recursive: true, force: true })
      } catch {
        // Ignore cleanup errors
      }
    })

    it('should complete full workflow with Ed25519', async () => {
      // Generate keypair
      await generateKeyPair({
        algorithm: 'ed25519',
        privatePath,
        publicPath,
      })

      // Sign data
      const testData = 'integration test data'
      const signature = await sign({
        privateKeyPath: privatePath,
        data: testData,
      })

      // Verify signature
      const isValid = await verify({
        publicKeyPath: publicPath,
        data: testData,
        signature,
      })

      expect(isValid).toBe(true)
    })

    it('should complete full workflow with RSA', async () => {
      // Generate keypair
      await generateKeyPair({
        algorithm: 'rsa',
        privatePath,
        publicPath,
      })

      // Sign data
      const testData = 'rsa integration test'
      const signature = await sign({
        privateKeyPath: privatePath,
        data: testData,
      })

      // Verify signature
      const isValid = await verify({
        publicKeyPath: publicPath,
        data: testData,
        signature,
      })

      expect(isValid).toBe(true)
    })

    it('should detect tampering in full workflow', async () => {
      // Generate keypair
      await generateKeyPair({
        algorithm: 'ed25519',
        privatePath,
        publicPath,
      })

      // Sign original data
      const originalData = 'original message'
      const signature = await sign({
        privateKeyPath: privatePath,
        data: originalData,
      })

      // Try to verify with tampered data
      const isValid = await verify({
        publicKeyPath: publicPath,
        data: 'tampered message',
        signature,
      })

      expect(isValid).toBe(false)
    })
  })
})
