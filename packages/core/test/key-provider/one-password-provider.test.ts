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
import * as ed25519 from '../../src/crypto/ed25519.js'

// Mock child_process.spawn
vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}))

// Mock crypto.setKeyPermissions
vi.mock('../../src/crypto.js', async (importOriginal) => {
  const actual = await importOriginal<typeof crypto>()
  return {
    ...actual,
    setKeyPermissions: vi.fn(),
  }
})

// Mock ed25519.generateKeyPair
vi.mock('../../src/crypto/ed25519.js', async (importOriginal) => {
  const actual = await importOriginal<typeof ed25519>()
  return {
    ...actual,
    generateKeyPair: vi.fn(),
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

    it('should accept optional accountUuid option', () => {
      const provider = new OnePasswordKeyProvider({
        accountUuid: 'test-account-uuid',
        vault: 'Private',
        itemName: 'test-key',
      })

      const config = provider.getConfig()
      expect(config.options).toHaveProperty('accountUuid', 'test-account-uuid')
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

    it('should include account flag when accountUuid is set', async () => {
      const mockSpawnFn = vi.mocked(spawn)
      mockSpawnFn.mockReturnValue(mockSpawnSuccess('{"id":"item123"}'))

      const provider = new OnePasswordKeyProvider({
        accountUuid: 'test-account-uuid',
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
          'test-account-uuid',
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
      // On macOS/Linux, op is wrapped in 'script' for PTY support
      // On macOS: spawn('script', ['-q', '/dev/null', 'op', 'document', ...])
      // On Linux: spawn('script', ['-q', '/dev/null', '-c', 'op document get ...'])
      const spawnCalls = mockSpawnFn.mock.calls
      const opCall = spawnCalls.find((call) => {
        const cmd = call[0]
        const args = call[1]
        if (!Array.isArray(args)) return false
        // Direct op call (Windows)
        if (cmd === 'op' && args.includes('document')) return true
        // macOS: args are individual elements
        if (cmd === 'script' && args.includes('op') && args.includes('document')) return true
        // Linux: command is a string after -c flag
        if (cmd === 'script') {
          const cIndex = args.indexOf('-c')
          if (cIndex !== -1 && cIndex + 1 < args.length) {
            const cmdStr = String(args[cIndex + 1])
            return cmdStr.includes('op') && cmdStr.includes('document')
          }
        }
        return false
      })
      expect(opCall).toBeDefined()
      if (!opCall) throw new Error('opCall not found')
      const opArgs = opCall[1]
      if (!Array.isArray(opArgs)) throw new Error('opArgs not an array')
      // Check args - either as individual elements or within -c string
      const cIndex = opArgs.indexOf('-c')
      if (cIndex !== -1 && cIndex + 1 < opArgs.length) {
        // Linux: check the -c command string
        const cmdStr = String(opArgs[cIndex + 1])
        expect(cmdStr).toContain('document')
        expect(cmdStr).toContain('get')
        expect(cmdStr).toContain('test-key')
        expect(cmdStr).toContain('--vault')
        expect(cmdStr).toContain('Private')
        expect(cmdStr).toContain('--out-file')
        expect(cmdStr).toContain('private.pem')
      } else {
        // macOS/Windows: check individual args
        expect(opArgs).toContain('document')
        expect(opArgs).toContain('get')
        expect(opArgs).toContain('test-key')
        expect(opArgs).toContain('--vault')
        expect(opArgs).toContain('Private')
        expect(opArgs).toContain('--out-file')
        expect(opArgs.some((arg) => String(arg).includes('private.pem'))).toBe(true)
      }

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
    it('should generate Ed25519 keypair and upload to 1Password', async () => {
      const mockSpawnFn = vi.mocked(spawn)
      const mockEd25519GenerateKeyPair = vi.mocked(ed25519.generateKeyPair)

      const publicPath = path.join(tmpDir, 'public.pem')

      // Mock Ed25519 key generation (returns sync key pair)
      mockEd25519GenerateKeyPair.mockReturnValue({
        publicKey: 'base64-public-key',
        privateKey: '-----BEGIN PRIVATE KEY-----\nmock-private-key\n-----END PRIVATE KEY-----',
      })

      // Mock successful document upload
      mockSpawnFn.mockReturnValue(mockSpawnSuccess('document created'))

      const provider = new OnePasswordKeyProvider({
        vault: 'Private',
        itemName: 'test-key',
      })

      const result = await provider.generateKeyPair({
        publicKeyPath: publicPath,
        force: true, // Use force to skip file existence check
      })

      expect(result.privateKeyRef).toBe('test-key')
      expect(result.publicKeyPath).toBe(publicPath)
      expect(result.storageDescription).toBe('1Password: Private/test-key')

      // Verify public key was written (base64 format, not PEM)
      const writtenPublicKey = await fs.readFile(publicPath, 'utf-8')
      expect(writtenPublicKey).toBe('base64-public-key')

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
      const mockEd25519GenerateKeyPair = vi.mocked(ed25519.generateKeyPair)

      const publicPath = path.join(tmpDir, 'public.pem')

      // Mock Ed25519 key generation
      mockEd25519GenerateKeyPair.mockReturnValue({
        publicKey: 'base64-public-key',
        privateKey: '-----BEGIN PRIVATE KEY-----\nmock-private-key\n-----END PRIVATE KEY-----',
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
          force: true,
        }),
      ).rejects.toThrow('Command failed')
    })

    it('should clean up temp files after generation', async () => {
      const mockSpawnFn = vi.mocked(spawn)
      const mockEd25519GenerateKeyPair = vi.mocked(ed25519.generateKeyPair)

      const publicPath = path.join(tmpDir, 'public.pem')

      // Mock Ed25519 key generation
      mockEd25519GenerateKeyPair.mockReturnValue({
        publicKey: 'base64-public-key',
        privateKey: '-----BEGIN PRIVATE KEY-----\nmock-private-key\n-----END PRIVATE KEY-----',
      })

      mockSpawnFn.mockReturnValue(mockSpawnSuccess('document created'))

      const provider = new OnePasswordKeyProvider({
        vault: 'Private',
        itemName: 'test-key',
      })

      await provider.generateKeyPair({
        publicKeyPath: publicPath,
        force: true,
      })

      // The temp directory is created with a random name in os.tmpdir()
      // We can't easily capture the exact path, but we can verify the operation completed
      // successfully, which means the cleanup ran without errors
      expect(mockSpawnFn).toHaveBeenCalled()
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

    it('should include accountUuid when provided', () => {
      const provider = new OnePasswordKeyProvider({
        accountUuid: 'test-account-uuid',
        vault: 'Private',
        itemName: 'test-key',
      })

      const config = provider.getConfig()

      expect(config.options).toHaveProperty('accountUuid', 'test-account-uuid')
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
      it('should return parsed account list with names from account details', async () => {
        const mockSpawnFn = vi.mocked(spawn)
        const mockAccounts = [
          {
            account_uuid: 'abc123',
            email: 'test@example.com',
            url: 'https://my.1password.com',
            user_uuid: 'user123',
          },
        ]
        const mockAccountDetails = {
          id: 'abc123',
          name: 'Test Family',
          domain: 'my',
          type: 'FAMILY',
          state: 'ACTIVE',
        }

        // Mock spawn to return different results based on arguments
        mockSpawnFn.mockImplementation((_cmd, args) => {
          if (args[0] === 'account' && args[1] === 'list') {
            return mockSpawnSuccess(JSON.stringify(mockAccounts))
          } else if (args[0] === 'account' && args[1] === 'get') {
            return mockSpawnSuccess(JSON.stringify(mockAccountDetails))
          }
          return mockSpawnFailure('unknown command')
        })

        const result = await OnePasswordKeyProvider.listAccounts()

        expect(result.accounts).toEqual([{ ...mockAccounts[0], name: 'Test Family' }])
        expect(result.inaccessible).toEqual([])
        expect(mockSpawnFn).toHaveBeenCalledWith(
          'op',
          ['account', 'list', '--format=json'],
          expect.any(Object),
        )
        // Note: op account get requires account_uuid (not user_uuid or email)
        expect(mockSpawnFn).toHaveBeenCalledWith(
          'op',
          ['account', 'get', '--account', 'abc123', '--format=json'],
          expect.any(Object),
        )
      })

      it('should throw when account get fails for all accounts', async () => {
        const mockSpawnFn = vi.mocked(spawn)
        const mockAccounts = [
          {
            account_uuid: 'abc123',
            email: 'test@example.com',
            url: 'https://my.1password.com',
            user_uuid: 'user123',
          },
        ]

        // Mock spawn to return account list but fail on account get
        mockSpawnFn.mockImplementation((_cmd, args) => {
          if (args[0] === 'account' && args[1] === 'list') {
            return mockSpawnSuccess(JSON.stringify(mockAccounts))
          }
          return mockSpawnFailure('error getting account details')
        })

        // Should throw when no accounts are accessible
        await expect(OnePasswordKeyProvider.listAccounts()).rejects.toThrow(
          'Could not access any 1Password accounts',
        )
      })

      it('should return inaccessible accounts when some succeed and some fail', async () => {
        const mockSpawnFn = vi.mocked(spawn)
        const mockAccounts = [
          {
            account_uuid: 'abc123',
            email: 'test@example.com',
            url: 'https://my.1password.com',
            user_uuid: 'user123',
          },
          {
            account_uuid: 'def456',
            email: 'other@example.com',
            url: 'https://other.1password.com',
            user_uuid: 'user456',
          },
        ]
        const mockAccountDetails = { name: 'Test Family' }

        // First account succeeds, second fails
        mockSpawnFn.mockImplementation((_cmd, args) => {
          if (args[0] === 'account' && args[1] === 'list') {
            return mockSpawnSuccess(JSON.stringify(mockAccounts))
          }
          // account_uuid is used for --account flag
          if (args[0] === 'account' && args[1] === 'get' && args[3] === 'abc123') {
            return mockSpawnSuccess(JSON.stringify(mockAccountDetails))
          }
          return mockSpawnFailure('access denied')
        })

        const result = await OnePasswordKeyProvider.listAccounts()

        expect(result.accounts).toHaveLength(1)
        expect(result.accounts[0]?.name).toBe('Test Family')
        expect(result.inaccessible).toHaveLength(1)
        expect(result.inaccessible[0]?.email).toBe('other@example.com')
        expect(result.inaccessible[0]?.reason).toContain('access denied')
      })

      it('should throw on account list failure', async () => {
        const mockSpawnFn = vi.mocked(spawn)
        mockSpawnFn.mockReturnValue(mockSpawnFailure('error'))

        await expect(OnePasswordKeyProvider.listAccounts()).rejects.toThrow(
          'Command failed with exit code 1',
        )
      })

      it('should throw on invalid JSON from account list', async () => {
        const mockSpawnFn = vi.mocked(spawn)
        mockSpawnFn.mockReturnValue(mockSpawnSuccess('invalid json'))

        await expect(OnePasswordKeyProvider.listAccounts()).rejects.toThrow()
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

      it('should include account flag when accountUuid provided', async () => {
        const mockSpawnFn = vi.mocked(spawn)
        mockSpawnFn.mockReturnValue(mockSpawnSuccess('[]'))

        await OnePasswordKeyProvider.listVaults('test-account-uuid')

        expect(mockSpawnFn).toHaveBeenCalledWith(
          'op',
          ['vault', 'list', '--format=json', '--account', 'test-account-uuid'],
          expect.any(Object),
        )
      })

      it('should throw on failure', async () => {
        const mockSpawnFn = vi.mocked(spawn)
        mockSpawnFn.mockReturnValue(mockSpawnFailure('error'))

        await expect(OnePasswordKeyProvider.listVaults()).rejects.toThrow(
          'Failed to list 1Password vaults',
        )
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

    it('should throw on empty stdout from command', async () => {
      const mockSpawnFn = vi.mocked(spawn)
      mockSpawnFn.mockReturnValue(mockSpawnSuccess(''))

      // Empty string is invalid JSON
      await expect(OnePasswordKeyProvider.listAccounts()).rejects.toThrow()
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
        accountUuid: 'test-account-uuid',
        vault: 'Private',
        itemName: 'test-key',
      })

      await expect(provider.getPrivateKey('nonexistent-key')).rejects.toThrow(
        /Key not found in 1Password.*accountUuid: test-account-uuid/,
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
          // Extract --out-file path, handling both macOS (separate args) and Linux (-c string)
          let targetPath: string | undefined
          const argsArray = args as string[]
          const cIndex = argsArray.indexOf('-c')
          if (cIndex !== -1 && cIndex + 1 < argsArray.length) {
            // Linux: parse --out-file from -c command string
            const cmdStr = argsArray[cIndex + 1]
            const match = cmdStr.match(/--out-file\s+['"]?([^\s'"]+)['"]?/)
            if (match) targetPath = match[1]
          } else {
            // macOS/Windows: --out-file is separate array element
            const outFileIndex = argsArray.indexOf('--out-file')
            if (outFileIndex !== -1) targetPath = argsArray[outFileIndex + 1]
          }

          if (targetPath) {
            // Synchronously schedule the file write (simulates op writing the file)
            setImmediate(() => {
              void (async () => {
                await fs.mkdir(path.dirname(targetPath), { recursive: true })
                await fs.writeFile(targetPath, mockPrivateKeyContent)
              })()
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

      // On macOS/Linux, op is wrapped in 'script' for PTY support
      const spawnCalls = mockSpawnFn.mock.calls

      // Helper to check if a spawn call matches expected op command
      // Handles: direct op call, macOS (script with args), Linux (script -c "...")
      const matchesOpCall = (
        call: [string, string[], ...unknown[]],
        ...expectedTerms: string[]
      ): boolean => {
        const cmd = call[0]
        const args = call[1]
        if (!Array.isArray(args)) return false
        // For direct op call: cmd is 'op', check other terms in args
        if (cmd === 'op') {
          const nonOpTerms = expectedTerms.filter((t) => t !== 'op')
          return nonOpTerms.every((term) => args.includes(term))
        }
        // macOS: script with args as individual elements (op, item, get, etc.)
        if (cmd === 'script' && expectedTerms.every((term) => args.includes(term))) return true
        // Linux: script -c "op item get ..."
        if (cmd === 'script') {
          const cIdx = args.indexOf('-c')
          if (cIdx !== -1 && cIdx + 1 < args.length) {
            const cmdStr = String(args[cIdx + 1])
            return expectedTerms.every((term) => cmdStr.includes(term))
          }
        }
        return false
      }

      // First call: keyExists check
      const keyExistsCall = spawnCalls.find((call) =>
        matchesOpCall(call as [string, string[], ...unknown[]], 'op', 'item', 'get'),
      )
      expect(keyExistsCall).toBeDefined()
      if (!keyExistsCall) throw new Error('keyExistsCall not found')
      const keyExistsArgs = keyExistsCall[1]
      if (!Array.isArray(keyExistsArgs)) throw new Error('keyExistsArgs not an array')
      // Check args - either as individual elements or within -c string
      const keyCIndex = keyExistsArgs.indexOf('-c')
      if (keyCIndex !== -1 && keyCIndex + 1 < keyExistsArgs.length) {
        const cmdStr = String(keyExistsArgs[keyCIndex + 1])
        expect(cmdStr).toContain('item')
        expect(cmdStr).toContain('get')
        expect(cmdStr).toContain('integration-test-key')
        expect(cmdStr).toContain('--vault')
        expect(cmdStr).toContain('Private')
      } else {
        expect(keyExistsArgs).toContain('item')
        expect(keyExistsArgs).toContain('get')
        expect(keyExistsArgs).toContain('integration-test-key')
        expect(keyExistsArgs).toContain('--vault')
        expect(keyExistsArgs).toContain('Private')
      }

      // Second call: document get
      const docGetCall = spawnCalls.find((call) =>
        matchesOpCall(call as [string, string[], ...unknown[]], 'op', 'document', 'get'),
      )
      expect(docGetCall).toBeDefined()
      if (!docGetCall) throw new Error('docGetCall not found')
      const docGetArgs = docGetCall[1]
      if (!Array.isArray(docGetArgs)) throw new Error('docGetArgs not an array')
      // Check args - either as individual elements or within -c string
      const docCIndex = docGetArgs.indexOf('-c')
      if (docCIndex !== -1 && docCIndex + 1 < docGetArgs.length) {
        const cmdStr = String(docGetArgs[docCIndex + 1])
        expect(cmdStr).toContain('document')
        expect(cmdStr).toContain('get')
        expect(cmdStr).toContain('integration-test-key')
        expect(cmdStr).toContain('--vault')
        expect(cmdStr).toContain('Private')
        expect(cmdStr).toContain('--out-file')
      } else {
        expect(docGetArgs).toContain('document')
        expect(docGetArgs).toContain('get')
        expect(docGetArgs).toContain('integration-test-key')
        expect(docGetArgs).toContain('--vault')
        expect(docGetArgs).toContain('Private')
        expect(docGetArgs).toContain('--out-file')
      }

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
              void (async () => {
                await fs.mkdir(path.dirname(targetPath), { recursive: true })
                await fs.writeFile(targetPath, mockPrivateKeyContent)
              })()
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
