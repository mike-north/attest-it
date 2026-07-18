/**
 * Seal operations for creating, verifying, and managing seals.
 * @packageDocumentation
 */

import { readFile } from 'node:fs/promises'

import * as ed25519 from '../crypto/ed25519.js'
import type { AttestItConfig } from '../types.js'
import type { KeyProvider } from '../key-provider/types.js'
import type { Seal, SealsFile } from './types.js'
import {
  CURRENT_SEALS_VERSION,
  migrateMonoliths,
  migrateMonolithsSync,
  readSealsFromDir,
  readSealsFromDirSync,
  resolveSealsRoot,
  writeSealsToDir,
  writeSealsToDirSync,
} from './storage.js'

/**
 * Options for creating a seal.
 * @public
 */
export interface CreateSealOptions {
  /** Gate identifier (slug) */
  gateId: string
  /** SHA-256 fingerprint of the gate's content */
  fingerprint: string
  /** Team member slug creating the seal */
  sealedBy: string
  /** PEM-encoded Ed25519 private key for signing */
  privateKey: string
  /** Passphrase to decrypt `privateKey`, if it is passphrase-encrypted */
  passphrase?: string
}

/**
 * Result of seal signature verification.
 * @public
 */
export interface SignatureVerificationResult {
  /** Whether the seal signature is valid */
  valid: boolean
  /** Error message if verification failed */
  error?: string
}

/**
 * Create a seal by signing the canonical string: gateId:fingerprint:timestamp
 *
 * @param options - Seal creation options
 * @returns The created seal
 * @throws Error if signing fails
 * @public
 */
export function createSeal(options: CreateSealOptions): Seal {
  const { gateId, fingerprint, sealedBy, privateKey, passphrase } = options

  // Create ISO 8601 timestamp
  const timestamp = new Date().toISOString()

  // Create canonical string to sign
  const canonicalString = `${gateId}:${fingerprint}:${timestamp}`

  // Sign the canonical string
  const signature = ed25519.sign(canonicalString, privateKey, passphrase)

  return {
    gateId,
    fingerprint,
    timestamp,
    sealedBy,
    signature,
  }
}

/**
 * Signs the canonical seal string, returning a base64-encoded signature.
 * @public
 */
export type CanonicalSigner = (canonicalString: string) => Promise<string>

/**
 * Options for creating a seal from an external signer.
 * @public
 */
export interface CreateSealWithSignerOptions {
  /** Gate identifier (slug) */
  gateId: string
  /** SHA-256 fingerprint of the gate's content */
  fingerprint: string
  /** Team member slug creating the seal */
  sealedBy: string
  /** Produces the base64 signature over the canonical string. */
  sign: CanonicalSigner
}

/**
 * Create a seal whose signature is produced by an external signer over the
 * canonical string `gateId:fingerprint:timestamp`.
 *
 * @remarks
 * This is the delegated-signing counterpart to {@link createSeal}: the caller
 * supplies a {@link CanonicalSigner} (e.g. a VaultKeeper `SigningBackend`) that
 * signs without exposing the raw private key. The timestamp is generated here so
 * the signer signs the exact canonical string embedded in the seal.
 *
 * @param options - Seal creation options with an external signer
 * @returns The created seal
 * @public
 */
export async function createSealWithSigner(options: CreateSealWithSignerOptions): Promise<Seal> {
  const { gateId, fingerprint, sealedBy, sign } = options

  const timestamp = new Date().toISOString()
  const canonicalString = `${gateId}:${fingerprint}:${timestamp}`
  const signature = await sign(canonicalString)

  return {
    gateId,
    fingerprint,
    timestamp,
    sealedBy,
    signature,
  }
}

/**
 * Options for creating a seal via a {@link KeyProvider}.
 * @public
 */
export interface CreateSealWithProviderOptions {
  /** Gate identifier (slug) */
  gateId: string
  /** SHA-256 fingerprint of the gate's content */
  fingerprint: string
  /** Team member slug creating the seal */
  sealedBy: string
  /** The key provider that holds (or can delegate signing for) the private key */
  keyProvider: KeyProvider
  /** Provider-specific key reference */
  keyRef: string
  /**
   * Resolve a passphrase for the fallback path when the retrieved PEM is
   * encrypted. Only invoked on the {@link KeyProvider.getPrivateKey} fallback,
   * never for delegated signing.
   */
  resolvePassphrase?: () => Promise<string | undefined>
}

/**
 * Create a seal using a {@link KeyProvider}, preferring delegated signing.
 *
 * @remarks
 * When the provider reports that `keyRef` is delegated-signable
 * ({@link KeyProvider.supportsDelegatedSigning}), the seal is signed via
 * {@link KeyProvider.signDirectly} and the raw private key never leaves the
 * backend — no PEM is written to disk. Otherwise this falls back to
 * {@link KeyProvider.getPrivateKey} + a temporary PEM file, preserving existing
 * behavior for non-signing backends and legacy keys.
 *
 * @param options - Seal creation options
 * @returns The created seal
 * @public
 */
