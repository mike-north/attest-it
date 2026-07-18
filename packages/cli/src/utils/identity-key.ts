/**
 * Shared helpers for materializing an identity's private key for signing.
 *
 * The `seal`, `run`, and `init` (bootstrap ceremony) commands all need to load
 * the PEM-encoded private key behind the active identity through its configured
 * key-provider backend, and resolve a passphrase when the key is encrypted. This
 * module centralizes that logic so there is a single, audited signing key path.
 *
 * @module
 */

import {
  KeyProviderRegistry,
  createRootSealWithProvider,
  type Identity,
  type Seal,
} from '@attest-it/core'
import { resolveKeyPassphrase } from './passphrase.js'

/**
 * Create a key provider for an identity's private key reference.
 */
function createKeyProviderFromIdentity(
  identity: Identity,
): ReturnType<typeof KeyProviderRegistry.create> {
  const { privateKey } = identity

  switch (privateKey.type) {
    case 'file':
      return KeyProviderRegistry.create({ type: 'filesystem', options: {} })
    case 'keychain':
      return KeyProviderRegistry.create({ type: 'macos-keychain', options: {} })
    case '1password':
      return KeyProviderRegistry.create({ type: '1password', options: {} })
    case 'yubikey':
      return KeyProviderRegistry.create({ type: 'yubikey', options: {} })
    case 'filesystem':
      return KeyProviderRegistry.create({ type: 'filesystem-legacy', options: {} })
    default: {
      const _exhaustiveCheck: never = privateKey
      throw new Error(`Unsupported private key type: ${String(_exhaustiveCheck)}`)
    }
  }
}

/**
 * Get the key reference string from an identity's private key reference.
 *
 * For v2 VaultKeeper-backed types the reference is the secret id; for the legacy
 * filesystem type it is the file path.
 */
function getKeyRefFromIdentity(identity: Identity): string {
  const { privateKey } = identity

  switch (privateKey.type) {
    case 'file':
    case 'keychain':
    case '1password':
    case 'yubikey':
      return privateKey.id
    case 'filesystem':
      return privateKey.path
    default: {
      const _exhaustiveCheck: never = privateKey
      throw new Error(`Unsupported private key type: ${String(_exhaustiveCheck)}`)
    }
  }
}

/**
 * Create the root-gate seal over the policy file for an identity, through its
 * key-provider backend.
 *
 * @remarks
 * Prefers delegated signing (the raw key never leaves the backend) and falls
 * back to the temp-file PEM path for non-signing backends, resolving a
 * passphrase when the key is encrypted. This is the single audited signing path
 * shared by `seal --root` and `init`'s bootstrap ceremony.
 *
 * @param identity - The active identity to sign with.
 * @param policyFingerprint - Fingerprint of the policy file being anchored.
 * @param sealedBy - Team member slug creating the root seal.
 * @returns The created root seal.
 */
export async function createRootSealForIdentity(
  identity: Identity,
  policyFingerprint: string,
  sealedBy: string,
): Promise<Seal> {
  const keyProvider = createKeyProviderFromIdentity(identity)
  const keyRef = getKeyRefFromIdentity(identity)

  return createRootSealWithProvider({
    policyFingerprint,
    sealedBy,
    keyProvider,
    keyRef,
    resolvePassphrase: resolveKeyPassphrase,
  })
}
