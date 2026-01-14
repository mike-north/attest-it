/**
 * macOS Keychain-based key provider implementation.
 *
 * @remarks
 * This provider stores private keys in the macOS Keychain and retrieves them via the
 * `security` CLI tool. Keys are stored as base64-encoded strings and downloaded to
 * temporary files for signing operations, then securely deleted after use.
 *
 * @packageDocumentation
 */

import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { spawn } from 'node:child_process'
import {
  generateKeyPair as cryptoGenerateKeyPair,
  setKeyPermissions,
} from '../crypto.js'
import type {
  KeyProvider,
  KeyProviderConfig,
  KeyRetrievalResult,
  KeyGenerationResult,
  KeygenProviderOptions,
} from './types.js'

/**
 * Options for creating a MacOSKeychainKeyProvider.
 * @public
 */
export interface MacOSKeychainKeyProviderOptions {
  /** Item name in keychain (e.g., "attest-it-private-key") */
  itemName: string
}

/**
 * Key provider that stores private keys in macOS Keychain.
 *
 * @remarks
 * This provider requires macOS and uses the `security` CLI tool.
 * Private keys are stored as base64-encoded strings in the keychain and decoded
 * to temporary files for signing operations.
 *
 * @public
 */
export class MacOSKeychainKeyProvider implements KeyProvider {
  readonly type = 'macos-keychain'
  readonly displayName = 'macOS Keychain'

  private readonly itemName: string
  private static readonly ACCOUNT = 'attest-it'

  /**
   * Create a new MacOSKeychainKeyProvider.
   * @param options - Provider options
   */
  constructor(options: MacOSKeychainKeyProviderOptions) {
    this.itemName = options.itemName
  }

  /**
   * Check if this provider is available.
   * Only available on macOS platforms.
   */
  static isAvailable(): boolean {
    return process.platform === 'darwin'
  }

  /**
   * Check if this provider is available on the current system.
   */
  isAvailable(): Promise<boolean> {
    return Promise.resolve(MacOSKeychainKeyProvider.isAvailable())
  }

  /**
   * Check if a key exists in the keychain.
   * @param keyRef - Item name in keychain
   */
  async keyExists(keyRef: string): Promise<boolean> {
    try {
      await execCommand('security', [
        'find-generic-password',
        '-a',
        MacOSKeychainKeyProvider.ACCOUNT,
        '-s',
        keyRef,
      ])
      return true
    } catch {
      return false
    }
  }

  /**
   * Get the private key from keychain for signing.
   * Downloads to a temporary file and returns a cleanup function.
   * @param keyRef - Item name in keychain
   * @throws Error if the key does not exist in keychain
   */
  async getPrivateKey(keyRef: string): Promise<KeyRetrievalResult> {
    // Check if key exists first for better error messages
    if (!(await this.keyExists(keyRef))) {
      throw new Error(
        `Key not found in macOS Keychain: "${keyRef}" (account: ${MacOSKeychainKeyProvider.ACCOUNT})`,
      )
    }

    // Create a temporary file
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'attest-it-'))
    const tempKeyPath = path.join(tempDir, 'private.pem')

    try {
      // Retrieve the base64-encoded key from keychain
      const base64Key = await execCommand('security', [
        'find-generic-password',
        '-a',
        MacOSKeychainKeyProvider.ACCOUNT,
        '-s',
        keyRef,
        '-w',
      ])

      // Decode from base64 and write to temp file
      const keyContent = Buffer.from(base64Key, 'base64').toString('utf8')
      await fs.writeFile(tempKeyPath, keyContent, { mode: 0o600 })

      // Set proper permissions
      await setKeyPermissions(tempKeyPath)

      return {
        keyPath: tempKeyPath,
        cleanup: async () => {
          // Securely delete the temporary file and directory
          try {
            await fs.unlink(tempKeyPath)
            await fs.rmdir(tempDir)
          } catch {
            // Best effort cleanup
          }
        },
      }
    } catch (error) {
      // Clean up temp directory on error
      try {
        await fs.rm(tempDir, { recursive: true, force: true })
      } catch {
        // Best effort cleanup
      }
      throw error
    }
  }

  /**
   * Generate a new keypair and store private key in keychain.
   * Public key is written to filesystem for repository commit.
   * @param options - Key generation options
   */
  async generateKeyPair(options: KeygenProviderOptions): Promise<KeyGenerationResult> {
    const { publicKeyPath, force = false } = options

    // Create a temporary directory for key generation
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'attest-it-keygen-'))
    const tempPrivateKeyPath = path.join(tempDir, 'private.pem')

    try {
      // Generate the keypair to temporary location
      await cryptoGenerateKeyPair({
        privatePath: tempPrivateKeyPath,
        publicPath: publicKeyPath,
        force,
      })

      // Read the private key and encode as base64
      const privateKeyContent = await fs.readFile(tempPrivateKeyPath, 'utf8')
      const base64Key = Buffer.from(privateKeyContent, 'utf8').toString('base64')

      // Store in keychain
      // The -T "" flag allows all applications to access the key
      // The -U flag updates if the item already exists
      await execCommand('security', [
        'add-generic-password',
        '-a',
        MacOSKeychainKeyProvider.ACCOUNT,
        '-s',
        this.itemName,
        '-w',
        base64Key,
        '-T',
        '',
        '-U',
      ])

      // Clean up temporary private key
      await fs.unlink(tempPrivateKeyPath)
      await fs.rmdir(tempDir)

      return {
        privateKeyRef: this.itemName,
        publicKeyPath,
        storageDescription: `macOS Keychain: ${this.itemName}`,
      }
    } catch (error) {
      // Clean up on error
      try {
        await fs.rm(tempDir, { recursive: true, force: true })
      } catch {
        // Best effort cleanup
      }
      throw error
    }
  }

  /**
   * Get the configuration for this provider.
   */
  getConfig(): KeyProviderConfig {
    return {
      type: this.type,
      options: {
        itemName: this.itemName,
      },
    }
  }
}

/**
 * Execute a command and return stdout.
 * @internal
 */
async function execCommand(command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''

    proc.stdout.on('data', (data: Buffer) => {
      stdout += data.toString()
    })

    proc.stderr.on('data', (data: Buffer) => {
      stderr += data.toString()
    })

    proc.on('close', (code) => {
      if (code === 0) {
        resolve(stdout.trim())
      } else {
        reject(new Error(`Command failed with exit code ${String(code)}: ${stderr}`))
      }
    })

    proc.on('error', (error) => {
      reject(error)
    })
  })
}