export async function createSealWithProvider(
  options: CreateSealWithProviderOptions,
): Promise<Seal> {
  const { gateId, fingerprint, sealedBy, keyProvider, keyRef, resolvePassphrase } = options

  if (
    keyProvider.signDirectly &&
    keyProvider.supportsDelegatedSigning &&
    (await keyProvider.supportsDelegatedSigning(keyRef))
  ) {
    const signDirectly = keyProvider.signDirectly.bind(keyProvider)
    return createSealWithSigner({
      gateId,
      fingerprint,
      sealedBy,
      sign: (canonicalString) => signDirectly(keyRef, canonicalString),
    })
  }

  const keyResult = await keyProvider.getPrivateKey(keyRef)
  try {
    const privateKey = await readFile(keyResult.keyPath, 'utf8')
    const passphrase = ed25519.isEncryptedPrivateKeyPem(privateKey)
      ? await resolvePassphrase?.()
      : undefined
    return createSeal({
      gateId,
      fingerprint,
      sealedBy,
      privateKey,
      ...(passphrase !== undefined && { passphrase }),
    })
  } finally {
    await keyResult.cleanup()
  }
}

/**
 * Verify a seal's signature against the team member's public key.
 *
 * @param seal - The seal to verify
 * @param config - The attest-it configuration containing team members
 * @returns Verification result with success status and optional error message
 * @public
 */
export function verifySeal(seal: Seal, config: AttestItConfig): SignatureVerificationResult {
  const { gateId, fingerprint, timestamp, sealedBy, signature } = seal

  // Look up team member by slug
  if (!config.team) {
    return {
      valid: false,
      error: `No team configuration found`,
    }
  }

  // eslint-disable-next-line security/detect-object-injection
  const teamMember = config.team[sealedBy]
  if (!teamMember) {
    return {
      valid: false,
      error: `Team member '${sealedBy}' not found in configuration`,
    }
  }

  // Reconstruct canonical string
  const canonicalString = `${gateId}:${fingerprint}:${timestamp}`

  // Verify signature
  try {
    const isValid = ed25519.verify(canonicalString, signature, teamMember.publicKey)
    if (!isValid) {
      return {
        valid: false,
        error: 'Signature verification failed',
      }
    }

    return { valid: true }
  } catch (error) {
    return {
      valid: false,
      error: `Signature verification error: ${error instanceof Error ? error.message : String(error)}`,
    }
  }
}

/**
 * Read all seals from the file-per-seal storage layout (async).
 *
 * @remarks
 * Seals live one file per (gate, signer) under the seals storage directory
 * (default `.attest-it/seals/`). `sealsPathOverride` is the configured
 * `sealsPath` setting; a legacy value still pointing at a monolithic
 * `seals.json`/`seals.yaml` is normalized to its sibling directory
 * ({@link resolveSealsRoot}). If a legacy monolithic file is present it is
 * migrated to the per-seal layout — and then deleted — before reading, so no
 * monolithic read path remains in steady state.
 *
 * @param dir - Repository root.
 * @param sealsPathOverride - The `config.settings.sealsPath` value, if any.
 * @returns The aggregate seals, or an empty aggregate if none exist.
 * @throws Error if a seal file exists but cannot be read or parsed.
 * @public
 */
export async function readSeals(dir: string, sealsPathOverride?: string): Promise<SealsFile> {
  const root = resolveSealsRoot(dir, sealsPathOverride)
  await migrateMonoliths(dir, root)
  return readSealsFromDir(root)
}

/**
 * Read all seals from the file-per-seal storage layout (sync).
 *
 * See {@link readSeals} for behavior, including one-time migration of a legacy
 * monolithic file.
 *
 * @param dir - Repository root.
 * @param sealsPathOverride - The `config.settings.sealsPath` value, if any.
 * @returns The aggregate seals, or an empty aggregate if none exist.
 * @throws Error if a seal file exists but cannot be read or parsed.
 * @public
 */
export function readSealsSync(dir: string, sealsPathOverride?: string): SealsFile {
  const root = resolveSealsRoot(dir, sealsPathOverride)
  migrateMonolithsSync(dir, root)
  return readSealsFromDirSync(root)
}

/**
 * Persist all seals to the file-per-seal storage layout (async).
 *
 * @remarks
 * Writes one file per gate at its current signer's deterministic path, touching
 * only files whose content changed so unrelated seals stay byte-identical across
 * branches (conflict-free parallel PRs). Gates removed from the aggregate are
 * deleted from disk.
 *
 * @param dir - Repository root.
 * @param sealsFile - The aggregate seals to persist.
 * @param sealsPathOverride - The `config.settings.sealsPath` value, if any.
 * @throws Error if a seal file cannot be written.
 * @public
 */
export async function writeSeals(
  dir: string,
  sealsFile: SealsFile,
  sealsPathOverride?: string,
): Promise<void> {
  const root = resolveSealsRoot(dir, sealsPathOverride)
  try {
    await writeSealsToDir(root, sealsFile)
  } catch (error) {
    throw new Error(
      `Failed to write seals file: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

/**
 * Persist all seals to the file-per-seal storage layout (sync).
 *
 * See {@link writeSeals} for behavior.
 *
 * @param dir - Repository root.
 * @param sealsFile - The aggregate seals to persist.
 * @param sealsPathOverride - The `config.settings.sealsPath` value, if any.
 * @throws Error if a seal file cannot be written.
 * @public
 */
export function writeSealsSync(
  dir: string,
  sealsFile: SealsFile,
  sealsPathOverride?: string,
): void {
  const root = resolveSealsRoot(dir, sealsPathOverride)
  try {
    writeSealsToDirSync(root, sealsFile)
  } catch (error) {
    throw new Error(
      `Failed to write seals file: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

// Re-export for callers that want the current aggregate version marker.
export { CURRENT_SEALS_VERSION }
