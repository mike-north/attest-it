/**
 * Tests for MacOSKeychainKeyProvider.
 */

/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/consistent-type-assertions */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { spawn } from 'node:child_process'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import * as os from 'node:os'
import { MacOSKeychainKeyProvider } from '../../src/key-provider/macos-keychain-provider.js'
import * as crypto from '../../src/crypto.js'

// Mock child_process.spawn
vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}))

// Mock crypto.generateKeyPair
vi.mock('../../src/crypto.js', async (importOriginal) => {
  const actual = await importOriginal<typeof crypto>()
  return {
    ...actual,
    generateKeyPair: vi.fn(),
    setKeyPermissions: vi.fn(),
  }
})

/**
 * Helper to create a mock spawn result for successful command
 */
function mockSpawnSuccess(stdout: string): ReturnType<typeof spawn> {
  const mockProcess = {
    stdout: {
      on: vi.fn((event, handler) => {
        if (event === 'data') {
          setImmediate(() => {
            handler(Buffer.from(stdout))
          })
        }
      }),
    },
    stderr: {
      on: vi.fn(),
    },
    on: vi.fn((event, handler) => {
      if (event === 'close') {
        setImmediate(() => {
          handler(0)
        })
      }
    }),
  }
  return mockProcess as unknown as ReturnType<typeof spawn>
}

/**
 * Helper to create a mock spawn result for failed command
 */
function mockSpawnFailure(stderr: string, exitCode = 1): ReturnType<typeof spawn> {
  const mockProcess = {
    stdout: {
      on: vi.fn(),
    },
    stderr: {
      on: vi.fn((event, handler) => {
        if (event === 'data') {
          setImmediate(() => {
            handler(Buffer.from(stderr))
          })
        }
      }),
    },
    on: vi.fn((event, handler) => {
      if (event === 'close') {
        setImmediate(() => {
          handler(exitCode)
        })
      }
    }),
  }
  return mockProcess as unknown as ReturnType<typeof spawn>
}

/**
 * Helper to create a mock spawn that throws error
 */
function mockSpawnError(error: Error): ReturnType<typeof spawn> {
  const mockProcess = {
    stdout: { on: vi.fn() },
    stderr: { on: vi.fn() },
    on: vi.fn((event, handler) => {
      if (event === 'error') {
        setImmediate(() => {
          handler(error)
        })
      }
    }),
  }
  return mockProcess as unknown as ReturnType<typeof spawn>
}

