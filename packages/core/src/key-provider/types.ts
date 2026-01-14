/**
 * Types and interfaces for key provider system.
 *
 * @remarks
 * The key provider system abstracts key storage backends, allowing private keys
 * to be stored in various locations (filesystem, 1Password, etc.) while maintaining
 * a consistent interface for key retrieval and signing operations.
 *
 * @packageDocumentation
 */

/**
 * Configuration for a key provider instance.
 * @public
 */
export interface KeyProviderConfig {
  /** Provider type identifier */
  type: string
  /** Provider-specific configuration */
  options: Record<string, unknown>
}

/**
 * Result of a key retrieval operation.
 * @public
 */
export interface KeyRetrievalResult {
  /**
   * Path to the private key file.
   * For ephemeral providers, this is a temporary file that must be cleaned up.
   */
  keyPath: string
  /**
   * Cleanup function to call after signing is complete.
   * For filesystem provider, this is a no-op.
   * For 1Password provider, this securely deletes the temp file.
   */
  cleanup: () => Promise<void>
}

/**
 * Result of key generation.
 * @public
 */
export interface KeyGenerationResult {
  /** Path or reference to the private key */
  privateKeyRef: string
  /** Path to the public key file (always filesystem for commit to repo) */
  publicKeyPath: string
  /** Human-readable storage location description */
  storageDescription: string
}

/**
 * Options for key generation via provider.
 * @public
 */
export interface KeygenProviderOptions {
  /** Path for public key output (always filesystem) */
  publicKeyPath: string
  /** Overwrite existing keys */
  force?: boolean
}

/**
 * Abstract interface for key storage providers.
 * @public
 */
export interface KeyProvider {
  /** Unique identifier for this provider type */
  readonly type: string

  /** Human-readable name for display */
  readonly displayName: string

  /**
   * Check if this provider is available on the current system.
   */
  isAvailable(): Promise<boolean>

  /**
   * Check if a key exists in this provider.
   * @param keyRef - Provider-specific key reference
   */
  keyExists(keyRef: string): Promise<boolean>

  /**
   * Retrieve the private key for signing.
   * Returns a temporary file path that can be passed to OpenSSL.
   * Caller MUST call cleanup() after signing is complete.
   */
  getPrivateKey(keyRef: string): Promise<KeyRetrievalResult>

  /**
   * Generate a new keypair and store the private key.
   * Public key is always written to filesystem for repository commit.
   */
  generateKeyPair(options: KeygenProviderOptions): Promise<KeyGenerationResult>

  /**
   * Get the configuration needed to use this provider.
   */
  getConfig(): KeyProviderConfig
}
