import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { runKeygen } from '../src/commands/keygen.js'
import * as fs from 'node:fs'

// Mock the core functions
vi.mock('@attest-it/core', async () => {
  const actual = await vi.importActual<typeof import('@attest-it/core')>('@attest-it/core')
  return {
    ...actual,
    checkOpenSSL: vi.fn(),
    generateKeyPair: vi.fn(),
    setKeyPermissions: vi.fn(),
    getDefaultPrivateKeyPath: vi.fn(),
    getDefaultPublicKeyPath: vi.fn(),
  }
})

// Mock fs module
vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
}))

// Mock prompts
vi.mock('../src/utils/prompts.js', () => ({
  confirmAction: vi.fn(),
}))

// Mock console methods
const mockConsoleLog = vi.spyOn(console, 'log').mockImplementation(() => {
  // Intentionally empty
})
const mockConsoleError = vi.spyOn(console, 'error').mockImplementation(() => {
  // Intentionally empty
})
const mockConsoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {
  // Intentionally empty
})
const mockProcessExit = vi.spyOn(process, 'exit').mockImplementation(() => {
  throw new Error('process.exit called')
})

// Import mocked functions
const {
  checkOpenSSL,
  generateKeyPair,
  setKeyPermissions,
  getDefaultPrivateKeyPath,
  getDefaultPublicKeyPath,
} = await import('@attest-it/core')

const { confirmAction } = await import('../src/utils/prompts.js')

