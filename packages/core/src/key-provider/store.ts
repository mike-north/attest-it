/**
 * High-level key storage helpers that delegate to VaultKeeper backends.
 *
 * @remarks
 * These functions bridge attest-it's key creation flow with VaultKeeper's
 * backend abstraction without requiring callers to import from `vaultkeeper`
 * directly.
 *
 * @packageDocumentation
 */

import * as crypto from 'node:crypto'
import { BackendRegistry, SecretNotFoundError } from 'vaultkeeper'

/**
 * Result of storing a private key via a VaultKeeper backend.
 * @public
 */
export interface StorePrivateKeyResult {
  /** The VaultKeeper secret ID assigned to this key */
  secretId: string
  /** Human-readable description of where the key was stored */
  storageDescription: string
}

/**
 * Backend type identifiers supported for private key storage.
 * @public
 */
export type PrivateKeyBackendType = 'file' | 'keychain' | '1password' | 'yubikey'

/**
 * Store a private key PEM string via a VaultKeeper backend.
 *
 * Generates a unique VaultKeeper-style secret ID and stores the key via
 * the appropriate backend. The caller receives the secret ID to record
 * in the identity config.
 *
 * @param backendType - The VaultKeeper backend to use
 * @param privateKeyPem - The private key PEM content to store
 * @param identityName - Identity name used to form a human-readable secret ID prefix
 * @returns The generated secret ID and a storage description
 * @public
 */
export async function storePrivateKey(
  backendType: PrivateKeyBackendType,
  privateKeyPem: string,
  identityName: string,
): Promise<StorePrivateKeyResult> {
  const vaultKeeperBackendType = backendType === 'file' ? 'file' : backendType

  const backend = BackendRegistry.create(vaultKeeperBackendType)
  const secretId = `attest-it-${identityName}-${crypto.randomUUID()}`
  await backend.store(secretId, privateKeyPem)

  const displayName = backend.displayName
  return {
    secretId,
    storageDescription: `${displayName}: ${secretId}`,
  }
}

/**
 * Delete a private key previously stored via {@link storePrivateKey} from its
 * VaultKeeper backend.
 *
 * @remarks
 * Idempotent: deleting a secret that no longer exists in the backend (e.g.
 * already removed by a prior cleanup) is treated as success rather than an
 * error, since the desired end state -- no secret with this id -- already
 * holds.
 *
 * @param backendType - The VaultKeeper backend the key was stored in
 * @param secretId - The VaultKeeper secret id to delete (as returned by
 * {@link storePrivateKey} / recorded on the identity's `privateKey.id`)
 * @public
 */
export async function deletePrivateKey(
  backendType: PrivateKeyBackendType,
  secretId: string,
): Promise<void> {
  const vaultKeeperBackendType = backendType === 'file' ? 'file' : backendType

  const backend = BackendRegistry.create(vaultKeeperBackendType)
  try {
    await backend.delete(secretId)
  } catch (err) {
    if (err instanceof SecretNotFoundError) {
      return
    }
    throw err
  }
}
