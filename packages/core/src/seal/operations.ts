/**
 * Seal operations for creating, verifying, and managing seals.
 * @packageDocumentation
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import { z } from 'zod'

import * as ed25519 from '../crypto/ed25519.js'
import type { AttestItConfig } from '../types.js'
import type { Seal, SealsFile } from './types.js'

/**
 * Zod schema for a single seal.
 * @internal
 */
const sealSchema = z.object({
  gateId: z.string().min(1, 'Gate ID cannot be empty'),
  // Fingerprint format: sha256:<hex> where hex is at least 1 character
  // Full fingerprints are 64 hex chars, but tests may use shorter values
  fingerprint: z
    .string()
    .regex(/^sha256:[a-f0-9]+$/i, 'Invalid fingerprint format (expected sha256:<hex>)'),
  timestamp: z.string().datetime({ message: 'Invalid ISO 8601 timestamp' }),
  sealedBy: z.string().min(1, 'Signer slug cannot be empty'),
  signature: z.string().min(1, 'Signature cannot be empty'),
})

/**
 * Zod schema for the seals file.
 * @internal
 */
const sealsFileSchema = z.object({
  version: z.literal(1, { errorMap: () => ({ message: 'Unsupported seals file version' }) }),
  seals: z.record(z.string(), sealSchema),
})

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
  const { gateId, fingerprint, sealedBy, privateKey } = options

  // Create ISO 8601 timestamp
  const timestamp = new Date().toISOString()

  // Create canonical string to sign
  const canonicalString = `${gateId}:${fingerprint}:${timestamp}`

  // Sign the canonical string
  const signature = ed25519.sign(canonicalString, privateKey)

  return {
    gateId,
    fingerprint,
    timestamp,
    sealedBy,
    signature,
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
 * Parse and validate seals file content.
 *
 * @param content - JSON content to parse
 * @returns Validated SealsFile
 * @throws Error if validation fails
 * @internal
 */
function parseSealsContent(content: string): SealsFile {
  let rawData: unknown
  try {
    rawData = JSON.parse(content)
  } catch (error) {
    throw new Error(`Invalid JSON: ${error instanceof Error ? error.message : String(error)}`)
  }

  const result = sealsFileSchema.safeParse(rawData)
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n')
    throw new Error(`Invalid seals file:\n${issues}`)
  }

  return result.data
}

/**
 * Read seals from the seals.json file (async).
 *
 * @param dir - Directory containing .attest-it/seals.json
 * @param sealsPathOverride - Optional explicit path to seals file (from config.settings.sealsPath)
 * @returns The seals file contents, or an empty seals file if the file doesn't exist
 * @throws Error if file exists but cannot be read or parsed
 * @public
 */
export async function readSeals(dir: string, sealsPathOverride?: string): Promise<SealsFile> {
  const sealsPath = sealsPathOverride
    ? path.resolve(dir, sealsPathOverride)
    : path.join(dir, '.attest-it', 'seals.json')

  try {
    const content = await fs.promises.readFile(sealsPath, 'utf8')
    return parseSealsContent(content)
  } catch (error) {
    // If file doesn't exist, return empty seals file
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return {
        version: 1,
        seals: {},
      }
    }

    // Re-throw other errors (permission denied, parse errors, etc.)
    throw new Error(
      `Failed to read seals file: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

/**
 * Read seals from the seals.json file (sync).
 *
 * @param dir - Directory containing .attest-it/seals.json
 * @param sealsPathOverride - Optional explicit path to seals file (from config.settings.sealsPath)
 * @returns The seals file contents, or an empty seals file if the file doesn't exist
 * @throws Error if file exists but cannot be read or parsed
 * @public
 */
export function readSealsSync(dir: string, sealsPathOverride?: string): SealsFile {
  const sealsPath = sealsPathOverride
    ? path.resolve(dir, sealsPathOverride)
    : path.join(dir, '.attest-it', 'seals.json')

  try {
    const content = fs.readFileSync(sealsPath, 'utf8')
    return parseSealsContent(content)
  } catch (error) {
    // If file doesn't exist, return empty seals file
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return {
        version: 1,
        seals: {},
      }
    }

    // Re-throw other errors (permission denied, parse errors, etc.)
    throw new Error(
      `Failed to read seals file: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

/**
 * Write seals to the seals.json file (async).
 *
 * @param dir - Directory containing .attest-it/seals.json
 * @param sealsFile - The seals file to write
 * @param sealsPathOverride - Optional explicit path to seals file (from config.settings.sealsPath)
 * @throws Error if file cannot be written
 * @public
 */
export async function writeSeals(dir: string, sealsFile: SealsFile, sealsPathOverride?: string): Promise<void> {
  const sealsPath = sealsPathOverride
    ? path.resolve(dir, sealsPathOverride)
    : path.join(dir, '.attest-it', 'seals.json')
  const sealsDir = path.dirname(sealsPath)

  try {
    // Ensure seals directory exists
    await fs.promises.mkdir(sealsDir, { recursive: true })

    // Write seals file with pretty formatting
    const content = JSON.stringify(sealsFile, null, 2) + '\n'
    await fs.promises.writeFile(sealsPath, content, 'utf8')
  } catch (error) {
    throw new Error(
      `Failed to write seals file: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

/**
 * Write seals to the seals.json file (sync).
 *
 * @param dir - Directory containing .attest-it/seals.json
 * @param sealsFile - The seals file to write
 * @param sealsPathOverride - Optional explicit path to seals file (from config.settings.sealsPath)
 * @throws Error if file cannot be written
 * @public
 */
export function writeSealsSync(dir: string, sealsFile: SealsFile, sealsPathOverride?: string): void {
  const sealsPath = sealsPathOverride
    ? path.resolve(dir, sealsPathOverride)
    : path.join(dir, '.attest-it', 'seals.json')
  const sealsDir = path.dirname(sealsPath)

  try {
    // Ensure seals directory exists
    fs.mkdirSync(sealsDir, { recursive: true })

    // Write seals file with pretty formatting
    const content = JSON.stringify(sealsFile, null, 2) + '\n'
    fs.writeFileSync(sealsPath, content, 'utf8')
  } catch (error) {
    throw new Error(
      `Failed to write seals file: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}
