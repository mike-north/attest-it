/**
 * Seal operations for creating, verifying, and managing seals.
 * @packageDocumentation
 */

import * as fs from 'node:fs'
import * as path from 'node:path'

import * as ed25519 from '../crypto/ed25519.js'
import type { AttestItConfig } from '../types.js'
import type { Seal, SealsFile } from './types.js'
import { sealsFileSchemaV1 } from '../config/migrations/index.js'

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
 * Default empty seals file for when no seals file exists.
 * @internal
 */
const EMPTY_SEALS_FILE: SealsFile = {
  version: 1,
  seals: {},
}

/**
 * Read seals from the seals.json file (async).
 *
 * Uses Zod schema from the migration graph for validation.
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

  let content: string
  try {
    content = await fs.promises.readFile(sealsPath, 'utf8')
  } catch (error) {
    const cause = error as NodeJS.ErrnoException
    if (cause?.code === 'ENOENT' || cause?.code === 'ENOTDIR') {
      return EMPTY_SEALS_FILE
    }
    throw new Error(
      `Failed to read seals file: ${error instanceof Error ? error.message : String(error)}`,
    )
  }

  try {
    const data = JSON.parse(content) as unknown

    // Check for unsupported version before schema validation
    if (typeof data === 'object' && data !== null && 'version' in data) {
      const version = (data as { version: unknown }).version
      if (version !== 1 && version !== '1') {
        throw new Error(`Unsupported seals file version: ${version}`)
      }
    }

    // Validate against schema (accepts both numeric and string versions)
    const result = sealsFileSchemaV1.safeParse(data)
    if (!result.success) {
      const errors = result.error.issues
        .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
        .join(', ')
      throw new Error(`Failed to read seals file: Validation failed: ${errors}`)
    }

    return result.data
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`Failed to read seals file: Invalid JSON`)
    }
    throw error instanceof Error ? error : new Error(String(error))
  }
}

/**
 * Read seals from the seals.json file (sync).
 *
 * Uses Zod schema from the migration graph for validation.
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

  let content: string
  try {
    content = fs.readFileSync(sealsPath, 'utf8')
  } catch (error) {
    const cause = error as NodeJS.ErrnoException
    if (cause?.code === 'ENOENT' || cause?.code === 'ENOTDIR') {
      return EMPTY_SEALS_FILE
    }
    throw new Error(
      `Failed to read seals file: ${error instanceof Error ? error.message : String(error)}`,
    )
  }

  try {
    const data = JSON.parse(content) as unknown

    // Check for unsupported version before schema validation
    if (typeof data === 'object' && data !== null && 'version' in data) {
      const version = (data as { version: unknown }).version
      if (version !== 1 && version !== '1') {
        throw new Error(`Unsupported seals file version: ${version}`)
      }
    }

    // Validate against schema (accepts both numeric and string versions)
    const result = sealsFileSchemaV1.safeParse(data)
    if (!result.success) {
      const errors = result.error.issues
        .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
        .join(', ')
      throw new Error(`Failed to read seals file: Validation failed: ${errors}`)
    }

    return result.data
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`Failed to read seals file: Invalid JSON`)
    }
    throw error instanceof Error ? error : new Error(String(error))
  }
}

/**
 * Write seals to the seals.json file (async).
 *
 * Uses Zod schema from the migration graph for validation before writing.
 *
 * @param dir - Directory containing .attest-it/seals.json
 * @param sealsFile - The seals file to write
 * @param sealsPathOverride - Optional explicit path to seals file (from config.settings.sealsPath)
 * @throws Error if file cannot be written or validation fails
 * @public
 */
export async function writeSeals(
  dir: string,
  sealsFile: SealsFile,
  sealsPathOverride?: string,
): Promise<void> {
  const sealsPath = sealsPathOverride
    ? path.resolve(dir, sealsPathOverride)
    : path.join(dir, '.attest-it', 'seals.json')
  const sealsDir = path.dirname(sealsPath)

  // Validate against the schema
  const validationResult = sealsFileSchemaV1.safeParse(sealsFile)
  if (!validationResult.success) {
    const errors = validationResult.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join(', ')
    throw new Error(`Failed to write seals file: Validation failed: ${errors}`)
  }

  try {
    // Ensure seals directory exists
    await fs.promises.mkdir(sealsDir, { recursive: true })

    // Serialize and write with trailing newline
    const content = JSON.stringify(validationResult.data, null, 2) + '\n'
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
 * Uses Zod schema from the migration graph for validation before writing.
 *
 * @param dir - Directory containing .attest-it/seals.json
 * @param sealsFile - The seals file to write
 * @param sealsPathOverride - Optional explicit path to seals file (from config.settings.sealsPath)
 * @throws Error if file cannot be written or validation fails
 * @public
 */
export function writeSealsSync(
  dir: string,
  sealsFile: SealsFile,
  sealsPathOverride?: string,
): void {
  const sealsPath = sealsPathOverride
    ? path.resolve(dir, sealsPathOverride)
    : path.join(dir, '.attest-it', 'seals.json')
  const sealsDir = path.dirname(sealsPath)

  // Validate against the schema
  const validationResult = sealsFileSchemaV1.safeParse(sealsFile)
  if (!validationResult.success) {
    const errors = validationResult.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join(', ')
    throw new Error(`Failed to write seals file: Validation failed: ${errors}`)
  }

  try {
    // Ensure seals directory exists
    fs.mkdirSync(sealsDir, { recursive: true })

    // Serialize and write with trailing newline
    const content = JSON.stringify(validationResult.data, null, 2) + '\n'
    fs.writeFileSync(sealsPath, content, 'utf8')
  } catch (error) {
    throw new Error(
      `Failed to write seals file: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}
