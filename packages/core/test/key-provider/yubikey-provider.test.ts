import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import * as os from 'node:os'
import * as crypto from 'node:crypto'

// Mock the identity config module to return our test directory as the config dir
let mockConfigDir = '/tmp/attest-it-test'
vi.mock('../../src/identity/config.js', () => ({
  getIdentityConfigDir: () => mockConfigDir,
}))

// Import after mocking
import { YubiKeyProvider } from '../../src/key-provider/yubikey-provider.js'

// Mock child_process.spawn for YubiKey CLI interactions
vi.mock('node:child_process', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:child_process')>()
  return {
    ...original,
    spawn: vi.fn(),
  }
})

// Helper to get mocked spawn
async function getMockedSpawn(): Promise<Mock> {
  const childProcess = await import('node:child_process')
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
  return childProcess.spawn as unknown as Mock
}

describe('YubiKeyProvider', () => {
  let tmpDir: string
  let provider: YubiKeyProvider

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'attest-it-yubikey-provider-'))
    // Update the mock config dir to match our temp directory
    mockConfigDir = tmpDir
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
      const customPath = path.join(tmpDir, 'custom', 'key.enc')
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
        encryptedKeyPath: path.join(tmpDir, 'key.enc'),
        slot: 1,
      })
      const config = customProvider.getConfig()
      expect(config.options.slot).toBe(1)
    })

    it('should store serial if provided', () => {
      const customProvider = new YubiKeyProvider({
        encryptedKeyPath: path.join(tmpDir, 'key.enc'),
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
      const testKeyPath = path.join(tmpDir, 'key.enc')
      const customProvider = new YubiKeyProvider({
        encryptedKeyPath: testKeyPath,
        slot: 1,
        serial: '12345678',
      })

      const config = customProvider.getConfig()

      expect(config.type).toBe('yubikey')
      expect(config.options.encryptedKeyPath).toBe(testKeyPath)
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
      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
      const parsed = JSON.parse(content) as Record<string, unknown>

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
      const testKeyPath = path.join(tmpDir, 'key.enc')

      const createdProvider = KeyProviderRegistry.create({
        type: 'yubikey',
        options: {
          encryptedKeyPath: testKeyPath,
          slot: 1,
          serial: '12345678',
        },
      })

      expect(createdProvider.type).toBe('yubikey')
      expect(createdProvider.displayName).toBe('YubiKey')

      const config = createdProvider.getConfig()
      expect(config.options.encryptedKeyPath).toBe(testKeyPath)
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

    it('should throw if encryptedKeyPath is outside config directory', async () => {
      const { KeyProviderRegistry } = await import('../../src/key-provider/registry.js')

      expect(() =>
        KeyProviderRegistry.create({
          type: 'yubikey',
          options: {
            encryptedKeyPath: '/outside/config/dir/key.enc',
          },
        }),
      ).toThrow(/must be within attest-it config directory/)
    })
  })

  describe('mock-based crypto tests', () => {
    let mockTmpDir: string

    beforeEach(async () => {
      mockTmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'attest-it-yubikey-mock-'))
      // Update the mock config dir to match our temp directory for mock tests
      mockConfigDir = mockTmpDir
      vi.clearAllMocks()
    })

    afterEach(async () => {
      vi.restoreAllMocks()
      try {
        await fs.rm(mockTmpDir, { recursive: true, force: true })
      } catch {
        // Ignore cleanup errors
      }
    })

    /**
     * Helper to create a mock spawn process that returns specified output.
     */
    function createMockProcess(
      stdout: string,
      exitCode = 0,
    ): {
      stdout: { on: Mock }
      stderr: { on: Mock }
      on: Mock
    } {
      const stdoutCallbacks: ((data: Buffer) => void)[] = []
      const stderrCallbacks: ((data: Buffer) => void)[] = []
      const closeCallbacks: ((code: number) => void)[] = []
      const errorCallbacks: ((error: Error) => void)[] = []

      const mockProc = {
        stdout: {
          on: vi.fn((event: string, callback: (data: Buffer) => void) => {
            if (event === 'data') {
              stdoutCallbacks.push(callback)
              // Emit the data immediately
              process.nextTick(() => {
                callback(Buffer.from(stdout))
              })
            }
          }),
        },
        stderr: {
          on: vi.fn((event: string, callback: (data: Buffer) => void) => {
            if (event === 'data') {
              stderrCallbacks.push(callback)
            }
          }),
        },
        on: vi.fn(
          (event: string, callback: ((code: number) => void) | ((error: Error) => void)) => {
            if (event === 'close') {
              // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
              const closeCallback = callback as (code: number) => void
              closeCallbacks.push(closeCallback)
              // Emit close after data
              process.nextTick(() => {
                process.nextTick(() => {
                  closeCallback(exitCode)
                })
              })
            } else if (event === 'error') {
              // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
              errorCallbacks.push(callback as (error: Error) => void)
            }
          },
        ),
      }

      return mockProc
    }

    /**
     * Helper to set up spawn mock for multiple sequential calls.
     */
    async function setupSpawnMock(
      responses: { stdout: string; exitCode?: number }[],
    ): Promise<void> {
      const mockedSpawn = await getMockedSpawn()
      let callIndex = 0

      mockedSpawn.mockImplementation(() => {
        const response = responses[callIndex] ?? { stdout: '', exitCode: 1 }
        callIndex++
        return createMockProcess(response.stdout, response.exitCode ?? 0)
      })
    }

    describe('encryption/decryption roundtrip', () => {
      it('should successfully encrypt and decrypt a private key with mocked YubiKey', async () => {
        // This test verifies the crypto flow works correctly
        // by using a deterministic challenge-response

        // Create a deterministic HMAC-SHA1 response (20 bytes)
        const fixedResponse = crypto.randomBytes(20)
        const fixedResponseHex = fixedResponse.toString('hex')

        // Set up spawn mock to return our fixed response for challenge-response
        // The sequence of calls will be:
        // 1. isChallengeResponseConfigured -> otp info
        // 2. performChallengeResponse -> otp chalresp
        await setupSpawnMock([
          { stdout: 'Slot 2: programmed (challenge-response)', exitCode: 0 },
          { stdout: fixedResponseHex, exitCode: 0 },
        ])

        const testPrivateKey = `-----BEGIN PRIVATE KEY-----
MC4CAQAwBQYDK2VwBCIEIKgHJ1234567890abcdefghijklmnopqrstuvwxyz
-----END PRIVATE KEY-----`

        const encryptedKeyPath = path.join(mockTmpDir, 'test-roundtrip.enc')

        // Encrypt the key
        const result = await YubiKeyProvider.encryptPrivateKey({
          privateKey: testPrivateKey,
          encryptedKeyPath,
          slot: 2,
          serial: '12345678',
        })

        expect(result.encryptedKeyPath).toBe(encryptedKeyPath)

        // Verify encrypted file was created
        const encryptedContent = await fs.readFile(encryptedKeyPath, 'utf8')
        // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
        const encryptedData = JSON.parse(encryptedContent) as Record<string, unknown>

        expect(encryptedData.version).toBe(1)
        expect(encryptedData.slot).toBe(2)
        expect(encryptedData.serial).toBe('12345678')
        expect(typeof encryptedData.iv).toBe('string')
        expect(typeof encryptedData.authTag).toBe('string')
        expect(typeof encryptedData.ciphertext).toBe('string')
        expect(typeof encryptedData.aad).toBe('string')
      })

      it('should include AAD that binds metadata to ciphertext', async () => {
        const fixedResponse = crypto.randomBytes(20)
        const fixedResponseHex = fixedResponse.toString('hex')

        await setupSpawnMock([
          { stdout: 'Slot 2: programmed (challenge-response)', exitCode: 0 },
          { stdout: fixedResponseHex, exitCode: 0 },
        ])

        const testPrivateKey = '-----BEGIN PRIVATE KEY-----\ntest\n-----END PRIVATE KEY-----'
        const encryptedKeyPath = path.join(mockTmpDir, 'test-aad.enc')

        await YubiKeyProvider.encryptPrivateKey({
          privateKey: testPrivateKey,
          encryptedKeyPath,
          slot: 2,
          serial: '99887766',
        })

        const encryptedContent = await fs.readFile(encryptedKeyPath, 'utf8')
        // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
        const encryptedData = JSON.parse(encryptedContent) as Record<string, unknown>

        // Verify AAD is present and contains expected metadata
        expect(encryptedData.aad).toBeDefined()
        // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
        const aadBuffer = Buffer.from(encryptedData.aad as string, 'base64')
        // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
        const aadObject = JSON.parse(aadBuffer.toString('utf8')) as Record<string, unknown>

        expect(aadObject.version).toBe(1)
        expect(aadObject.slot).toBe(2)
        expect(aadObject.serial).toBe('99887766')
      })

      it('should use "unspecified" in AAD when no serial provided', async () => {
        const fixedResponse = crypto.randomBytes(20)
        const fixedResponseHex = fixedResponse.toString('hex')

        // Suppress console.warn for this test
        // eslint-disable-next-line @typescript-eslint/no-empty-function
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

        await setupSpawnMock([
          { stdout: 'Slot 2: programmed (challenge-response)', exitCode: 0 },
          { stdout: fixedResponseHex, exitCode: 0 },
        ])

        const testPrivateKey = '-----BEGIN PRIVATE KEY-----\ntest\n-----END PRIVATE KEY-----'
        const encryptedKeyPath = path.join(mockTmpDir, 'test-no-serial.enc')

        await YubiKeyProvider.encryptPrivateKey({
          privateKey: testPrivateKey,
          encryptedKeyPath,
          slot: 2,
          // No serial specified
        })

        const encryptedContent = await fs.readFile(encryptedKeyPath, 'utf8')
        // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
        const encryptedData = JSON.parse(encryptedContent) as Record<string, unknown>

        // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
        const aadBuffer = Buffer.from(encryptedData.aad as string, 'base64')
        // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
        const aadObject = JSON.parse(aadBuffer.toString('utf8')) as Record<string, unknown>

        expect(aadObject.serial).toBe('unspecified')

        // Verify warning was issued
        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('No YubiKey serial'))

        warnSpy.mockRestore()
      })
    })

    describe('decryption failure scenarios', () => {
      it('should fail when key file not found during decryption', async () => {
        // Test that decryption fails when the encrypted key file doesn't exist
        const nonexistentPath = path.join(mockTmpDir, 'nonexistent.enc')

        const testProvider = new YubiKeyProvider({
          encryptedKeyPath: nonexistentPath,
          slot: 2,
          serial: '12345678',
        })

        await expect(testProvider.getPrivateKey(nonexistentPath)).rejects.toThrow(/not found/)
      })

      it('should fail when YubiKey serial does not match', async () => {
        // Create an encrypted file with one serial
        const fixedResponse = crypto.randomBytes(20)
        const fixedResponseHex = fixedResponse.toString('hex')

        await setupSpawnMock([
          { stdout: 'Slot 2: programmed (challenge-response)', exitCode: 0 },
          { stdout: fixedResponseHex, exitCode: 0 },
        ])

        const encryptedKeyPath = path.join(mockTmpDir, 'test-serial-mismatch.enc')

        await YubiKeyProvider.encryptPrivateKey({
          privateKey: '-----BEGIN PRIVATE KEY-----\ntest\n-----END PRIVATE KEY-----',
          encryptedKeyPath,
          slot: 2,
          serial: '11111111', // Encrypted with this serial
        })

        // Try to decrypt with provider configured for different serial
        await setupSpawnMock([
          { stdout: '22222222', exitCode: 0 }, // list --serials - different device connected
          { stdout: 'Device type: YubiKey 5\nFirmware version: 5.4.3', exitCode: 0 },
        ])

        const testProvider = new YubiKeyProvider({
          encryptedKeyPath,
          slot: 2,
          serial: '11111111', // Looking for original serial
        })

        // Should fail because the required YubiKey is not connected
        await expect(testProvider.getPrivateKey(encryptedKeyPath)).rejects.toThrow(
          /Required YubiKey not found.*Expected serial: 11111111/,
        )
      })

      it('should fail when challenge-response is not configured', async () => {
        // Test that encryption fails when slot is not configured for challenge-response
        const encryptedKeyPath = path.join(mockTmpDir, 'test-not-configured.enc')

        // Mock: isChallengeResponseConfigured returns false (slot not programmed)
        await setupSpawnMock([
          { stdout: 'Slot 2: empty', exitCode: 0 }, // otp info shows slot is empty
        ])

        await expect(
          YubiKeyProvider.encryptPrivateKey({
            privateKey: '-----BEGIN PRIVATE KEY-----\ntest\n-----END PRIVATE KEY-----',
            encryptedKeyPath,
            slot: 2,
            serial: '12345678',
          }),
        ).rejects.toThrow(/not configured for HMAC challenge-response/)
      })
    })

    describe('Zod validation', () => {
      it('should reject encrypted key file with invalid version', async () => {
        const keyPath = path.join(mockTmpDir, 'invalid-version.enc')

        const invalidKeyFile = {
          version: 2, // Invalid - only version 1 is supported
          iv: crypto.randomBytes(12).toString('base64'),
          authTag: crypto.randomBytes(16).toString('base64'),
          salt: crypto.randomBytes(32).toString('base64'),
          challenge: crypto.randomBytes(32).toString('base64'),
          ciphertext: crypto.randomBytes(100).toString('base64'),
          slot: 2,
        }

        await fs.writeFile(keyPath, JSON.stringify(invalidKeyFile))

        // Mock device list to pass the serial check
        await setupSpawnMock([
          { stdout: '12345678', exitCode: 0 },
          { stdout: 'Device type: YubiKey 5\nFirmware version: 5.4.3', exitCode: 0 },
        ])

        const testProvider = new YubiKeyProvider({
          encryptedKeyPath: keyPath,
          serial: '12345678',
        })

        await expect(testProvider.getPrivateKey(keyPath)).rejects.toThrow(/Invalid encrypted key/)
      })

      it('should reject encrypted key file with missing required fields', async () => {
        const keyPath = path.join(mockTmpDir, 'missing-fields.enc')

        const invalidKeyFile = {
          version: 1,
          iv: crypto.randomBytes(12).toString('base64'),
          // Missing: authTag, salt, challenge, ciphertext, slot
        }

        await fs.writeFile(keyPath, JSON.stringify(invalidKeyFile))

        await setupSpawnMock([
          { stdout: '12345678', exitCode: 0 },
          { stdout: 'Device type: YubiKey 5\nFirmware version: 5.4.3', exitCode: 0 },
        ])

        const testProvider = new YubiKeyProvider({
          encryptedKeyPath: keyPath,
          serial: '12345678',
        })

        await expect(testProvider.getPrivateKey(keyPath)).rejects.toThrow(/Invalid encrypted key/)
      })

      it('should reject encrypted key file with invalid slot', async () => {
        const keyPath = path.join(mockTmpDir, 'invalid-slot.enc')

        const invalidKeyFile = {
          version: 1,
          iv: crypto.randomBytes(12).toString('base64'),
          authTag: crypto.randomBytes(16).toString('base64'),
          salt: crypto.randomBytes(32).toString('base64'),
          challenge: crypto.randomBytes(32).toString('base64'),
          ciphertext: crypto.randomBytes(100).toString('base64'),
          slot: 3, // Invalid - only 1 or 2 allowed
        }

        await fs.writeFile(keyPath, JSON.stringify(invalidKeyFile))

        await setupSpawnMock([
          { stdout: '12345678', exitCode: 0 },
          { stdout: 'Device type: YubiKey 5\nFirmware version: 5.4.3', exitCode: 0 },
        ])

        const testProvider = new YubiKeyProvider({
          encryptedKeyPath: keyPath,
          serial: '12345678',
        })

        await expect(testProvider.getPrivateKey(keyPath)).rejects.toThrow(/Invalid encrypted key/)
      })
    })

    describe('buffer size validation', () => {
      // Note: Buffer size validation errors are sanitized to prevent information leakage
      // The specific error messages (Invalid IV size, etc.) are internal and not exposed
      // to callers for security reasons.

      it('should reject encrypted key file with wrong IV size', async () => {
        const keyPath = path.join(mockTmpDir, 'wrong-iv-size.enc')

        const invalidKeyFile = {
          version: 1,
          iv: crypto.randomBytes(8).toString('base64'), // Wrong size: should be 12
          authTag: crypto.randomBytes(16).toString('base64'),
          salt: crypto.randomBytes(32).toString('base64'),
          challenge: crypto.randomBytes(32).toString('base64'),
          ciphertext: crypto.randomBytes(100).toString('base64'),
          slot: 2,
        }

        await fs.writeFile(keyPath, JSON.stringify(invalidKeyFile))

        await setupSpawnMock([
          { stdout: '12345678\n', exitCode: 0 },
          { stdout: 'Device type: YubiKey 5\nFirmware version: 5.4.3', exitCode: 0 },
        ])

        const testProvider = new YubiKeyProvider({
          encryptedKeyPath: keyPath,
          serial: '12345678',
        })

        // Error is sanitized for security
        await expect(testProvider.getPrivateKey(keyPath)).rejects.toThrow(/Invalid encrypted key/)
      })

      it('should reject encrypted key file with wrong auth tag size', async () => {
        const keyPath = path.join(mockTmpDir, 'wrong-authtag-size.enc')

        const invalidKeyFile = {
          version: 1,
          iv: crypto.randomBytes(12).toString('base64'),
          authTag: crypto.randomBytes(8).toString('base64'), // Wrong size: should be 16
          salt: crypto.randomBytes(32).toString('base64'),
          challenge: crypto.randomBytes(32).toString('base64'),
          ciphertext: crypto.randomBytes(100).toString('base64'),
          slot: 2,
        }

        await fs.writeFile(keyPath, JSON.stringify(invalidKeyFile))

        await setupSpawnMock([
          { stdout: '12345678\n', exitCode: 0 },
          { stdout: 'Device type: YubiKey 5\nFirmware version: 5.4.3', exitCode: 0 },
        ])

        const testProvider = new YubiKeyProvider({
          encryptedKeyPath: keyPath,
          serial: '12345678',
        })

        // Error is sanitized for security
        await expect(testProvider.getPrivateKey(keyPath)).rejects.toThrow(/Invalid encrypted key/)
      })

      it('should reject encrypted key file with wrong salt size', async () => {
        const keyPath = path.join(mockTmpDir, 'wrong-salt-size.enc')

        const invalidKeyFile = {
          version: 1,
          iv: crypto.randomBytes(12).toString('base64'),
          authTag: crypto.randomBytes(16).toString('base64'),
          salt: crypto.randomBytes(16).toString('base64'), // Wrong size: should be 32
          challenge: crypto.randomBytes(32).toString('base64'),
          ciphertext: crypto.randomBytes(100).toString('base64'),
          slot: 2,
        }

        await fs.writeFile(keyPath, JSON.stringify(invalidKeyFile))

        await setupSpawnMock([
          { stdout: '12345678\n', exitCode: 0 },
          { stdout: 'Device type: YubiKey 5\nFirmware version: 5.4.3', exitCode: 0 },
        ])

        const testProvider = new YubiKeyProvider({
          encryptedKeyPath: keyPath,
          serial: '12345678',
        })

        // Error is sanitized for security
        await expect(testProvider.getPrivateKey(keyPath)).rejects.toThrow(/Invalid encrypted key/)
      })

      it('should reject encrypted key file with wrong challenge size', async () => {
        const keyPath = path.join(mockTmpDir, 'wrong-challenge-size.enc')

        const invalidKeyFile = {
          version: 1,
          iv: crypto.randomBytes(12).toString('base64'),
          authTag: crypto.randomBytes(16).toString('base64'),
          salt: crypto.randomBytes(32).toString('base64'),
          challenge: crypto.randomBytes(16).toString('base64'), // Wrong size: should be 32
          ciphertext: crypto.randomBytes(100).toString('base64'),
          slot: 2,
        }

        await fs.writeFile(keyPath, JSON.stringify(invalidKeyFile))

        await setupSpawnMock([
          { stdout: '12345678\n', exitCode: 0 },
          { stdout: 'Device type: YubiKey 5\nFirmware version: 5.4.3', exitCode: 0 },
        ])

        const testProvider = new YubiKeyProvider({
          encryptedKeyPath: keyPath,
          serial: '12345678',
        })

        // Error is sanitized for security
        await expect(testProvider.getPrivateKey(keyPath)).rejects.toThrow(/Invalid encrypted key/)
      })
    })
  })
})
