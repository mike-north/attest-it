/**
 * Filesystem-based key provider implementation.
 *
 * @remarks
 * This provider stores private keys on the local filesystem.
 * This is the default and most common key storage approach.
 *
 * @packageDocumentation
 */

import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { homedir } from 'node:os'
import { getDefaultPrivateKeyPath } from '../key-utils.js'
import { setKeyPermissions } from '../key-utils.js'
import { generateKeyPair as ed25519GenerateKeyPair } from '../crypto/ed25519.js'
import type {
  KeyProvider,
  KeyProviderConfig,
  KeyRetrievalResult,
  KeyGenerationResult,
  KeygenProviderOptions,
} from './types.js'

/**
 * Options for creating a FilesystemKeyProvider.
 * @public
 */
export interface FilesystemKeyProviderOptions {
  /** Path to the private key file (defaults to OS-specific config dir) */
  privateKeyPath?: string
}

/**
 * Key provider that stores private keys on the filesystem.
 *
 * @remarks
 * This is the default key provider. Private keys are stored at:
 * - macOS/Linux: ~/.config/attest-it/private.pem
 * - Windows: %APPDATA%\attest-it\private.pem
 *
 * @public
 */
export class FilesystemKeyProvider implements KeyProvider {
  readonly type = 'filesystem'
  readonly displayName = 'Filesystem'

  private readonly privateKeyPath: string

  /**
   * Create a new FilesystemKeyProvider.
   * @param options - Provider options
   */
  constructor(options: FilesystemKeyProviderOptions = {}) {
    this.privateKeyPath = options.privateKeyPath ?? getDefaultPrivateKeyPath()
  }

  /**
   * Check if this provider is available.
   * Filesystem provider is always available.
   */
  async isAvailable(): Promise<boolean> {
    // Filesystem provider is always available
    return Promise.resolve(true)
  }

  /**
   * Expand a leading `~` to the user's home directory.
   * Shell tilde expansion is not performed by Node's filesystem APIs,
   * so we handle it explicitly here at the point of I/O.
   * @internal
   */
  private resolvePath(p: string): string {
    if (p.startsWith('~/') || p === '~') {
      return path.join(homedir(), p.slice(1))
    }
    return p
  }

  /**
   * Check if a key exists at the given path.
   * @param keyRef - Path to the private key file (may contain leading `~`)
   */
  async keyExists(keyRef: string): Promise<boolean> {
    try {
      await fs.access(this.resolvePath(keyRef))
      return true
    } catch {
      return false
    }
  }

  /**
   * Get the private key path for signing.
   * Returns the resolved (tilde-expanded) path with a no-op cleanup function.
   * @param keyRef - Path to the private key file (may contain leading `~`)
   */
  async getPrivateKey(keyRef: string): Promise<KeyRetrievalResult> {
    const resolved = this.resolvePath(keyRef)

    // Verify the key exists
    if (!(await this.keyExists(keyRef))) {
      throw new Error(`Private key not found: ${keyRef}`)
    }

    return {
      keyPath: resolved,
      // No-op cleanup for filesystem provider
      cleanup: async () => {
        // Nothing to clean up - key stays on filesystem
      },
    }
  }

  /**
   * Generate a new Ed25519 keypair and store on filesystem.
   * @param options - Key generation options
   */
  async generateKeyPair(options: KeygenProviderOptions): Promise<KeyGenerationResult> {
    const { publicKeyPath, force = false } = options

    // Check if keys already exist
    const privateExists = await this.fileExists(this.privateKeyPath)
    const publicExists = await this.fileExists(publicKeyPath)

    if ((privateExists || publicExists) && !force) {
      const existing = [
        privateExists ? this.privateKeyPath : null,
        publicExists ? publicKeyPath : null,
      ].filter(Boolean)
      throw new Error(
        `Key files already exist: ${existing.join(', ')}. Use force: true to overwrite.`,
      )
    }

    // Ensure parent directories exist
    await fs.mkdir(path.dirname(this.privateKeyPath), { recursive: true })
    await fs.mkdir(path.dirname(publicKeyPath), { recursive: true })

    // Generate Ed25519 keypair
    const keyPair = ed25519GenerateKeyPair()

    // Write private key
    await fs.writeFile(this.privateKeyPath, keyPair.privateKey, 'utf-8')
    await setKeyPermissions(this.privateKeyPath)

    // Write public key
    await fs.writeFile(publicKeyPath, keyPair.publicKey, 'utf-8')

    return {
      privateKeyRef: this.privateKeyPath,
      publicKeyPath,
      storageDescription: `Filesystem: ${this.privateKeyPath}`,
      encrypted: false,
    }
  }

  /**
   * Check if a file exists.
   * @internal
   */
  private async fileExists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath)
      return true
    } catch {
      return false
    }
  }

  /**
   * Get the configuration for this provider.
   */
  getConfig(): KeyProviderConfig {
    return {
      type: this.type,
      options: {
        privateKeyPath: this.privateKeyPath,
      },
    }
  }
}
