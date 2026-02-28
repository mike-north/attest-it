/**
 * VaultKeeper-based key provider implementation.
 *
 * @remarks
 * This provider delegates secret storage to a VaultKeeper SecretBackend,
 * enabling unified policy-enforced key storage across OS credential backends.
 *
 * @packageDocumentation
 */

import * as crypto from 'node:crypto'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import type { SecretBackend } from 'vaultkeeper'
import { generateKeyPair as ed25519GenerateKeyPair } from '../crypto/ed25519.js'
import { setKeyPermissions } from '../crypto.js'
import type {
  KeyProvider,
  KeyProviderConfig,
  KeyRetrievalResult,
  KeyGenerationResult,
  KeygenProviderOptions,
} from './types.js'

/**
 * Options for creating a VaultKeyProvider.
 * @public
 */
export interface VaultKeyProviderOptions {
  /** The VaultKeeper backend to use for storage */
  backend: SecretBackend
  /** Human-readable name for display (e.g., "1Password via VaultKeeper") */
  displayName?: string
}

/**
 * Key provider that delegates storage to a VaultKeeper SecretBackend.
 *
 * @remarks
 * This adapter bridges attest-it's key provider system with VaultKeeper's
 * backend abstraction. Any VaultKeeper SecretBackend can be used, enabling
 * storage in macOS Keychain, 1Password, YubiKey, or other backends supported
 * by VaultKeeper.
 *
 * @public
 */
export class VaultKeyProvider implements KeyProvider {
  readonly type: string
  readonly displayName: string

  private readonly backend: SecretBackend

  /**
   * Create a new VaultKeyProvider.
   * @param options - Provider options including the VaultKeeper backend
   */
  constructor(options: VaultKeyProviderOptions) {
    this.backend = options.backend
    this.type = options.backend.type
    this.displayName = options.displayName ?? `VaultKeeper (${options.backend.displayName})`
  }

  /**
   * Check if the underlying VaultKeeper backend is available.
   */
  async isAvailable(): Promise<boolean> {
    return this.backend.isAvailable()
  }

  /**
   * Check if a key exists in the VaultKeeper backend.
   * @param keyRef - Secret identifier in the backend
   */
  async keyExists(keyRef: string): Promise<boolean> {
    return this.backend.exists(keyRef)
  }

  /**
   * Retrieve the private key from VaultKeeper for signing.
   *
   * @remarks
   * Downloads the PEM to a secure temporary file (mode 0o600) and returns
   * a cleanup function that overwrites the file with zeros before deletion.
   *
   * @param keyRef - Secret identifier in the backend
   * @throws Error if the key does not exist in the backend
   */
  async getPrivateKey(keyRef: string): Promise<KeyRetrievalResult> {
    // Retrieve PEM content from VaultKeeper backend
    const pemContent = await this.backend.retrieve(keyRef)

    // Write to secure temp file
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'attest-it-vk-'))
    const tempKeyPath = path.join(tempDir, 'private.pem')

    try {
      await fs.writeFile(tempKeyPath, pemContent, 'utf-8')
      await setKeyPermissions(tempKeyPath)

      return {
        keyPath: tempKeyPath,
        cleanup: async () => {
          try {
            // Overwrite with zeros before unlinking for security
            const stat = await fs.stat(tempKeyPath)
            await fs.writeFile(tempKeyPath, crypto.randomBytes(stat.size))
            await fs.unlink(tempKeyPath)
            await fs.rmdir(tempDir)
          } catch (cleanupError) {
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
        console.warn(
          `Warning: Failed to clean up temporary key directory at ${tempDir}: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`,
        )
      }
      throw error
    }
  }

  /**
   * Generate a new Ed25519 keypair and store the private key in VaultKeeper.
   *
   * @remarks
   * The public key is written to the filesystem for repository commit.
   * The private key is stored in the VaultKeeper backend and the local
   * copy is securely deleted.
   *
   * @param options - Key generation options
   */
  async generateKeyPair(options: KeygenProviderOptions): Promise<KeyGenerationResult> {
    const { publicKeyPath, force = false } = options

    // Check if public key file already exists
    if (!force) {
      try {
        await fs.access(publicKeyPath)
        throw new Error(
          `Public key file already exists: ${publicKeyPath}. Use force: true to overwrite.`,
        )
      } catch (err) {
        // File doesn't exist, which is what we want
        if (err instanceof Error && !err.message.includes('already exists')) {
          // This is an access error (file doesn't exist), continue
        } else {
          throw err
        }
      }
    }

    // Generate Ed25519 keypair
    const keyPair = ed25519GenerateKeyPair()

    // Ensure public key directory exists
    await fs.mkdir(path.dirname(publicKeyPath), { recursive: true })

    // Write public key to filesystem
    await fs.writeFile(publicKeyPath, keyPair.publicKey, 'utf-8')

    // Generate a unique ID for the secret in VaultKeeper
    const secretId = `attest-it-${crypto.randomUUID()}`

    // Store private key in VaultKeeper backend
    await this.backend.store(secretId, keyPair.privateKey)

    return {
      privateKeyRef: secretId,
      publicKeyPath,
      storageDescription: `VaultKeeper (${this.backend.displayName}): ${secretId}`,
    }
  }

  /**
   * Get the configuration for this provider.
   */
  getConfig(): KeyProviderConfig {
    return {
      type: this.type,
      options: {},
    }
  }
}
