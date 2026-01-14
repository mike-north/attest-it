/**
 * Filesystem-based key provider implementation.
 *
 * @remarks
 * This provider stores private keys on the local filesystem, maintaining
 * backward compatibility with the existing attest-it key storage behavior.
 *
 * @packageDocumentation
 */

import * as fs from 'node:fs/promises'
import {
  generateKeyPair as cryptoGenerateKeyPair,
  getDefaultPrivateKeyPath,
} from '../crypto.js'
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
 * This is the default provider and maintains backward compatibility with
 * existing attest-it installations. Private keys are stored at:
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
   * Check if a key exists at the given path.
   * @param keyRef - Path to the private key file
   */
  async keyExists(keyRef: string): Promise<boolean> {
    try {
      await fs.access(keyRef)
      return true
    } catch {
      return false
    }
  }

  /**
   * Get the private key path for signing.
   * Returns the path directly with a no-op cleanup function.
   * @param keyRef - Path to the private key file
   */
  async getPrivateKey(keyRef: string): Promise<KeyRetrievalResult> {
    // Verify the key exists
    if (!(await this.keyExists(keyRef))) {
      throw new Error(`Private key not found: ${keyRef}`)
    }

    return {
      keyPath: keyRef,
      // No-op cleanup for filesystem provider
      cleanup: async () => {
        // Nothing to clean up - key stays on filesystem
      },
    }
  }

  /**
   * Generate a new keypair and store on filesystem.
   * @param options - Key generation options
   */
  async generateKeyPair(options: KeygenProviderOptions): Promise<KeyGenerationResult> {
    const { publicKeyPath, force = false } = options

    // Delegate to existing crypto module function
    const result = await cryptoGenerateKeyPair({
      privatePath: this.privateKeyPath,
      publicPath: publicKeyPath,
      force,
    })

    return {
      privateKeyRef: result.privatePath,
      publicKeyPath: result.publicPath,
      storageDescription: `Filesystem: ${result.privatePath}`,
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