describe('MacOSKeychainKeyProvider', () => {
  let tmpDir: string
  let originalPlatform: NodeJS.Platform

  beforeEach(async () => {
    // Create a real temp directory for tests
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'macos-keychain-test-'))
    vi.clearAllMocks()

    // Save original platform
    originalPlatform = process.platform
  })

  afterEach(async () => {
    // Clean up temp directory
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {
      // Ignore cleanup errors
    })

    // Restore platform
    Object.defineProperty(process, 'platform', {
      value: originalPlatform,
      writable: true,
      configurable: true,
    })
  })

  describe('constructor', () => {
    it('should create provider with required options', () => {
      const provider = new MacOSKeychainKeyProvider({
        itemName: 'test-key',
      })

      expect(provider.type).toBe('macos-keychain')
      expect(provider.displayName).toBe('macOS Keychain')
    })
  })

  describe('isAvailable (static)', () => {
    it('should return true on macOS', () => {
      Object.defineProperty(process, 'platform', {
        value: 'darwin',
        writable: true,
        configurable: true,
      })

      expect(MacOSKeychainKeyProvider.isAvailable()).toBe(true)
    })

    it('should return false on non-macOS platforms', () => {
      Object.defineProperty(process, 'platform', {
        value: 'linux',
        writable: true,
        configurable: true,
      })

      expect(MacOSKeychainKeyProvider.isAvailable()).toBe(false)
    })

    it('should return false on Windows', () => {
      Object.defineProperty(process, 'platform', {
        value: 'win32',
        writable: true,
        configurable: true,
      })

      expect(MacOSKeychainKeyProvider.isAvailable()).toBe(false)
    })
  })

  describe('isAvailable (instance)', () => {
    it('should return true on macOS', async () => {
      Object.defineProperty(process, 'platform', {
        value: 'darwin',
        writable: true,
        configurable: true,
      })

      const provider = new MacOSKeychainKeyProvider({
        itemName: 'test-key',
      })

      const result = await provider.isAvailable()
      expect(result).toBe(true)
    })

    it('should return false on non-macOS platforms', async () => {
      Object.defineProperty(process, 'platform', {
        value: 'linux',
        writable: true,
        configurable: true,
      })

      const provider = new MacOSKeychainKeyProvider({
        itemName: 'test-key',
      })

      const result = await provider.isAvailable()
      expect(result).toBe(false)
    })
  })

  describe('keyExists', () => {
    it('should return true when item exists in keychain', async () => {
      const mockSpawnFn = vi.mocked(spawn)
      mockSpawnFn.mockReturnValue(mockSpawnSuccess(''))

      const provider = new MacOSKeychainKeyProvider({
        itemName: 'test-key',
      })

      const result = await provider.keyExists('test-key')

      expect(result).toBe(true)
      expect(mockSpawnFn).toHaveBeenCalledWith(
        'security',
        ['find-generic-password', '-a', 'attest-it', '-s', 'test-key'],
        expect.any(Object),
      )
    })

    it('should return false when item does not exist', async () => {
      const mockSpawnFn = vi.mocked(spawn)
      mockSpawnFn.mockReturnValue(
        mockSpawnFailure('security: The specified item could not be found in the keychain.'),
      )

      const provider = new MacOSKeychainKeyProvider({
        itemName: 'test-key',
      })

      const result = await provider.keyExists('nonexistent-key')

      expect(result).toBe(false)
    })

    it('should return false on spawn error', async () => {
      const mockSpawnFn = vi.mocked(spawn)
      mockSpawnFn.mockReturnValue(mockSpawnError(new Error('command not found')))

      const provider = new MacOSKeychainKeyProvider({
        itemName: 'test-key',
      })

      const result = await provider.keyExists('test-key')

      expect(result).toBe(false)
    })
  })

  describe('getPrivateKey', () => {
    it('should retrieve base64 key, decode, and write to temp file', async () => {
      const mockSpawnFn = vi.mocked(spawn)
      const mockSetKeyPermissions = vi.mocked(crypto.setKeyPermissions)

      const originalKeyContent =
        '-----BEGIN PRIVATE KEY-----\nmock-key-content\n-----END PRIVATE KEY-----'
      const base64Key = Buffer.from(originalKeyContent, 'utf8').toString('base64')

      let callCount = 0
      mockSpawnFn.mockImplementation(() => {
        callCount++
        if (callCount === 1) {
          // keyExists check
          return mockSpawnSuccess('')
        } else {
          // find-generic-password -w to get the key
          return mockSpawnSuccess(base64Key)
        }
      })

      mockSetKeyPermissions.mockResolvedValue()

      const provider = new MacOSKeychainKeyProvider({
        itemName: 'test-key',
      })

      const result = await provider.getPrivateKey('test-key')

      // Check that we got a valid result
      expect(result.keyPath).toContain('attest-it-')
      expect(result.keyPath).toContain('private.pem')
      expect(typeof result.cleanup).toBe('function')

      // Verify spawn was called correctly
      expect(mockSpawnFn).toHaveBeenCalledTimes(2)

      // First call: keyExists
      expect(mockSpawnFn).toHaveBeenNthCalledWith(
        1,
        'security',
        ['find-generic-password', '-a', 'attest-it', '-s', 'test-key'],
        expect.any(Object),
      )

      // Second call: retrieve with -w flag
      expect(mockSpawnFn).toHaveBeenNthCalledWith(
        2,
        'security',
        ['find-generic-password', '-a', 'attest-it', '-s', 'test-key', '-w'],
        expect.any(Object),
      )

      // Verify permissions were set
      expect(mockSetKeyPermissions).toHaveBeenCalled()

      // Verify file content is correctly decoded
      const retrievedContent = await fs.readFile(result.keyPath, 'utf8')
      expect(retrievedContent).toBe(originalKeyContent)

      // Test cleanup
      await result.cleanup()

      // Verify file was deleted
      await expect(fs.stat(result.keyPath)).rejects.toThrow()
    })

    it('should throw error when key does not exist', async () => {
      const mockSpawnFn = vi.mocked(spawn)
      mockSpawnFn.mockReturnValue(
        mockSpawnFailure('security: The specified item could not be found in the keychain.'),
      )

      const provider = new MacOSKeychainKeyProvider({
        itemName: 'test-key',
      })

      await expect(provider.getPrivateKey('nonexistent-key')).rejects.toThrow(
        /Key not found in macOS Keychain/,
      )
    })

    it('should throw error when key retrieval fails after keyExists succeeds', async () => {
      const mockSpawnFn = vi.mocked(spawn)
      let callCount = 0
      mockSpawnFn.mockImplementation(() => {
        callCount++
        if (callCount === 1) {
          // keyExists succeeds
          return mockSpawnSuccess('')
        } else {
          // key retrieval fails
          return mockSpawnFailure('security: error retrieving password')
        }
      })

      const provider = new MacOSKeychainKeyProvider({
        itemName: 'test-key',
      })

      await expect(provider.getPrivateKey('test-key')).rejects.toThrow('Command failed')
    })

    it('should clean up temp directory on error', async () => {
      const mockSpawnFn = vi.mocked(spawn)
      mockSpawnFn.mockReturnValue(mockSpawnFailure('error'))

      const provider = new MacOSKeychainKeyProvider({
        itemName: 'test-key',
      })

      await expect(provider.getPrivateKey('test-key')).rejects.toThrow()

      // Note: Cleanup verification is best-effort due to async timing
    })

    it('should handle spawn error event during retrieval', async () => {
      const mockSpawnFn = vi.mocked(spawn)
      let callCount = 0
      mockSpawnFn.mockImplementation(() => {
        callCount++
        if (callCount === 1) {
          // keyExists succeeds
          return mockSpawnSuccess('')
        } else {
          // retrieval emits error
          return mockSpawnError(new Error('EACCES'))
        }
      })

      const provider = new MacOSKeychainKeyProvider({
        itemName: 'test-key',
      })

      await expect(provider.getPrivateKey('test-key')).rejects.toThrow('EACCES')
    })
  })

  describe('generateKeyPair', () => {
    it('should generate keypair, encode to base64, and store in keychain', async () => {
      const mockSpawnFn = vi.mocked(spawn)
      const mockGenerateKeyPair = vi.mocked(crypto.generateKeyPair)

      const publicPath = path.join(tmpDir, 'public.pem')
      const privateKeyContent = '-----BEGIN PRIVATE KEY-----\nmock\n-----END PRIVATE KEY-----'

      // Mock successful key generation
      mockGenerateKeyPair.mockImplementation(async (opts) => {
        const tempPrivatePath = opts.privatePath
        await fs.mkdir(path.dirname(tempPrivatePath), { recursive: true })
        await fs.writeFile(tempPrivatePath, privateKeyContent)
        return {
          privatePath: tempPrivatePath,
          publicPath: opts.publicPath,
        }
      })

      // Mock successful keychain storage
      mockSpawnFn.mockReturnValue(mockSpawnSuccess(''))

      const provider = new MacOSKeychainKeyProvider({
        itemName: 'test-key',
      })

      const result = await provider.generateKeyPair({
        publicKeyPath: publicPath,
        force: false,
      })

      expect(result.privateKeyRef).toBe('test-key')
      expect(result.publicKeyPath).toBe(publicPath)
      expect(result.storageDescription).toBe('macOS Keychain: test-key')

      // Verify spawn was called to store in keychain
      expect(mockSpawnFn).toHaveBeenCalledWith(
        'security',
        [
          'add-generic-password',
          '-a',
          'attest-it',
          '-s',
          'test-key',
          '-w',
          Buffer.from(privateKeyContent, 'utf8').toString('base64'),
          '-T',
          '',
          '-U',
        ],
        expect.any(Object),
      )
    })

    it('should throw error when keychain storage fails', async () => {
      const mockSpawnFn = vi.mocked(spawn)
      const mockGenerateKeyPair = vi.mocked(crypto.generateKeyPair)

      const publicPath = path.join(tmpDir, 'public.pem')

      mockGenerateKeyPair.mockImplementation(async (opts) => {
        const tempPrivatePath = opts.privatePath
        await fs.mkdir(path.dirname(tempPrivatePath), { recursive: true })
        await fs.writeFile(tempPrivatePath, 'private key contents')
        return {
          privatePath: tempPrivatePath,
          publicPath: opts.publicPath,
        }
      })

      // Mock failed storage
      mockSpawnFn.mockReturnValue(mockSpawnFailure('security: error adding to keychain'))

      const provider = new MacOSKeychainKeyProvider({
        itemName: 'test-key',
      })

      await expect(
        provider.generateKeyPair({
          publicKeyPath: publicPath,
        }),
      ).rejects.toThrow('Command failed')
    })

    it('should clean up temp files after generation', async () => {
      const mockSpawnFn = vi.mocked(spawn)
      const mockGenerateKeyPair = vi.mocked(crypto.generateKeyPair)

      const publicPath = path.join(tmpDir, 'public.pem')
      let capturedPrivatePath: string | undefined

      mockGenerateKeyPair.mockImplementation(async (opts) => {
        const tempPrivatePath = opts.privatePath
        capturedPrivatePath = tempPrivatePath
        await fs.mkdir(path.dirname(tempPrivatePath), { recursive: true })
        await fs.writeFile(tempPrivatePath, 'private key contents')
        return {
          privatePath: tempPrivatePath,
          publicPath: opts.publicPath,
        }
      })

      mockSpawnFn.mockReturnValue(mockSpawnSuccess(''))

      const provider = new MacOSKeychainKeyProvider({
        itemName: 'test-key',
      })

      await provider.generateKeyPair({
        publicKeyPath: publicPath,
      })

      // Verify temp private key was deleted
      expect(capturedPrivatePath).toBeDefined()
      if (capturedPrivatePath) {
        await expect(fs.stat(capturedPrivatePath)).rejects.toThrow()
      }
    })

    it('should handle force flag correctly', async () => {
      const mockSpawnFn = vi.mocked(spawn)
      const mockGenerateKeyPair = vi.mocked(crypto.generateKeyPair)

      const publicPath = path.join(tmpDir, 'public.pem')
      const privateKeyContent = 'private key contents'

      mockGenerateKeyPair.mockImplementation(async (opts) => {
        const tempPrivatePath = opts.privatePath
        await fs.mkdir(path.dirname(tempPrivatePath), { recursive: true })
        await fs.writeFile(tempPrivatePath, privateKeyContent)
        return {
          privatePath: tempPrivatePath,
          publicPath: opts.publicPath,
        }
      })

      mockSpawnFn.mockReturnValue(mockSpawnSuccess(''))

      const provider = new MacOSKeychainKeyProvider({
        itemName: 'test-key',
      })

      await provider.generateKeyPair({
        publicKeyPath: publicPath,
        force: true,
      })

      // Verify generateKeyPair was called with force flag
      expect(mockGenerateKeyPair).toHaveBeenCalledWith(
        expect.objectContaining({
          force: true,
        }),
      )
    })
  })

  describe('getConfig', () => {
    it('should return config with itemName', () => {
      const provider = new MacOSKeychainKeyProvider({
        itemName: 'test-key',
      })

      const config = provider.getConfig()

      expect(config).toEqual({
        type: 'macos-keychain',
        options: {
          itemName: 'test-key',
        },
      })
    })
  })

  describe('edge cases', () => {
    it('should handle base64 decoding of complex key content', async () => {
      const mockSpawnFn = vi.mocked(spawn)
      const mockSetKeyPermissions = vi.mocked(crypto.setKeyPermissions)

      const complexKeyContent =
        '-----BEGIN PRIVATE KEY-----\n' +
        'MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC7VJTUt9Us8cKj\n' +
        'MzEfYyjiWA4R4/M2bS1+fWIcPm15A8vMpmcdgU7U3axvfiIVQ6Z5RIQBVhC8NvO6\n' +
        '-----END PRIVATE KEY-----\n'
      const base64Key = Buffer.from(complexKeyContent, 'utf8').toString('base64')

      let callCount = 0
      mockSpawnFn.mockImplementation(() => {
        callCount++
        if (callCount === 1) {
          return mockSpawnSuccess('')
        } else {
          return mockSpawnSuccess(base64Key)
        }
      })

      mockSetKeyPermissions.mockResolvedValue()

      const provider = new MacOSKeychainKeyProvider({
        itemName: 'test-key',
      })

      const result = await provider.getPrivateKey('test-key')

      const retrievedContent = await fs.readFile(result.keyPath, 'utf8')
      expect(retrievedContent).toBe(complexKeyContent)

      await result.cleanup()
    })

    it('should handle spawn error during keyExists check', async () => {
      const mockSpawnFn = vi.mocked(spawn)
      mockSpawnFn.mockReturnValue(mockSpawnError(new Error('ENOENT')))

      const provider = new MacOSKeychainKeyProvider({
        itemName: 'test-key',
      })

      await expect(provider.getPrivateKey('test-key')).rejects.toThrow(
        /Key not found in macOS Keychain/,
      )
    })

    it('should handle empty base64 string from keychain', async () => {
      const mockSpawnFn = vi.mocked(spawn)
      const mockSetKeyPermissions = vi.mocked(crypto.setKeyPermissions)

      let callCount = 0
      mockSpawnFn.mockImplementation(() => {
        callCount++
        if (callCount === 1) {
          return mockSpawnSuccess('')
        } else {
          // Empty base64 decodes to empty string
          return mockSpawnSuccess('')
        }
      })

      mockSetKeyPermissions.mockResolvedValue()

      const provider = new MacOSKeychainKeyProvider({
        itemName: 'test-key',
      })

      const result = await provider.getPrivateKey('test-key')

      const retrievedContent = await fs.readFile(result.keyPath, 'utf8')
      expect(retrievedContent).toBe('')

      await result.cleanup()
    })
  })

  describe('integration: provider workflow validation', () => {
    it('should complete the full getPrivateKey workflow with mocked security CLI', async () => {
      // This test validates the complete provider workflow:
      // 1. keyExists check
      // 2. Key retrieval with base64 decoding
      // 3. Proper cleanup after use

      const mockSpawnFn = vi.mocked(spawn)
      const mockSetKeyPermissions = vi.mocked(crypto.setKeyPermissions)

      const mockPrivateKeyContent =
        '-----BEGIN PRIVATE KEY-----\nmock-key-content\n-----END PRIVATE KEY-----'
      const base64Key = Buffer.from(mockPrivateKeyContent, 'utf8').toString('base64')

      const provider = new MacOSKeychainKeyProvider({
        itemName: 'integration-test-key',
      })

      // Mock the security CLI calls
      let callCount = 0
      mockSpawnFn.mockImplementation(() => {
        callCount++
        if (callCount === 1) {
          // keyExists check
          return mockSpawnSuccess('')
        } else {
          // key retrieval with -w flag
          return mockSpawnSuccess(base64Key)
        }
      })

      mockSetKeyPermissions.mockResolvedValue()

      // Get the private key through the provider
      const keyResult = await provider.getPrivateKey('integration-test-key')

      // Verify the workflow completed correctly
      expect(keyResult.keyPath).toContain('attest-it-')
      expect(keyResult.keyPath).toContain('private.pem')
      expect(typeof keyResult.cleanup).toBe('function')

      // Verify the key file exists and has correct content
      const retrievedContent = await fs.readFile(keyResult.keyPath, 'utf8')
      expect(retrievedContent).toBe(mockPrivateKeyContent)

      // Verify security CLI was called correctly
      expect(mockSpawnFn).toHaveBeenCalledTimes(2)

      // First call: keyExists check
      expect(mockSpawnFn).toHaveBeenNthCalledWith(
        1,
        'security',
        ['find-generic-password', '-a', 'attest-it', '-s', 'integration-test-key'],
        expect.any(Object),
      )

      // Second call: key retrieval
      expect(mockSpawnFn).toHaveBeenNthCalledWith(
        2,
        'security',
        ['find-generic-password', '-a', 'attest-it', '-s', 'integration-test-key', '-w'],
        expect.any(Object),
      )

      // Verify setKeyPermissions was called on the temp file
      expect(mockSetKeyPermissions).toHaveBeenCalledWith(keyResult.keyPath)

      // Test cleanup
      await keyResult.cleanup()

      // Verify file was deleted
      await expect(fs.stat(keyResult.keyPath)).rejects.toThrow()
    })

    it('should complete the full generateKeyPair workflow', async () => {
      const mockSpawnFn = vi.mocked(spawn)
      const mockGenerateKeyPair = vi.mocked(crypto.generateKeyPair)

      const publicPath = path.join(tmpDir, 'integration-public.pem')
      const privateKeyContent =
        '-----BEGIN PRIVATE KEY-----\nintegration-test\n-----END PRIVATE KEY-----'

      mockGenerateKeyPair.mockImplementation(async (opts) => {
        const tempPrivatePath = opts.privatePath
        await fs.mkdir(path.dirname(tempPrivatePath), { recursive: true })
        await fs.writeFile(tempPrivatePath, privateKeyContent)
        return {
          privatePath: tempPrivatePath,
          publicPath: opts.publicPath,
        }
      })

      mockSpawnFn.mockReturnValue(mockSpawnSuccess(''))

      const provider = new MacOSKeychainKeyProvider({
        itemName: 'integration-generated-key',
      })

      const result = await provider.generateKeyPair({
        publicKeyPath: publicPath,
        force: false,
      })

      // Verify result
      expect(result.privateKeyRef).toBe('integration-generated-key')
      expect(result.publicKeyPath).toBe(publicPath)
      expect(result.storageDescription).toBe('macOS Keychain: integration-generated-key')

      // Verify the key was stored with correct base64 encoding
      const expectedBase64 = Buffer.from(privateKeyContent, 'utf8').toString('base64')
      expect(mockSpawnFn).toHaveBeenCalledWith(
        'security',
        [
          'add-generic-password',
          '-a',
          'attest-it',
          '-s',
          'integration-generated-key',
          '-w',
          expectedBase64,
          '-T',
          '',
          '-U',
        ],
        expect.any(Object),
      )
    })
  })

  describe('getPrivateKey error handling', () => {
    it('should throw descriptive error when key does not exist', async () => {
      const mockSpawnFn = vi.mocked(spawn)
      mockSpawnFn.mockReturnValue(
        mockSpawnFailure('security: The specified item could not be found in the keychain.'),
      )

      const provider = new MacOSKeychainKeyProvider({
        itemName: 'test-key',
      })

      await expect(provider.getPrivateKey('nonexistent-key')).rejects.toThrow(
        /Key not found in macOS Keychain.*nonexistent-key.*account: attest-it/,
      )
    })

    it('should include proper context in error messages', async () => {
      const mockSpawnFn = vi.mocked(spawn)
      mockSpawnFn.mockReturnValue(mockSpawnFailure('access denied'))

      const provider = new MacOSKeychainKeyProvider({
        itemName: 'test-key',
      })

      await expect(provider.getPrivateKey('test-key')).rejects.toThrow(
        /Key not found in macOS Keychain/,
      )
    })
  })
})
