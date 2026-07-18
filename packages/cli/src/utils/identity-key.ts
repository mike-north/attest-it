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

import { readFile } from 'node:fs/promises'
import { KeyProviderRegistry, isEncryptedPrivateKeyPem, type Identity } from '@attest-it/core'
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
 * The material needed to sign with an identity: the PEM private key and, when it
 * is passphrase-encrypted, the resolved passphrase.
 */
export interface IdentitySigningKey {
  /** PEM-encoded private key. */
  privateKeyPem: string
  /** Passphrase for the key, if it is encrypted. */
  passphrase?: string
}

/**
 * Load the PEM private key behind an identity through its key-provider backend
 * and resolve a passphrase if the key is encrypted.
 *
 * @param identity - The active identity to sign with.
 * @returns The signing key material.
 */
export async function loadIdentitySigningKey(identity: Identity): Promise<IdentitySigningKey> {
  const keyProvider = createKeyProviderFromIdentity(identity)
  const keyRef = getKeyRefFromIdentity(identity)

  const keyResult = await keyProvider.getPrivateKey(keyRef)
  let privateKeyPem: string
  try {
    privateKeyPem = await readFile(keyResult.keyPath, 'utf8')
  } finally {
    await keyResult.cleanup()
  }

  if (isEncryptedPrivateKeyPem(privateKeyPem)) {
    const passphrase = await resolveKeyPassphrase()
    return { privateKeyPem, passphrase }
  }
  return { privateKeyPem }
}
