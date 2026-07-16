/**
 * Ed25519 cryptographic operations using Node.js native crypto module.
 *
 * @remarks
 * This module provides Ed25519 digital signature operations using Node.js
 * native crypto support (available in Node 18+). Ed25519 offers better security
 * and performance than RSA-2048 with much smaller key and signature sizes.
 *
 * @packageDocumentation
 */

import * as crypto from 'node:crypto'

/**
 * An Ed25519 keypair with base64-encoded public key and PEM-encoded private key.
 * @public
 */
export interface KeyPair {
  /** Base64-encoded public key (raw 32 bytes, ~44 characters) */
  publicKey: string
  /** PEM-encoded private key */
  privateKey: string
}

/**
 * Type guard to check if a value is a Buffer.
 * @param value - Value to check
 * @returns true if value is a Buffer
 * @internal
 */
function isBuffer(value: unknown): value is Buffer {
  return Buffer.isBuffer(value)
}

/**
 * Options for generating an Ed25519 keypair.
 * @public
 */
export interface GenerateKeyPairOptions {
  /**
   * Passphrase to encrypt the private key with (AES-256-CBC over the PKCS8
   * export). Omit, or pass an empty string, for an unencrypted private key.
   */
  passphrase?: string
}

/**
 * Generate a new Ed25519 keypair.
 *
 * @param options - Key generation options
 * @returns A keypair with base64-encoded public key and PEM-encoded private key
 * @throws Error if key generation fails
 * @public
 */
export function generateKeyPair(options: GenerateKeyPairOptions = {}): KeyPair {
  try {
    const { passphrase } = options

    // Generate Ed25519 keypair using Node.js native crypto
    // When format is 'pem', the keys are returned as strings
    const keyPair =
      passphrase !== undefined && passphrase.length > 0
        ? crypto.generateKeyPairSync('ed25519', {
            publicKeyEncoding: {
              type: 'spki',
              format: 'pem',
            },
            privateKeyEncoding: {
              type: 'pkcs8',
              format: 'pem',
              cipher: 'aes-256-cbc',
              passphrase,
            },
          })
        : crypto.generateKeyPairSync('ed25519', {
            publicKeyEncoding: {
              type: 'spki',
              format: 'pem',
            },
            privateKeyEncoding: {
              type: 'pkcs8',
              format: 'pem',
            },
          })

    const { publicKey, privateKey } = keyPair
    if (typeof publicKey !== 'string' || typeof privateKey !== 'string') {
      throw new Error('Expected keypair to have string keys')
    }

    // Extract raw public key bytes and encode as base64
    const publicKeyObj = crypto.createPublicKey(publicKey)
    const publicKeyExport = publicKeyObj.export({
      type: 'spki',
      format: 'der',
    })

    if (!isBuffer(publicKeyExport)) {
      throw new Error('Expected public key export to be a Buffer')
    }

    // Ed25519 SPKI format: 12-byte header + 32-byte key
    // We extract just the 32-byte raw key for compact storage
    const rawPublicKey = publicKeyExport.subarray(12)
    const publicKeyBase64 = rawPublicKey.toString('base64')

    return {
      publicKey: publicKeyBase64,
      privateKey,
    }
  } catch (err) {
    throw new Error(
      `Failed to generate Ed25519 keypair: ${err instanceof Error ? err.message : String(err)}`,
    )
  }
}

/**
 * Sign data with an Ed25519 private key.
 *
 * @param data - Data to sign (Buffer or UTF-8 string)
 * @param privateKeyPem - PEM-encoded private key
 * @param passphrase - Passphrase to decrypt the private key, if it is encrypted
 * @returns Base64-encoded signature
 * @throws Error if signing fails
 * @public
 */
export function sign(data: Buffer | string, privateKeyPem: string, passphrase?: string): string {
  try {
    // Convert string data to Buffer
    const dataBuffer = typeof data === 'string' ? Buffer.from(data, 'utf8') : data

    // Create private key object (supplying a passphrase only when the key is encrypted)
    const privateKeyObj =
      passphrase !== undefined && passphrase.length > 0
        ? crypto.createPrivateKey({ key: privateKeyPem, format: 'pem', passphrase })
        : crypto.createPrivateKey(privateKeyPem)

    // Sign the data (null algorithm parameter for Ed25519)
    const signatureResult = crypto.sign(null, dataBuffer, privateKeyObj)

    if (!isBuffer(signatureResult)) {
      throw new Error('Expected signature to be a Buffer')
    }

    return signatureResult.toString('base64')
  } catch (err) {
    throw new Error(
      `Failed to sign data with Ed25519: ${err instanceof Error ? err.message : String(err)}`,
    )
  }
}

