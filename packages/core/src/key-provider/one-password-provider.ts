/**
 * 1Password-based key provider implementation.
 *
 * @remarks
 * This provider stores private keys in 1Password and retrieves them via the
 * `op` CLI tool. Keys are downloaded to a temporary file for signing and
 * securely deleted after use.
 *
 * @packageDocumentation
 */

import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { spawn } from 'node:child_process'
import { generateKeyPair as cryptoGenerateKeyPair, setKeyPermissions } from '../crypto.js'
import type {
  KeyProvider,
  KeyProviderConfig,
  KeyRetrievalResult,
  KeyGenerationResult,
  KeygenProviderOptions,
} from './types.js'

/**
 * Options for creating a OnePasswordKeyProvider.
 * @public
 */
export interface OnePasswordKeyProviderOptions {
  /** 1Password account email (optional if only one account) */
  account?: string
  /** Vault name or ID where the key is stored */
  vault: string
  /** Item name in 1Password */
  itemName: string
}

/**
 * Information about a 1Password account.
 * @public
 */
export interface OnePasswordAccount {
  /** Account UUID */
  account_uuid: string
  /** User email address */
  email: string
  /** Account URL */
  url: string
  /** User UUID */
  user_uuid: string
}

/**
 * Information about a 1Password vault.
 * @public
 */
export interface OnePasswordVault {
  /** Vault UUID */
  id: string
  /** Vault name */
  name: string
}

/**
 * Key provider that stores private keys in 1Password.
 *
 * @remarks
 * This provider requires the `op` CLI tool to be installed and authenticated.
 * Private keys are stored as documents in 1Password and downloaded to
 * temporary files for signing operations.
 *
 * @public
 */
export class OnePasswordKeyProvider implements KeyProvider {
  readonly type = '1password'
  readonly displayName = '1Password'

  private readonly account?: string
  private readonly vault: string
  private readonly itemName: string

  /**
   * Create a new OnePasswordKeyProvider.
   * @param options - Provider options
   */
  constructor(options: OnePasswordKeyProviderOptions) {
    // Only assign account if it's defined (to satisfy exactOptionalPropertyTypes)
    if (options.account !== undefined) {
      this.account = options.account
    }
    this.vault = options.vault
    this.itemName = options.itemName
  }

  /**
   * Check if the 1Password CLI is installed.
   * @returns True if `op` command is available
   */
  static async isInstalled(): Promise<boolean> {
    try {
      await execCommand('op', ['--version'])
      return true
    } catch {
      return false
    }
  }

  /**
   * List all 1Password accounts.
   * @returns Array of account information
   */
  static async listAccounts(): Promise<OnePasswordAccount[]> {
    try {
      const output = await execCommand('op', ['account', 'list', '--format=json'])
      const parsed: unknown = JSON.parse(output)
      if (!Array.isArray(parsed)) {
        return []
      }
      // Type assertion needed: We validate it's an array, but can't validate structure
      // at runtime without a full validation library. The op CLI output format is trusted.
      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
      return parsed as OnePasswordAccount[]
    } catch (error) {
      // Log in development for debugging, but don't fail
      if (process.env.NODE_ENV !== 'production') {
        console.error('Failed to list 1Password accounts:', error)
      }
      return []
    }
  }

  /**
   * List vaults in a specific account.
   * @param account - Account email (optional if only one account)
   * @returns Array of vault information
   */
  static async listVaults(account?: string): Promise<OnePasswordVault[]> {
    try {
      const args = ['vault', 'list', '--format=json']
      if (account) {
        args.push('--account', account)
      }
      const output = await execCommand('op', args)
      const parsed: unknown = JSON.parse(output)
      if (!Array.isArray(parsed)) {
        return []
      }
      // Type assertion needed: We validate it's an array, but can't validate structure
      // at runtime without a full validation library. The op CLI output format is trusted.
      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
      return parsed as OnePasswordVault[]
    } catch (error) {
      // Log in development for debugging, but don't fail
      if (process.env.NODE_ENV !== 'production') {
        console.error('Failed to list 1Password vaults:', error)
      }
      return []
    }
  }

  /**
   * Check if this provider is available.
   * Requires `op` CLI to be installed and authenticated.
   */
  async isAvailable(): Promise<boolean> {
    return OnePasswordKeyProvider.isInstalled()
  }

  /**
   * Check if a key exists in 1Password.
   * @param keyRef - Item name in 1Password
   */
  async keyExists(keyRef: string): Promise<boolean> {
    try {
      const args = ['item', 'get', keyRef, '--vault', this.vault, '--format=json']
      if (this.account) {
        args.push('--account', this.account)
      }
      await execCommand('op', args)
      return true
    } catch {
      return false
    }
  }

  /**
   * Get the private key from 1Password for signing.
   * Downloads to a temporary file and returns a cleanup function.
   * @param keyRef - Item name in 1Password
   * @throws Error if the key does not exist in 1Password
   */
  async getPrivateKey(keyRef: string): Promise<KeyRetrievalResult> {
    // Check if key exists first for better error messages
    if (!(await this.keyExists(keyRef))) {
      throw new Error(
        `Key not found in 1Password: "${keyRef}" (vault: ${this.vault})` +
          (this.account ? ` (account: ${this.account})` : ''),
      )
    }

    // Create a temporary file
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'attest-it-'))
    const tempKeyPath = path.join(tempDir, 'private.pem')

    try {
      // Download the key from 1Password
      const args = ['document', 'get', keyRef, '--vault', this.vault, '--out-file', tempKeyPath]
      if (this.account) {
        args.push('--account', this.account)
      }

      await execCommand('op', args)

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
   * Generate a new keypair and store private key in 1Password.
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

      // Upload the private key to 1Password as a document
      const args = [
        'document',
        'create',
        tempPrivateKeyPath,
        '--title',
        this.itemName,
        '--vault',
        this.vault,
      ]
      if (this.account) {
        args.push('--account', this.account)
      }

      await execCommand('op', args)

      // Clean up temporary private key
      await fs.unlink(tempPrivateKeyPath)
      await fs.rmdir(tempDir)

      return {
        privateKeyRef: this.itemName,
        publicKeyPath,
        storageDescription: `1Password: ${this.vault}/${this.itemName}`,
      }
    } catch (error) {
      // Clean up on error
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
   * Get the configuration for this provider.
   */
  getConfig(): KeyProviderConfig {
    return {
      type: this.type,
      options: {
        ...(this.account && { account: this.account }),
        vault: this.vault,
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
