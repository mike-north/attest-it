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
import { generateKeyPair as ed25519GenerateKeyPair } from '../crypto/ed25519.js'
import { setKeyPermissions } from '../key-utils.js'
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
  /** Path to the keychain file (optional, uses default keychain if not specified) */
  keychain?: string
}

/**
 * Information about a macOS keychain.
 * @public
 */
export interface MacOSKeychain {
  /** Full path to the keychain file */
  path: string
  /** Display name (filename without extension) */
  name: string
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
  private readonly keychain?: string
  private static readonly ACCOUNT = 'attest-it'

  /**
   * Create a new MacOSKeychainKeyProvider.
   * @param options - Provider options
   */
  constructor(options: MacOSKeychainKeyProviderOptions) {
    this.itemName = options.itemName
    if (options.keychain !== undefined) {
      this.keychain = options.keychain
    }
  }

  /**
   * Check if this provider is available.
   * Only available on macOS platforms.
   */
  static isAvailable(): boolean {
    return process.platform === 'darwin'
  }

  /**
   * List available keychains on the system.
   * @returns Array of keychain information
   */
  static async listKeychains(): Promise<MacOSKeychain[]> {
    if (!MacOSKeychainKeyProvider.isAvailable()) {
      return []
    }

    try {
      const output = await execCommand('security', ['list-keychains'])
      // Parse output - each line is a quoted path like:
      // "    "/Users/name/Library/Keychains/login.keychain-db""
      const keychains: MacOSKeychain[] = []
      const lines = output.split('\n')
      for (const line of lines) {
        const match = /"(.+)"/.exec(line.trim())
        if (match?.[1]) {
          const fullPath = match[1]
          // Extract display name from path (filename without extension)
          const filename = fullPath.split('/').pop() ?? fullPath
          const name = filename.replace(/\.keychain(-db)?$/, '')
          keychains.push({ path: fullPath, name })
        }
      }
      return keychains
    } catch {
      return []
    }
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
      const args = ['find-generic-password', '-a', MacOSKeychainKeyProvider.ACCOUNT, '-s', keyRef]
      if (this.keychain) {
        args.push(this.keychain)
      }
      await execCommand('security', args)
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
      const findArgs = [
        'find-generic-password',
        '-a',
        MacOSKeychainKeyProvider.ACCOUNT,
        '-s',
        keyRef,
        '-w',
      ]
      if (this.keychain) {
        findArgs.push(this.keychain)
      }
      const base64Key = await execCommand('security', findArgs)

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
          } catch (cleanupError) {
            // Log warning for security audit - temporary keys may not have been cleaned up
            console.warn(
              `Warning: Failed to clean up temporary key file at ${tempKeyPath}: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`,
            )
          }
        },
      }
    } catch (error) {
      // Clean up temp directory on error
      try {
        await fs.rm(tempDir, { recursive: true, force: true })
      } catch (cleanupError) {
        // Log warning for security audit - temporary keys may not have been cleaned up
        console.warn(
          `Warning: Failed to clean up temporary key directory at ${tempDir}: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`,
        )
      }
      throw error
    }
  }

  /**
   * Generate a new Ed25519 keypair and store private key in keychain.
   * Public key is written to filesystem for repository commit.
   * @param options - Key generation options
   */
  async generateKeyPair(options: KeygenProviderOptions): Promise<KeyGenerationResult> {
    const { publicKeyPath, force = false } = options

    // Check if public key already exists
    let publicKeyExists = false
    try {
      await fs.access(publicKeyPath)
      publicKeyExists = true
    } catch (error) {
      // File doesn't exist, which is what we want
      if (error instanceof Error && 'code' in error && error.code !== 'ENOENT') {
        throw error // Permission error or other unexpected error
      }
    }

    if (publicKeyExists && !force) {
      throw new Error(
        `Public key file already exists: ${publicKeyPath}. Use force: true to overwrite.`,
      )
    }

    // Generate Ed25519 keypair using Node.js crypto (in memory)
    const { publicKey: publicKeyBase64, privateKey: privateKeyPem } = ed25519GenerateKeyPair()

    // Ensure parent directory exists for public key
    const publicKeyDir = path.dirname(publicKeyPath)
    await fs.mkdir(publicKeyDir, { recursive: true })

    // Write public key as PEM file
    // Convert base64 public key back to PEM format for consistency
    const publicKeyPem = `-----BEGIN PUBLIC KEY-----\n${publicKeyBase64}\n-----END PUBLIC KEY-----\n`
    await fs.writeFile(publicKeyPath, publicKeyPem, { mode: 0o644 })

    // Encode private key PEM as base64 for keychain storage
    const base64Key = Buffer.from(privateKeyPem, 'utf8').toString('base64')

    // Store in keychain
    // The -T "" flag allows all applications to access the key
    // The -U flag updates if the item already exists
    const addArgs = [
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
    ]
    if (this.keychain) {
      addArgs.push(this.keychain)
    }
    await execCommand('security', addArgs)

    return {
      privateKeyRef: this.itemName,
      publicKeyPath,
      storageDescription: `macOS Keychain: ${this.itemName}`,
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
