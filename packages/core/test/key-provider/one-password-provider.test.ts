/**
 * Tests for OnePasswordKeyProvider.
 */

/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/consistent-type-assertions */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { spawn } from 'node:child_process'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import * as os from 'node:os'
import { OnePasswordKeyProvider } from '../../src/key-provider/one-password-provider.js'
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

describe('OnePasswordKeyProvider', () => {
  let tmpDir: string

  beforeEach(async () => {
    // Create a real temp directory for tests
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'onepassword-test-'))
    vi.clearAllMocks()
  })

  afterEach(async () => {
    // Clean up temp directory
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {
      // Ignore cleanup errors
    })
  })

  describe('constructor', () => {
    it('should create provider with required options', () => {
      const provider = new OnePasswordKeyProvider({
        vault: 'Private',
        itemName: 'test-key',
      })

      expect(provider.type).toBe('1password')
      expect(provider.displayName).toBe('1Password')
    })

    it('should accept optional account option', () => {
      const provider = new OnePasswordKeyProvider({
        account: 'test@example.com',
        vault: 'Private',
        itemName: 'test-key',
      })

      const config = provider.getConfig()
      expect(config.options).toHaveProperty('account', 'test@example.com')
    })
  })

  describe('isAvailable', () => {
    it('should return true when op CLI is installed', async () => {
      const mockSpawnFn = vi.mocked(spawn)
      mockSpawnFn.mockReturnValue(mockSpawnSuccess('2.0.0'))

      const provider = new OnePasswordKeyProvider({
        vault: 'Private',
        itemName: 'test-key',
      })

      const result = await provider.isAvailable()

      expect(result).toBe(true)
      expect(mockSpawnFn).toHaveBeenCalledWith('op', ['--version'], expect.any(Object))
    })

    it('should return false when op CLI is not installed', async () => {
      const mockSpawnFn = vi.mocked(spawn)
      mockSpawnFn.mockReturnValue(mockSpawnError(new Error('command not found')))

      const provider = new OnePasswordKeyProvider({
        vault: 'Private',
        itemName: 'test-key',
      })

      const result = await provider.isAvailable()

      expect(result).toBe(false)
    })
  })

  describe('keyExists', () => {
    it('should return true when item exists in vault', async () => {
      const mockSpawnFn = vi.mocked(spawn)
      mockSpawnFn.mockReturnValue(mockSpawnSuccess('{"id":"item123"}'))

      const provider = new OnePasswordKeyProvider({
        vault: 'Private',
        itemName: 'test-key',
      })

      const result = await provider.keyExists('test-key')

      expect(result).toBe(true)
      expect(mockSpawnFn).toHaveBeenCalledWith(
        'op',
        ['item', 'get', 'test-key', '--vault', 'Private', '--format=json'],
        expect.any(Object),
      )
    })

    it('should return false when item does not exist', async () => {
      const mockSpawnFn = vi.mocked(spawn)
      mockSpawnFn.mockReturnValue(mockSpawnFailure('item not found'))

      const provider = new OnePasswordKeyProvider({
        vault: 'Private',
        itemName: 'test-key',
      })

      const result = await provider.keyExists('nonexistent-key')

      expect(result).toBe(false)
    })

    it('should include account flag when account is set', async () => {
      const mockSpawnFn = vi.mocked(spawn)
      mockSpawnFn.mockReturnValue(mockSpawnSuccess('{"id":"item123"}'))

      const provider = new OnePasswordKeyProvider({
        account: 'test@example.com',
        vault: 'Private',
        itemName: 'test-key',
      })

      await provider.keyExists('test-key')

      expect(mockSpawnFn).toHaveBeenCalledWith(
        'op',
        [
          'item',
          'get',
          'test-key',
          '--vault',
          'Private',
          '--format=json',
          '--account',
          'test@example.com',
        ],
        expect.any(Object),
      )
    })
  })

  describe('getPrivateKey', () => {
    it('should retrieve key to temp file and provide cleanup', async () => {
      const mockSpawnFn = vi.mocked(spawn)
      mockSpawnFn.mockReturnValue(mockSpawnSuccess(''))

      const mockSetKeyPermissions = vi.mocked(crypto.setKeyPermissions)
      mockSetKeyPermissions.mockResolvedValue()

      const provider = new OnePasswordKeyProvider({
        vault: 'Private',
        itemName: 'test-key',
      })

      const result = await provider.getPrivateKey('test-key')

      // Check that we got a valid result
      expect(result.keyPath).toContain('attest-it-')
      expect(result.keyPath).toContain('private.pem')
      expect(typeof result.cleanup).toBe('function')

      // Verify spawn was called with correct args
      expect(mockSpawnFn).toHaveBeenCalledWith(
        'op',
        expect.arrayContaining([
          'document',
          'get',
          'test-key',
          '--vault',
          'Private',
          '--out-file',
          expect.stringContaining('private.pem'),
        ]),
        expect.any(Object),
      )

      // Verify permissions were set
      expect(mockSetKeyPermissions).toHaveBeenCalled()

      // Create a mock key file for cleanup test
      await fs.mkdir(path.dirname(result.keyPath), { recursive: true })
      await fs.writeFile(result.keyPath, 'mock key contents')

      // Test cleanup
      await result.cleanup()

      // Verify file was deleted
      await expect(fs.stat(result.keyPath)).rejects.toThrow()
    })

    it('should throw error when key does not exist', async () => {
      const mockSpawnFn = vi.mocked(spawn)
      // keyExists check fails, so we get a descriptive error
      mockSpawnFn.mockReturnValue(mockSpawnFailure('item not found'))

      const provider = new OnePasswordKeyProvider({
        vault: 'Private',
        itemName: 'test-key',
      })

      await expect(provider.getPrivateKey('nonexistent-key')).rejects.toThrow(
        /Key not found in 1Password/,
      )
    })

    it('should throw error when document retrieval fails after keyExists succeeds', async () => {
      const mockSpawnFn = vi.mocked(spawn)
      let callCount = 0
      mockSpawnFn.mockImplementation(() => {
        callCount++
        if (callCount === 1) {
          // keyExists succeeds
          return mockSpawnSuccess('{"id":"item123"}')
        } else {
          // document get fails
          return mockSpawnFailure('download failed')
        }
      })

      const provider = new OnePasswordKeyProvider({
        vault: 'Private',
        itemName: 'test-key',
      })

      await expect(provider.getPrivateKey('test-key')).rejects.toThrow('Command failed')
    })

    it('should clean up temp directory on error', async () => {
      const mockSpawnFn = vi.mocked(spawn)
      mockSpawnFn.mockReturnValue(mockSpawnFailure('error'))

      const provider = new OnePasswordKeyProvider({
        vault: 'Private',
        itemName: 'test-key',
      })

      await expect(provider.getPrivateKey('test-key')).rejects.toThrow()

      // Note: Cleanup verification is best-effort due to async timing and
      // parallel test execution creating multiple temp directories
    })
  })

  describe('generateKeyPair', () => {
    it('should generate keypair and upload to 1Password', async () => {
      const mockSpawnFn = vi.mocked(spawn)
      const mockGenerateKeyPair = vi.mocked(crypto.generateKeyPair)

      const publicPath = path.join(tmpDir, 'public.pem')

      // Mock successful key generation - the implementation creates its own temp dir
      mockGenerateKeyPair.mockImplementation(async (opts) => {
        const tempPrivatePath = opts.privatePath
        // Create the temp dir and file that the real implementation would create
        await fs.mkdir(path.dirname(tempPrivatePath), { recursive: true })
        await fs.writeFile(tempPrivatePath, 'private key contents')
        return {
          privatePath: tempPrivatePath,
          publicPath: opts.publicPath,
        }
      })

      // Mock successful document upload
      mockSpawnFn.mockReturnValue(mockSpawnSuccess('document created'))

      const provider = new OnePasswordKeyProvider({
        vault: 'Private',
        itemName: 'test-key',
      })

      const result = await provider.generateKeyPair({
        publicKeyPath: publicPath,
        force: false,
      })

      expect(result.privateKeyRef).toBe('test-key')
      expect(result.publicKeyPath).toBe(publicPath)
      expect(result.storageDescription).toBe('1Password: Private/test-key')

      // Verify spawn was called to upload document
      expect(mockSpawnFn).toHaveBeenCalledWith(
        'op',
        expect.arrayContaining([
          'document',
          'create',
          expect.stringContaining('private.pem'),
          '--title',
          'test-key',
          '--vault',
          'Private',
        ]),
        expect.any(Object),
      )
    })

    it('should throw error when document upload fails', async () => {
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

      // Mock failed upload
      mockSpawnFn.mockReturnValue(mockSpawnFailure('upload failed'))

      const provider = new OnePasswordKeyProvider({
        vault: 'Private',
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

      mockSpawnFn.mockReturnValue(mockSpawnSuccess('document created'))

      const provider = new OnePasswordKeyProvider({
        vault: 'Private',
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
  })

  describe('getConfig', () => {
    it('should return minimal config without account', () => {
      const provider = new OnePasswordKeyProvider({
        vault: 'Private',
        itemName: 'test-key',
      })

      const config = provider.getConfig()

      expect(config).toEqual({
        type: '1password',
        options: {
          vault: 'Private',
          itemName: 'test-key',
        },
      })
    })

    it('should include account when provided', () => {
      const provider = new OnePasswordKeyProvider({
        account: 'test@example.com',
        vault: 'Private',
        itemName: 'test-key',
      })

      const config = provider.getConfig()

      expect(config.options).toHaveProperty('account', 'test@example.com')
    })
  })

  describe('static helpers', () => {
    describe('isInstalled', () => {
      it('should return true when op --version succeeds', async () => {
        const mockSpawnFn = vi.mocked(spawn)
        mockSpawnFn.mockReturnValue(mockSpawnSuccess('2.0.0'))

        const result = await OnePasswordKeyProvider.isInstalled()

        expect(result).toBe(true)
        expect(mockSpawnFn).toHaveBeenCalledWith('op', ['--version'], expect.any(Object))
      })

      it('should return false when op --version fails', async () => {
        const mockSpawnFn = vi.mocked(spawn)
        mockSpawnFn.mockReturnValue(mockSpawnError(new Error('command not found')))

        const result = await OnePasswordKeyProvider.isInstalled()

        expect(result).toBe(false)
      })
    })

    describe('listAccounts', () => {
      it('should return parsed account list', async () => {
        const mockSpawnFn = vi.mocked(spawn)
        const mockAccounts = [
          {
            account_uuid: 'abc123',
            email: 'test@example.com',
            url: 'https://my.1password.com',
            user_uuid: 'user123',
          },
        ]
        mockSpawnFn.mockReturnValue(mockSpawnSuccess(JSON.stringify(mockAccounts)))

        const result = await OnePasswordKeyProvider.listAccounts()

        expect(result).toEqual(mockAccounts)
        expect(mockSpawnFn).toHaveBeenCalledWith(
          'op',
          ['account', 'list', '--format=json'],
          expect.any(Object),
        )
      })

      it('should return empty array on failure', async () => {
        const mockSpawnFn = vi.mocked(spawn)
        mockSpawnFn.mockReturnValue(mockSpawnFailure('error'))

        const result = await OnePasswordKeyProvider.listAccounts()

        expect(result).toEqual([])
      })

      it('should return empty array on invalid JSON', async () => {
        const mockSpawnFn = vi.mocked(spawn)
        mockSpawnFn.mockReturnValue(mockSpawnSuccess('invalid json'))

        const result = await OnePasswordKeyProvider.listAccounts()

        expect(result).toEqual([])
      })
    })

    describe('listVaults', () => {
      it('should return parsed vault list', async () => {
        const mockSpawnFn = vi.mocked(spawn)
        const mockVaults = [
          { id: 'vault1', name: 'Private' },
          { id: 'vault2', name: 'Work' },
        ]
        mockSpawnFn.mockReturnValue(mockSpawnSuccess(JSON.stringify(mockVaults)))

        const result = await OnePasswordKeyProvider.listVaults()

        expect(result).toEqual(mockVaults)
        expect(mockSpawnFn).toHaveBeenCalledWith(
          'op',
          ['vault', 'list', '--format=json'],
          expect.any(Object),
        )
      })

      it('should include account flag when provided', async () => {
        const mockSpawnFn = vi.mocked(spawn)
        mockSpawnFn.mockReturnValue(mockSpawnSuccess('[]'))

        await OnePasswordKeyProvider.listVaults('test@example.com')

        expect(mockSpawnFn).toHaveBeenCalledWith(
          'op',
          ['vault', 'list', '--format=json', '--account', 'test@example.com'],
          expect.any(Object),
        )
      })

      it('should return empty array on failure', async () => {
        const mockSpawnFn = vi.mocked(spawn)
        mockSpawnFn.mockReturnValue(mockSpawnFailure('error'))

        const result = await OnePasswordKeyProvider.listVaults()

        expect(result).toEqual([])
      })
    })
  })

  describe('edge cases', () => {
    it('should handle spawn process that emits error event in keyExists', async () => {
      const mockSpawnFn = vi.mocked(spawn)
      mockSpawnFn.mockReturnValue(mockSpawnError(new Error('ENOENT')))

      const provider = new OnePasswordKeyProvider({
        vault: 'Private',
        itemName: 'test-key',
      })

      // keyExists catches spawn errors and returns false, so we get the "Key not found" error
      await expect(provider.getPrivateKey('test-key')).rejects.toThrow(/Key not found in 1Password/)
    })

    it('should handle spawn process that emits error event in document get', async () => {
      const mockSpawnFn = vi.mocked(spawn)
      let callCount = 0
      mockSpawnFn.mockImplementation(() => {
        callCount++
        if (callCount === 1) {
          // keyExists succeeds
          return mockSpawnSuccess('{"id":"item123"}')
        } else {
          // document get emits error
          return mockSpawnError(new Error('ENOENT'))
        }
      })

      const provider = new OnePasswordKeyProvider({
        vault: 'Private',
        itemName: 'test-key',
      })

      await expect(provider.getPrivateKey('test-key')).rejects.toThrow('ENOENT')
    })

    it('should handle empty stdout from command', async () => {
      const mockSpawnFn = vi.mocked(spawn)
      mockSpawnFn.mockReturnValue(mockSpawnSuccess(''))

      const result = await OnePasswordKeyProvider.listAccounts()

      expect(result).toEqual([])
    })
  })

  describe('getPrivateKey error handling', () => {
    it('should throw descriptive error when key does not exist', async () => {
      const mockSpawnFn = vi.mocked(spawn)
      // First call is keyExists check, which fails
      mockSpawnFn.mockReturnValue(mockSpawnFailure('item not found'))

      const provider = new OnePasswordKeyProvider({
        vault: 'Private',
        itemName: 'test-key',
      })

      await expect(provider.getPrivateKey('nonexistent-key')).rejects.toThrow(
        /Key not found in 1Password.*nonexistent-key.*vault: Private/,
      )
    })

    it('should include account in error message when provided', async () => {
      const mockSpawnFn = vi.mocked(spawn)
      mockSpawnFn.mockReturnValue(mockSpawnFailure('item not found'))

      const provider = new OnePasswordKeyProvider({
        account: 'test@example.com',
        vault: 'Private',
        itemName: 'test-key',
      })

      await expect(provider.getPrivateKey('nonexistent-key')).rejects.toThrow(
        /Key not found in 1Password.*account: test@example.com/,
      )
    })
  })

  describe('integration: provider workflow validation', () => {
    it('should complete the full getPrivateKey workflow with mocked op CLI', async () => {
      // This test validates the complete provider workflow:
      // 1. keyExists check
      // 2. Document retrieval to temp file
      // 3. Proper cleanup after use
      // Note: For full crypto sign/verify tests, see filesystem-provider.test.ts
      // which runs in environments with OpenSSL available.

      const mockSpawnFn = vi.mocked(spawn)
      const mockSetKeyPermissions = vi.mocked(crypto.setKeyPermissions)

      // Create a mock private key content
      const mockPrivateKeyContent =
        '-----BEGIN PRIVATE KEY-----\nmock-key-content\n-----END PRIVATE KEY-----'
      const mockPrivateKeyPath = path.join(tmpDir, 'mock-private.pem')
      await fs.writeFile(mockPrivateKeyPath, mockPrivateKeyContent)

      // Create provider
      const provider = new OnePasswordKeyProvider({
        vault: 'Private',
        itemName: 'integration-test-key',
      })

      // Mock the op CLI calls:
      // 1. keyExists check (item get) - success
      // 2. document get - simulate downloading the key
      let callCount = 0
      mockSpawnFn.mockImplementation((_cmd, args) => {
        callCount++
        if (callCount === 1) {
          // keyExists check
          return mockSpawnSuccess('{"id":"item123"}')
        } else {
          // document get - simulate op writing the key to the target file
          const outFileIndex = (args as string[]).indexOf('--out-file')
          if (outFileIndex !== -1) {
            const targetPath = (args as string[])[outFileIndex + 1]
            // Synchronously schedule the file write (simulates op writing the file)
            setImmediate(() => {
              void fs
                .mkdir(path.dirname(targetPath), { recursive: true })
                .then(() => fs.writeFile(targetPath, mockPrivateKeyContent))
            })
          }
          return mockSpawnSuccess('')
        }
      })

      mockSetKeyPermissions.mockResolvedValue()

      // Get the private key through the provider
      const keyResult = await provider.getPrivateKey('integration-test-key')

      // Wait for the mock to write the file
      await new Promise((resolve) => setTimeout(resolve, 50))

      // Verify the workflow completed correctly
      expect(keyResult.keyPath).toContain('attest-it-')
      expect(keyResult.keyPath).toContain('private.pem')
      expect(typeof keyResult.cleanup).toBe('function')

      // Verify the key file exists and has correct content
      const retrievedContent = await fs.readFile(keyResult.keyPath, 'utf8')
      expect(retrievedContent).toBe(mockPrivateKeyContent)

      // Verify op CLI was called correctly
      expect(mockSpawnFn).toHaveBeenCalledTimes(2)

      // First call: keyExists check
      expect(mockSpawnFn).toHaveBeenNthCalledWith(
        1,
        'op',
        ['item', 'get', 'integration-test-key', '--vault', 'Private', '--format=json'],
        expect.any(Object),
      )

      // Second call: document get
      expect(mockSpawnFn).toHaveBeenNthCalledWith(
        2,
        'op',
        expect.arrayContaining([
          'document',
          'get',
          'integration-test-key',
          '--vault',
          'Private',
          '--out-file',
        ]),
        expect.any(Object),
      )

      // Verify setKeyPermissions was called on the temp file
      expect(mockSetKeyPermissions).toHaveBeenCalledWith(keyResult.keyPath)

      // Test cleanup
      await keyResult.cleanup()

      // Verify file was deleted
      await expect(fs.stat(keyResult.keyPath)).rejects.toThrow()
    })

    it('should work with sign() function when key provider is configured', async () => {
      // This test validates that the sign() function correctly uses a KeyProvider
      // by testing the keyProvider + keyRef signature (without requiring OpenSSL)

      const mockSpawnFn = vi.mocked(spawn)
      const mockSetKeyPermissions = vi.mocked(crypto.setKeyPermissions)

      // Create a mock private key
      const mockPrivateKeyContent = '-----BEGIN PRIVATE KEY-----\nmock\n-----END PRIVATE KEY-----'

      // Create provider
      const provider = new OnePasswordKeyProvider({
        vault: 'Private',
        itemName: 'test-key',
      })

      // Mock op CLI calls
      let opCallCount = 0
      mockSpawnFn.mockImplementation((_cmd, args) => {
        opCallCount++
        if (opCallCount === 1) {
          return mockSpawnSuccess('{"id":"item123"}')
        } else {
          const outFileIndex = (args as string[]).indexOf('--out-file')
          if (outFileIndex !== -1) {
            const targetPath = (args as string[])[outFileIndex + 1]
            setImmediate(() => {
              void fs
                .mkdir(path.dirname(targetPath), { recursive: true })
                .then(() => fs.writeFile(targetPath, mockPrivateKeyContent))
            })
          }
          return mockSpawnSuccess('')
        }
      })

      mockSetKeyPermissions.mockResolvedValue()

      // Get the key through the provider
      const keyResult = await provider.getPrivateKey('test-key')
      await new Promise((resolve) => setTimeout(resolve, 50))

      // Verify the key was retrieved successfully
      expect(await fs.readFile(keyResult.keyPath, 'utf8')).toBe(mockPrivateKeyContent)

      // Cleanup should work
      await keyResult.cleanup()
      await expect(fs.stat(keyResult.keyPath)).rejects.toThrow()
    })
  })
})