/**
 * Verify an Ed25519 signature.
 *
 * @param data - Original data that was signed
 * @param signature - Base64-encoded signature to verify
 * @param publicKeyBase64 - Base64-encoded public key (raw 32 bytes)
 * @returns true if signature is valid, false otherwise
 * @throws Error if verification fails (not just invalid signature)
 * @public
 */
export function verify(data: Buffer | string, signature: string, publicKeyBase64: string): boolean {
  try {
    // Convert string data to Buffer
    const dataBuffer = typeof data === 'string' ? Buffer.from(data, 'utf8') : data

    // Decode signature from base64
    const signatureBuffer = Buffer.from(signature, 'base64')

    // Reconstruct SPKI format from raw public key
    // Ed25519 SPKI: 12-byte header + 32-byte key
    const rawPublicKey = Buffer.from(publicKeyBase64, 'base64')

    if (rawPublicKey.length !== 32) {
      throw new Error(
        `Invalid Ed25519 public key length: expected 32 bytes, got ${rawPublicKey.length.toString()}`,
      )
    }

    // SPKI header for Ed25519 (algorithm OID)
    const spkiHeader = Buffer.from([
      0x30,
      0x2a, // SEQUENCE, 42 bytes
      0x30,
      0x05, // SEQUENCE, 5 bytes
      0x06,
      0x03,
      0x2b,
      0x65,
      0x70, // OID 1.3.101.112 (Ed25519)
      0x03,
      0x21,
      0x00, // BIT STRING, 33 bytes (32 key + 1 padding)
    ])

    const spkiBuffer = Buffer.concat([spkiHeader, rawPublicKey])

    // Create public key object from SPKI
    const publicKeyObj = crypto.createPublicKey({
      key: spkiBuffer,
      format: 'der',
      type: 'spki',
    })

    // Verify the signature (null algorithm parameter for Ed25519)
    return crypto.verify(null, dataBuffer, publicKeyObj, signatureBuffer)
  } catch (err) {
    // If it's a verification failure (wrong signature), return false
    // If it's any other error, throw it
    if (err instanceof Error && err.message.includes('verification failed')) {
      return false
    }
    throw new Error(
      `Failed to verify Ed25519 signature: ${err instanceof Error ? err.message : String(err)}`,
    )
  }
}

/**
 * Extract the public key from an Ed25519 private key.
 *
 * @param privateKeyPem - PEM-encoded private key
 * @returns Base64-encoded public key (raw 32 bytes)
 * @throws Error if extraction fails
 * @public
 */
export function getPublicKeyFromPrivate(privateKeyPem: string): string {
  try {
    // Create private key object
    const privateKeyObj = crypto.createPrivateKey(privateKeyPem)

    // Export the corresponding public key
    const publicKeyObj = crypto.createPublicKey(privateKeyObj)
    const publicKeyExport = publicKeyObj.export({
      type: 'spki',
      format: 'der',
    })

    if (!isBuffer(publicKeyExport)) {
      throw new Error('Expected public key export to be a Buffer')
    }

    // Extract raw 32-byte public key from SPKI format
    const rawPublicKey = publicKeyExport.subarray(12)
    return rawPublicKey.toString('base64')
  } catch (err) {
    throw new Error(
      `Failed to extract public key from Ed25519 private key: ${err instanceof Error ? err.message : String(err)}`,
    )
  }
}

/**
 * Check whether a PEM-encoded private key is passphrase-encrypted.
 *
 * @remarks
 * Detects the PKCS8 `ENCRYPTED PRIVATE KEY` PEM header produced when
 * {@link generateKeyPair} is called with a passphrase. Callers use this to
 * decide whether a passphrase must be supplied before the key can be used
 * (e.g. with {@link sign}).
 *
 * @param privateKeyPem - PEM-encoded private key content
 * @returns true if the key is encrypted, false otherwise
 * @public
 */
export function isEncryptedPrivateKeyPem(privateKeyPem: string): boolean {
  return privateKeyPem.includes('ENCRYPTED PRIVATE KEY')
}
