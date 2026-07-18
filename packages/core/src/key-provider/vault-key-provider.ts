/**
 * VaultKeeper-based key provider implementation.
 *
 * @remarks
 * This provider delegates secret storage to a VaultKeeper SecretBackend,
 * enabling unified policy-enforced key storage across OS credential backends.
 *
 */

import { Buffer } from 'node:buffer'
import * as crypto from 'node:crypto'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import type { SecretBackend, SigningBackend } from 'vaultkeeper'
import { getBackendCapabilities, isSigningBackend, SigningKeyNotFoundError } from 'vaultkeeper'
import { generateKeyPair as ed25519GenerateKeyPair } from '../crypto/ed25519.js'
import { setKeyPermissions } from '../crypto.js'
import type {
  KeyProvider,
  KeyProviderConfig,
  KeyPresenceCapability,
  KeyRetrievalResult,
  KeyGenerationResult,
  KeygenProviderOptions,
} from './types.js'

/**
 * The JOSE signing algorithm attest-it enrolls in delegated signing backends.
 * attest-it signs seals with Ed25519, whose JOSE `alg` identifier is `EdDSA`.
 */
const DELEGATED_SIGNING_ALGORITHM = 'EdDSA' as const

/**
 * Convert an SPKI-PEM Ed25519 public key to attest-it's compact wire format:
 * the base64 of the raw 32-byte key (SPKI DER minus its 12-byte header).
 */
function spkiPemToRawBase64(publicKeyPem: string): string {
  const der = crypto.createPublicKey(publicKeyPem).export({ type: 'spki', format: 'der' })
  return Buffer.from(der).subarray(12).toString('base64')
}

/**
 * Options for creating a VaultKeyProvider.
 * @public
 */
export interface VaultKeyProviderOptions {
  /** The VaultKeeper backend to use for storage */
  backend: SecretBackend
  /** Human-readable name for display (e.g., "1Password via VaultKeeper") */
  displayName: string
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
   * Delegated signing entry point, present only when the underlying backend
   * implements VaultKeeper's `SigningBackend` contract.
   *
   * @remarks
   * Assigned in the constructor so `signDirectly` is absent for non-signing
   * backends — callers detect delegated-signing support via its presence
   * combined with {@link VaultKeyProvider.supportsDelegatedSigning}. When
   * delegated signing is used the raw private key never leaves the backend, so
   * no PEM is written to disk (resolves the former `getPrivateKey` temp-file
   * TODO for signing-capable backends).
   */
  readonly signDirectly?: (keyRef: string, data: string | Buffer) => Promise<string>

  /**
   * Create a new VaultKeyProvider.
   * @param options - Provider options including the VaultKeeper backend
   */
  constructor(options: VaultKeyProviderOptions) {
    this.backend = options.backend
    this.type = options.backend.type
    this.displayName = options.displayName

    if (isSigningBackend(this.backend)) {
      const signingBackend: SigningBackend = this.backend
      this.signDirectly = async (keyRef, data) => {
        const dataBuffer = typeof data === 'string' ? Buffer.from(data, 'utf8') : data
        const signature = await signingBackend.signWithKey(keyRef, dataBuffer)
        return signature.toString('base64')
      }
    }
  }

  /**
   * Check if the underlying VaultKeeper backend is available.
   */
  async isAvailable(): Promise<boolean> {
    return this.backend.isAvailable()
  }

  /**
   * Check if a key exists in the VaultKeeper backend.
   *
   * @remarks
   * For a signing-capable backend a key may live in the delegated signing-key
   * namespace rather than the plain secret store, so both are checked.
   *
   * @param keyRef - Secret identifier in the backend
   */
  async keyExists(keyRef: string): Promise<boolean> {
    if (isSigningBackend(this.backend) && (await this.signingKeyExists(this.backend, keyRef))) {
      return true
    }
    return this.backend.exists(keyRef)
  }

  /**
   * Whether a delegated signing key is enrolled under `keyRef`.
   *
   * @remarks
   * VaultKeeper exposes no direct existence check for signing keys, so this
   * probes `getPublicKey` (which never triggers a presence prompt). A
   * `SigningKeyNotFoundError` means "not enrolled" — the correct fail-closed
   * result (`false`). Any other error (backend unavailable, a transient
   * 1Password/network blip, a decrypt failure) is re-thrown so it surfaces as a
   * backend failure rather than being silently misreported as "no delegated
   * key" (which would then confusingly fall back and fail with "Secret not
   * found").
   */
  private async signingKeyExists(backend: SigningBackend, keyRef: string): Promise<boolean> {
    try {
      await backend.getPublicKey(keyRef)
      return true
    } catch (error) {
      if (error instanceof SigningKeyNotFoundError) {
        return false
      }
      throw error
    }
  }