describe('keygen command', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Default mock implementations
    vi.mocked(checkOpenSSL).mockResolvedValue('OpenSSL 3.0.0')
    vi.mocked(getDefaultPrivateKeyPath).mockReturnValue('/home/user/.config/attest-it/private.pem')
    vi.mocked(getDefaultPublicKeyPath).mockReturnValue('/home/user/repo/attest-it-public.pem')
    vi.mocked(generateKeyPair).mockResolvedValue({
      privatePath: '/home/user/.config/attest-it/private.pem',
      publicPath: '/home/user/repo/attest-it-public.pem',
    })
    vi.mocked(setKeyPermissions).mockResolvedValue(undefined)
    vi.mocked(fs.existsSync).mockReturnValue(false)
    vi.mocked(confirmAction).mockResolvedValue(true)
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('runKeygen', () => {
    describe('positive cases', () => {
      it('should generate RSA keypair successfully', async () => {
        await runKeygen({
          force: false,
        })

        expect(checkOpenSSL).toHaveBeenCalled()
        expect(generateKeyPair).toHaveBeenCalledWith({
          privatePath: '/home/user/.config/attest-it/private.pem',
          publicPath: '/home/user/repo/attest-it-public.pem',
          force: true,
        })
        expect(setKeyPermissions).toHaveBeenCalledWith('/home/user/.config/attest-it/private.pem')
        expect(mockConsoleLog).toHaveBeenCalledWith(
          expect.stringContaining('Keypair generated successfully'),
        )
      })

      it('should use custom output paths when provided', async () => {
        await runKeygen({
          output: '/custom/private.pem',
          public: '/custom/public.pem',
          force: false,
        })

        expect(generateKeyPair).toHaveBeenCalledWith({
          privatePath: '/custom/private.pem',
          publicPath: '/custom/public.pem',
          force: true,
        })
      })

      it('should overwrite with --force flag', async () => {
        vi.mocked(fs.existsSync).mockReturnValue(true)

        await runKeygen({
          force: true,
        })

        // Should not prompt for confirmation
        expect(confirmAction).not.toHaveBeenCalled()
        expect(generateKeyPair).toHaveBeenCalled()
      })

      it('should display OpenSSL version', async () => {
        vi.mocked(checkOpenSSL).mockResolvedValue('OpenSSL 3.1.0 1 Jan 2023')

        await runKeygen({
          force: false,
        })

        expect(mockConsoleLog).toHaveBeenCalledWith(
          expect.stringContaining('OpenSSL: OpenSSL 3.1.0 1 Jan 2023'),
        )
      })
    })

    describe('negative cases', () => {
      it('should exit when user declines overwrite', async () => {
        vi.mocked(fs.existsSync).mockReturnValue(true)
        vi.mocked(confirmAction).mockResolvedValue(false)

        await expect(async () => {
          await runKeygen({
            force: false,
          })
        }).rejects.toThrow('process.exit called')

        expect(mockProcessExit).toHaveBeenCalledWith(3)
        expect(mockConsoleError).toHaveBeenCalledWith(expect.stringContaining('Keygen cancelled'))
        expect(generateKeyPair).not.toHaveBeenCalled()
      })

      it('should handle OpenSSL check failure', async () => {
        vi.mocked(checkOpenSSL).mockRejectedValue(new Error('OpenSSL not found'))

        await expect(async () => {
          await runKeygen({
            force: false,
          })
        }).rejects.toThrow('process.exit called')

        expect(mockProcessExit).toHaveBeenCalledWith(3) // CONFIG_ERROR
        expect(mockConsoleError).toHaveBeenCalledWith(expect.stringContaining('OpenSSL not found'))
      })

      it('should handle key generation failure', async () => {
        vi.mocked(generateKeyPair).mockRejectedValue(new Error('Failed to generate private key'))

        await expect(async () => {
          await runKeygen({
            force: false,
          })
        }).rejects.toThrow('process.exit called')

        expect(mockProcessExit).toHaveBeenCalledWith(3) // CONFIG_ERROR
        expect(mockConsoleError).toHaveBeenCalledWith(
          expect.stringContaining('Failed to generate private key'),
        )
      })

      it('should handle unknown error types', async () => {
        vi.mocked(generateKeyPair).mockRejectedValue('string error')

        await expect(async () => {
          await runKeygen({
            force: false,
          })
        }).rejects.toThrow('process.exit called')

        expect(mockProcessExit).toHaveBeenCalledWith(3) // CONFIG_ERROR
        expect(mockConsoleError).toHaveBeenCalledWith(expect.stringContaining('Unknown error'))
      })
    })

    describe('edge cases', () => {
      it('should prompt when only private key exists', async () => {
        vi.mocked(fs.existsSync)
          .mockReturnValueOnce(true) // private exists
          .mockReturnValueOnce(false) // public does not exist
        vi.mocked(confirmAction).mockResolvedValue(true)

        await runKeygen({
          force: false,
        })

        expect(confirmAction).toHaveBeenCalledWith({
          message: 'Overwrite existing keys?',
          default: false,
        })
        expect(generateKeyPair).toHaveBeenCalled()
      })

      it('should prompt when only public key exists', async () => {
        vi.mocked(fs.existsSync)
          .mockReturnValueOnce(false) // private does not exist
          .mockReturnValueOnce(true) // public exists
        vi.mocked(confirmAction).mockResolvedValue(true)

        await runKeygen({
          force: false,
        })

        expect(confirmAction).toHaveBeenCalledWith({
          message: 'Overwrite existing keys?',
          default: false,
        })
        expect(generateKeyPair).toHaveBeenCalled()
      })

      it('should display warning for existing keys', async () => {
        vi.mocked(fs.existsSync).mockReturnValue(true)
        vi.mocked(confirmAction).mockResolvedValue(true)

        await runKeygen({
          force: false,
        })

        // Should display warnings via console.warn
        const warnCalls = mockConsoleWarn.mock.calls
          .map((call: unknown[]) => {
            const firstArg: unknown = call[0]
            return firstArg
          })
          .filter(
            (msg: unknown): msg is string =>
              typeof msg === 'string' && msg.includes('already exists'),
          )

        expect(warnCalls.length).toBeGreaterThan(0)
      })

      it('should skip overwrite check when no keys exist', async () => {
        vi.mocked(fs.existsSync).mockReturnValue(false)

        await runKeygen({
          force: false,
        })

        expect(confirmAction).not.toHaveBeenCalled()
        expect(generateKeyPair).toHaveBeenCalled()
      })

      it('should handle setKeyPermissions failure gracefully', async () => {
        vi.mocked(setKeyPermissions).mockRejectedValue(new Error('Permission denied'))

        await expect(async () => {
          await runKeygen({
            force: false,
          })
        }).rejects.toThrow('process.exit called')

        expect(mockProcessExit).toHaveBeenCalledWith(3) // CONFIG_ERROR
        expect(mockConsoleError).toHaveBeenCalledWith(expect.stringContaining('Permission denied'))
      })
    })
  })
})
