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
  /** Whether the private key is encrypted with a passphrase */
  encrypted?: boolean
}

/**
 * A keyed backend operation that a per-use presence requirement can gate.
 *
 * @remarks
 * Mirrors VaultKeeper's `PresenceOperation`: `'read'` is the secret read behind
 * a signing/retrieval unlock; `'store'`, `'delete'`, and `'sign'` are the write,
 * removal, and signing paths.
 *
 * @public
 */
export type KeyPresenceOperation = 'read' | 'store' | 'delete' | 'sign'

/**
 * Whether a provider's underlying backend enforces a fresh per-use human
 * presence check (e.g. a hardware touch or per-use biometric approval).
 *
 * @remarks
 * Reported fail-closed: a provider whose backend cannot prove per-use presence
 * reports `{ presencePerUse: false }` rather than silently claiming a guarantee
 * it cannot enforce.
 *
 * @public
 */
export interface KeyPresenceCapability {
  /**
   * `true` when the active key's backend forces a distinct, fresh physical human
   * action for the operations in {@link KeyPresenceCapability.presenceEnforcedOperations}
   * (all keyed operations when that field is omitted).
   */
  presencePerUse: boolean
  /**
   * The keyed operations for which a fresh per-use action is actually forced.
   * Omitted when presence is enforced for all keyed operations. Ignored when
   * {@link KeyPresenceCapability.presencePerUse} is `false`.
   */
  presenceEnforcedOperations?: readonly KeyPresenceOperation[]
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
  /** Passphrase to encrypt the private key (filesystem provider only) */
  passphrase?: string
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
   *
   * @remarks
   * This is the fallback signing path used when delegated signing is not
   * available for the key (see {@link KeyProvider.signDirectly}). It exposes the
   * raw private key to the current process as a temporary file.
   */
  getPrivateKey(keyRef: string): Promise<KeyRetrievalResult>

  /**
   * Sign `data` for `keyRef` entirely inside the provider's backend, returning a
   * base64-encoded signature — the raw private key never leaves the backend and
   * never touches this process's memory as a file or disk.
   *
   * @remarks
   * Optional and additive: present only for providers whose backend implements
   * delegated signing. Callers MUST prefer this over {@link KeyProvider.getPrivateKey}
   * when both it and {@link KeyProvider.supportsDelegatedSigning} indicate the key
   * is signable this way. Its per-provider presence does not by itself guarantee a
   * given `keyRef` is delegated-signable — gate on
   * {@link KeyProvider.supportsDelegatedSigning}.
   *
   * @param keyRef - Provider-specific key reference.
   * @param data - The exact bytes to sign (strings are UTF-8-encoded).
   */
  signDirectly?(keyRef: string, data: string | Buffer): Promise<string>

  /**
   * Report whether `keyRef` can be signed via {@link KeyProvider.signDirectly}
   * without ever exposing the raw private key.
   *
   * @remarks
   * Per-key (not merely per-provider): a backend may hold some keys as delegated
   * signing keys and others as plain retrievable secrets. Returns `false`
   * (fail-closed) for providers or keys that do not support delegated signing, so
   * callers safely fall back to {@link KeyProvider.getPrivateKey}.
   */
  supportsDelegatedSigning?(keyRef: string): Promise<boolean>

  /**
   * Report whether this provider's backend enforces a fresh per-use human
   * presence check. Optional and fail-closed: absence is treated as
   * `{ presencePerUse: false }`.
   */
  getPresenceCapability?(): Promise<KeyPresenceCapability>

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