  /**
   * Report whether `keyRef` can be signed via delegated backend signing, so
   * callers can prefer {@link VaultKeyProvider.signDirectly} and avoid ever
   * materializing the raw private key. Fail-closed: `false` when the backend is
   * not signing-capable or no signing key is enrolled under `keyRef`.
   *
   * @param keyRef - Secret identifier in the backend
   */
  async supportsDelegatedSigning(keyRef: string): Promise<boolean> {
    if (!isSigningBackend(this.backend)) {
      return false
    }
    return this.signingKeyExists(this.backend, keyRef)
  }

  /**
   * Report whether the underlying backend enforces a fresh per-use human
   * presence check. Fail-closed via VaultKeeper's `getBackendCapabilities`: a
   * backend that does not implement the capability contract reports
   * `{ presencePerUse: false }`.
   */
  async getPresenceCapability(): Promise<KeyPresenceCapability> {
    const capabilities = await getBackendCapabilities(this.backend)
    return {
      presencePerUse: capabilities.presencePerUse,
      ...(capabilities.presenceEnforcedOperations && {
        presenceEnforcedOperations: capabilities.presenceEnforcedOperations,
      }),
    }
  }

  /**
   * Retrieve the private key from VaultKeeper for signing.
   *
   * @remarks
   * Downloads the PEM to a secure temporary file (mode 0o600) and returns
   * a cleanup function that overwrites the file with random bytes before deletion.
   *
   * @param keyRef - Secret identifier in the backend
   * @throws Error if the key does not exist in the backend
   */
  async getPrivateKey(keyRef: string): Promise<KeyRetrievalResult> {
    // Retrieve PEM content from VaultKeeper backend
    const pemContent = await this.backend.retrieve(keyRef)

    // Write to a secure temp file because OpenSSL `dgst -sign` requires a file path.
    // TODO: If VaultKeeper adds an `exec` API that can pipe secrets via stdin,
    // we could avoid touching disk entirely.
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'attest-it-vk-'))
    const tempKeyPath = path.join(tempDir, 'private.pem')

    try {
      await fs.writeFile(tempKeyPath, pemContent, 'utf-8')
      await setKeyPermissions(tempKeyPath)

      return {
        keyPath: tempKeyPath,
        cleanup: async () => {
          try {
            // Overwrite with random bytes before unlinking for security
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
        // Re-throw anything that is not an ENOENT (file-not-found) error.
        // ENOENT means the file doesn't exist yet, which is the expected case.
        if (!(err instanceof Error && 'code' in err && err.code === 'ENOENT')) {
          throw err
        }
      }
    }

    // Generate a unique ID for the key material in VaultKeeper
    const secretId = `attest-it-${crypto.randomUUID()}`

    // Ensure public key directory exists
    await fs.mkdir(path.dirname(publicKeyPath), { recursive: true })

    // Delegated signing path: the backend generates and holds the private key
    // itself. attest-it never sees the raw key — it only receives the public
    // half. This keeps signing-capable keys off attest-it's disk entirely.
    if (isSigningBackend(this.backend)) {
      await this.backend.generateSigningKey(secretId, DELEGATED_SIGNING_ALGORITHM)
      const { publicKeyPem } = await this.backend.getPublicKey(secretId)
      await fs.writeFile(publicKeyPath, spkiPemToRawBase64(publicKeyPem), 'utf-8')

      return {
        privateKeyRef: secretId,
        publicKeyPath,
        storageDescription: `VaultKeeper (${this.backend.displayName}, delegated signing): ${secretId}`,
      }
    }

    // Secret-store fallback: attest-it generates the keypair locally and stores
    // the PEM as an ordinary secret for backends without delegated signing.
    const keyPair = ed25519GenerateKeyPair()

    // Write public key to filesystem
    await fs.writeFile(publicKeyPath, keyPair.publicKey, 'utf-8')

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
      options: { backendType: this.backend.type },
    }
  }
}
