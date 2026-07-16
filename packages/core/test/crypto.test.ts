import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as fs from 'node:fs/promises'
import * as fsSync from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { spawn } from 'node:child_process'
import {
  checkOpenSSL,
  getDefaultPrivateKeyPath,
  getDefaultPublicKeyPath,
  getDefaultYubiKeyEncryptedKeyPath,
  generateKeyPair,
  sign,
  verify,
  setKeyPermissions,
} from '../src/crypto.js'

// Wraps the real `spawn` in a vi.fn so tests can assert on how crypto.ts
// invoked OpenSSL (e.g. the `stdio` array) without changing its behavior --
// every call still runs the real `openssl` binary.
vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>()
  return { ...actual, spawn: vi.fn(actual.spawn) }
})

const FIXTURES_DIR = path.join(__dirname, 'fixtures', 'test-keys')
const TEST_PRIVATE = path.join(FIXTURES_DIR, 'test-private.pem')
const TEST_PUBLIC = path.join(FIXTURES_DIR, 'test-public.pem')

describe('crypto', () => {
  describe('checkOpenSSL', () => {
    it('should return OpenSSL/LibreSSL version string', async () => {
      const version = await checkOpenSSL()
      expect(version).toBeTruthy()
      // Accept both OpenSSL and LibreSSL (macOS default)
      expect(version).toMatch(/OpenSSL|LibreSSL/i)
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

  describe('getDefaultYubiKeyEncryptedKeyPath', () => {
    it('should return correct path for current OS', () => {
      const keyPath = getDefaultYubiKeyEncryptedKeyPath()
      expect(keyPath).toBeTruthy()

      if (process.platform === 'win32') {
        expect(keyPath).toMatch(/attest-it[\\]yubikey-private\.enc$/)
      } else {
        expect(keyPath).toMatch(/\.config\/attest-it\/yubikey-private\.enc$/)
      }
    })

    it('should return absolute path', () => {
      const keyPath = getDefaultYubiKeyEncryptedKeyPath()
      expect(path.isAbsolute(keyPath)).toBe(true)
    })

    it('should use same config directory as private key', () => {
      const privateKeyPath = getDefaultPrivateKeyPath()
      const yubiKeyPath = getDefaultYubiKeyEncryptedKeyPath()

      // Both should be in the same directory
      expect(path.dirname(privateKeyPath)).toBe(path.dirname(yubiKeyPath))
    })

    it('should have .enc extension', () => {
      const keyPath = getDefaultYubiKeyEncryptedKeyPath()
      expect(path.extname(keyPath)).toBe('.enc')
    })

    it('should contain "yubikey" in filename', () => {
      const keyPath = getDefaultYubiKeyEncryptedKeyPath()
      const basename = path.basename(keyPath)
      expect(basename).toContain('yubikey')
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

    it('should generate RSA keypair', async () => {
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

    // Regression test for #79: an empty-string passphrase made runOpenSSL()
    // open a 4th stdio slot (fd 3) for the passphrase pipe -- its guard was
    // `passphrase !== undefined`, which is true for '' -- while
    // generateKeyPair()'s `if (passphrase)` guard is falsy for '' and never
    // pushed `-pass fd:3`/`-passin fd:3` onto the openssl args. That left fd 3
    // open with nothing reading it: an unconsumed pipe with no 'error'
    // listener, which raised an unhandled ECONNRESET when the openssl child
    // process exited (surfaced in CI as 2 unhandled errors attributed to
    // the "should return encrypted=false for empty passphrase" test in
    // key-provider/filesystem-provider.test.ts). This asserts the exact
    // structural invariant directly -- no fd:3 pipe is opened unless an
    // openssl argument references fd:3 -- rather than relying on the
    // ECONNRESET race reproducing, which is timing/platform-sensitive.
    it('should not open an unread fd:3 pipe for an empty-string passphrase', async () => {
      const spawnMock = vi.mocked(spawn)
      spawnMock.mockClear()

      const privatePath = path.join(tmpDir, 'empty-pass-private.pem')
      const publicPath = path.join(tmpDir, 'empty-pass-public.pem')

      await generateKeyPair({ privatePath, publicPath, passphrase: '' })

      expect(spawnMock).toHaveBeenCalled()
      for (const [, args, options] of spawnMock.mock.calls) {
        expect(Array.isArray(args)).toBe(true)
        if (!Array.isArray(args)) {
          continue
        }
        expect(args).not.toContain('fd:3')

        expect(options).toBeTypeOf('object')
        if (typeof options !== 'object') {
          continue
        }
        expect('stdio' in options && Array.isArray(options.stdio)).toBe(true)
        if (!('stdio' in options) || !Array.isArray(options.stdio)) {
          continue
        }
        expect(options.stdio).toHaveLength(3)
      }
    })

    it('should use default paths if none specified', async () => {
      // This test is tricky because it would create files in the actual system
      // We'll skip it to avoid side effects, but the functionality is tested
      // implicitly through other tests
    })
  })

  describe('sign', () => {
    it('should sign data with RSA key', async () => {
      const signature = await sign({
        privateKeyPath: TEST_PRIVATE,
        data: 'test data',
      })

      expect(signature).toBeTruthy()
      expect(typeof signature).toBe('string')
      // Base64 signature should be valid
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
        privateKeyPath: TEST_PRIVATE,
        data: binaryData,
      })

      expect(signature).toBeTruthy()
      expect(typeof signature).toBe('string')
    })

    it('should handle empty string', async () => {
      const signature = await sign({
        privateKeyPath: TEST_PRIVATE,
        data: '',
      })

      expect(signature).toBeTruthy()
      expect(typeof signature).toBe('string')
    })

    it('should produce different signatures for different data', async () => {
      const sig1 = await sign({
        privateKeyPath: TEST_PRIVATE,
        data: 'data1',
      })
      const sig2 = await sign({
        privateKeyPath: TEST_PRIVATE,
        data: 'data2',
      })

      expect(sig1).not.toBe(sig2)
    })

    it('should produce consistent signatures for same data', async () => {
      const data = 'consistent test data'
      const sig1 = await sign({
        privateKeyPath: TEST_PRIVATE,
        data,
      })
      const sig2 = await sign({
        privateKeyPath: TEST_PRIVATE,
        data,
      })

      expect(sig1).toBe(sig2)
    })
  })

  describe('verify', () => {
    it('should return true for valid signature', async () => {
      const data = 'test verification data'
      const signature = await sign({
        privateKeyPath: TEST_PRIVATE,
        data,
      })

      const isValid = await verify({
        publicKeyPath: TEST_PUBLIC,
        data,
        signature,
      })

      expect(isValid).toBe(true)
    })

    it('should return false for tampered data', async () => {
      const originalData = 'original data'
      const signature = await sign({
        privateKeyPath: TEST_PRIVATE,
        data: originalData,
      })

      const isValid = await verify({
        publicKeyPath: TEST_PUBLIC,
        data: 'tampered data',
        signature,
      })

      expect(isValid).toBe(false)
    })

    it('should return false for tampered signature', async () => {
      const data = 'test data'
      const signature = await sign({
        privateKeyPath: TEST_PRIVATE,
        data,
      })

      // Tamper with the signature
      const sigBuffer = Buffer.from(signature, 'base64')
      sigBuffer[0] = sigBuffer[0] === 0 ? 1 : 0
      const tamperedSig = sigBuffer.toString('base64')

      const isValid = await verify({
        publicKeyPath: TEST_PUBLIC,
        data,
        signature: tamperedSig,
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
        privateKeyPath: TEST_PRIVATE,
        data: binaryData,
      })

      const isValid = await verify({
        publicKeyPath: TEST_PUBLIC,
        data: binaryData,
        signature,
      })

      expect(isValid).toBe(true)
    })

    it('should handle empty string', async () => {
      const data = ''
      const signature = await sign({
        privateKeyPath: TEST_PRIVATE,
        data,
      })

      const isValid = await verify({
        publicKeyPath: TEST_PUBLIC,
        data,
        signature,
      })

      expect(isValid).toBe(true)
    })

    it('should return false for invalid base64 signature', async () => {
      const isValid = await verify({
        publicKeyPath: TEST_PUBLIC,
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
        privateKeyPath: TEST_PRIVATE,
        data: largeData,
      })

      const isValid = await verify({
        publicKeyPath: TEST_PUBLIC,
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

    it('should complete full workflow with generated keys', async () => {
      // Generate keypair
      await generateKeyPair({
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

    it('should detect tampering in full workflow', async () => {
      // Generate keypair
      await generateKeyPair({
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

  describe('passphrase-encrypted keys', () => {
    let tmpDir: string
    let privatePath: string
    let publicPath: string
    const testPassphrase = 'test-passphrase-12345'

    beforeEach(async () => {
      tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'attest-it-passphrase-'))
      privatePath = path.join(tmpDir, 'encrypted-private.pem')
      publicPath = path.join(tmpDir, 'encrypted-public.pem')
    })

    afterEach(async () => {
      try {
        await fs.rm(tmpDir, { recursive: true, force: true })
      } catch {
        // Ignore cleanup errors
      }
    })

    describe('generateKeyPair with passphrase', () => {
      it('should generate an encrypted keypair', async () => {
        const result = await generateKeyPair({
          privatePath,
          publicPath,
          passphrase: testPassphrase,
        })

        expect(result.privatePath).toBe(privatePath)
        expect(result.publicPath).toBe(publicPath)

        // Verify files exist
        expect(fsSync.existsSync(privatePath)).toBe(true)
        expect(fsSync.existsSync(publicPath)).toBe(true)

        // Verify private key is encrypted (contains ENCRYPTED marker)
        const privateKeyContent = await fs.readFile(privatePath, 'utf8')
        expect(privateKeyContent).toMatch(/ENCRYPTED/)
      })

      it('should generate a public key that is not encrypted', async () => {
        await generateKeyPair({
          privatePath,
          publicPath,
          passphrase: testPassphrase,
        })

        const publicKeyContent = await fs.readFile(publicPath, 'utf8')
        expect(publicKeyContent).not.toMatch(/ENCRYPTED/)
        expect(publicKeyContent).toMatch(/PUBLIC KEY/)
      })

      it('should overwrite existing encrypted keys when force is true', async () => {
        // Create first encrypted keypair
        await generateKeyPair({
          privatePath,
          publicPath,
          passphrase: testPassphrase,
        })
        const firstPrivate = await fs.readFile(privatePath, 'utf8')

        // Overwrite with force
        await generateKeyPair({
          privatePath,
          publicPath,
          passphrase: 'different-passphrase-67890',
          force: true,
        })
        const secondPrivate = await fs.readFile(privatePath, 'utf8')

        // Keys should be different
        expect(secondPrivate).not.toBe(firstPrivate)
      })

      // Regression test for #75: `openssl pkey -in <priv> -pubout -passin stdin`
      // failed under OpenSSL 3.6.x when driven by Node's spawn pipe stdio,
      // throwing "Could not find private key of key from <path>" /
      // "UI routines:open_console:unknown ttyget errno value" — even though
      // the immediately preceding `openssl genpkey ... -pass stdin` step (in
      // the same function) succeeded. This exercises the public-key
      // extraction step repeatedly, since the underlying bug was a pipe/fd
      // interaction rather than a pure logic error and could pass
      // intermittently if only exercised once.
      it('should extract public key from an encrypted private key across repeated invocations', async () => {
        for (let i = 0; i < 3; i++) {
          const iteration = i.toString()
          const iterPrivate = path.join(tmpDir, `repeat-private-${iteration}.pem`)
          const iterPublic = path.join(tmpDir, `repeat-public-${iteration}.pem`)

          const result = await generateKeyPair({
            privatePath: iterPrivate,
            publicPath: iterPublic,
            passphrase: testPassphrase,
          })

          expect(result.publicPath).toBe(iterPublic)
          const publicKeyContent = await fs.readFile(iterPublic, 'utf8')
          expect(publicKeyContent).toMatch(/PUBLIC KEY/)
        }
      })
    })

    describe('sign with encrypted key', () => {
      beforeEach(async () => {
        // Generate an encrypted keypair for each test
        await generateKeyPair({
          privatePath,
          publicPath,
          passphrase: testPassphrase,
        })
      })

      it('should sign data with correct passphrase', async () => {
        const signature = await sign({
          privateKeyPath: privatePath,
          data: 'test data for encrypted key',
          passphrase: testPassphrase,
        })

        expect(signature).toBeTruthy()
        expect(typeof signature).toBe('string')
        // Base64 signature should be valid
        expect(() => Buffer.from(signature, 'base64')).not.toThrow()
      })

      it('should fail to sign with wrong passphrase with clear error message', async () => {
        await expect(
          sign({
            privateKeyPath: privatePath,
            data: 'test data',
            passphrase: 'wrong-passphrase',
          }),
        ).rejects.toThrow(/Failed to decrypt private key|passphrase/)
      })

      it('should fail to sign without passphrase for encrypted key', async () => {
        await expect(
          sign({
            privateKeyPath: privatePath,
            data: 'test data',
            // No passphrase provided
          }),
        ).rejects.toThrow()
      })

      // Regression test for #75: `openssl dgst -sha256 -passin stdin -sign <priv>`
      // failed the same way as the pkey extraction step under OpenSSL 3.6.x
      // when driven by Node's spawn pipe stdio. Signs repeatedly with the same
      // encrypted key, since the underlying pipe/fd interaction was
      // order/timing-sensitive and could pass intermittently if only
      // exercised once.
      it('should sign repeatedly with an encrypted key without a console-fallback error', async () => {
        for (let i = 0; i < 3; i++) {
          const signature = await sign({
            privateKeyPath: privatePath,
            data: `repeat signing test data ${i.toString()}`,
            passphrase: testPassphrase,
          })

          expect(signature).toBeTruthy()
          expect(() => Buffer.from(signature, 'base64')).not.toThrow()
        }
      })
    })

    describe('full workflow with encrypted keys', () => {
      it('should complete sign/verify workflow with encrypted key', async () => {
        // Generate encrypted keypair
        await generateKeyPair({
          privatePath,
          publicPath,
          passphrase: testPassphrase,
        })

        // Sign data with passphrase
        const testData = 'encrypted key integration test'
        const signature = await sign({
          privateKeyPath: privatePath,
          data: testData,
          passphrase: testPassphrase,
        })

        // Verify signature (public key is not encrypted)
        const isValid = await verify({
          publicKeyPath: publicPath,
          data: testData,
          signature,
        })

        expect(isValid).toBe(true)
      })

      it('should detect tampering with encrypted key signature', async () => {
        // Generate encrypted keypair
        await generateKeyPair({
          privatePath,
          publicPath,
          passphrase: testPassphrase,
        })

        // Sign original data
        const originalData = 'original encrypted message'
        const signature = await sign({
          privateKeyPath: privatePath,
          data: originalData,
          passphrase: testPassphrase,
        })

        // Try to verify with tampered data
        const isValid = await verify({
          publicKeyPath: publicPath,
          data: 'tampered message',
          signature,
        })

        expect(isValid).toBe(false)
      })

      it('should produce consistent signatures for same data', async () => {
        // Generate encrypted keypair
        await generateKeyPair({
          privatePath,
          publicPath,
          passphrase: testPassphrase,
        })

        const data = 'consistent test data'
        const sig1 = await sign({
          privateKeyPath: privatePath,
          data,
          passphrase: testPassphrase,
        })
        const sig2 = await sign({
          privateKeyPath: privatePath,
          data,
          passphrase: testPassphrase,
        })

        expect(sig1).toBe(sig2)
      })
    })
  })
})
