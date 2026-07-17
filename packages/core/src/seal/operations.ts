/**
 * Seal operations for creating, verifying, and managing seals.
 * @packageDocumentation
 */

import * as fs from 'node:fs'
import * as path from 'node:path'

import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import * as ed25519 from '../crypto/ed25519.js'
import type { AttestItConfig } from '../types.js'
import type { Seal, SealsFile } from './types.js'
import { sealsFileSchemaV1 } from '../config/migrations/index.js'

/**
 * Check if an error is a Node.js file not found error.
 * @internal
 */
function isFileNotFoundError(error: unknown): boolean {
  if (error && typeof error === 'object' && 'code' in error) {
    const errorWithCode: { code: unknown } = error
    return errorWithCode.code === 'ENOENT' || errorWithCode.code === 'ENOTDIR'
  }
  return false
}

/**
 * Schema reference header for seals.yaml files.
 * This enables editor support (autocomplete, validation) in YAML-aware editors.
 * @internal
 */
const SEALS_SCHEMA_HEADER =
  '# yaml-language-server: $schema=https://raw.githubusercontent.com/mike-north/attest-it/main/schemas/v1/seals.schema.json\n'

/**
 * Schema URL for seals.json files (legacy format).
 * @internal
 */
const SEALS_SCHEMA_URL =
  'https://raw.githubusercontent.com/mike-north/attest-it/main/schemas/v1/seals.schema.json'

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
 * Build a fresh, empty seals file for when no seals file exists.
 *
 * Returns a new object on every call: callers routinely mutate the result
 * (e.g. `seals.seals[gateId] = ...`), so a shared constant would alias mutable
 * state across otherwise-independent reads.
 * @internal
 */
function createEmptySealsFile(): SealsFile {
  return {
    version: 1,
    seals: {},
  }
}

/**
 * Detect file format from extension.
 * @internal
 */
function detectFormat(filepath: string): 'yaml' | 'json' {
  const ext = filepath.split('.').pop()?.toLowerCase()
  if (ext === 'json') return 'json'
  return 'yaml'
}

/**
 * Parse seals file content based on format.
 * @internal
 */
function parseSealsContent(content: string, format: 'yaml' | 'json'): SealsFile {
  let data: unknown
  try {
    data = format === 'yaml' ? parseYaml(content) : JSON.parse(content)
  } catch (error) {
    if (
      error instanceof SyntaxError ||
      (error instanceof Error && error.name === 'YAMLParseError')
    ) {
      throw new Error(`Failed to read seals file: Invalid ${format.toUpperCase()}`)
    }
    throw error
  }

  // Check for unsupported version before schema validation
  if (typeof data === 'object' && data !== null && 'version' in data) {
    const dataObj: { version: unknown } = data
    const version = dataObj.version
    if (version !== 1 && version !== '1') {
      throw new Error(`Unsupported seals file version: ${String(version)}`)
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
}

/**
 * Read seals from the seals file (async).
 *
 * Supports both YAML (.yaml) and JSON (.json) formats.
 * When no override path is provided, prefers seals.yaml over seals.json.
 *
 * Uses Zod schema from the migration graph for validation.
 *
 * @param dir - Directory containing .attest-it/seals.yaml or seals.json
 * @param sealsPathOverride - Optional explicit path to seals file (from config.settings.sealsPath)
 * @returns The seals file contents, or an empty seals file if the file doesn't exist
 * @throws Error if file exists but cannot be read or parsed
 * @public
 */
export async function readSeals(dir: string, sealsPathOverride?: string): Promise<SealsFile> {
  // If override path is provided, use it directly
  if (sealsPathOverride) {
    const sealsPath = path.resolve(dir, sealsPathOverride)
    let content: string
    try {
      content = await fs.promises.readFile(sealsPath, 'utf8')
    } catch (error) {
      if (isFileNotFoundError(error)) {
        return createEmptySealsFile()
      }
      throw new Error(
        `Failed to read seals file: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
    return parseSealsContent(content, detectFormat(sealsPath))
  }

  // Try seals.yaml first (preferred), then fall back to seals.json (legacy)
  const yamlPath = path.join(dir, '.attest-it', 'seals.yaml')
  const jsonPath = path.join(dir, '.attest-it', 'seals.json')

  // Try YAML first
  try {
    const content = await fs.promises.readFile(yamlPath, 'utf8')
    return parseSealsContent(content, 'yaml')
  } catch (error) {
    if (!isFileNotFoundError(error)) {
      throw new Error(
        `Failed to read seals file: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  // Fall back to JSON
  try {
    const content = await fs.promises.readFile(jsonPath, 'utf8')
    return parseSealsContent(content, 'json')
  } catch (error) {
    if (isFileNotFoundError(error)) {
      return createEmptySealsFile()
    }
    throw new Error(
      `Failed to read seals file: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

/**
 * Read seals from the seals file (sync).
 *
 * Supports both YAML (.yaml) and JSON (.json) formats.
 * When no override path is provided, prefers seals.yaml over seals.json.
 *
 * Uses Zod schema from the migration graph for validation.
 *
 * @param dir - Directory containing .attest-it/seals.yaml or seals.json
 * @param sealsPathOverride - Optional explicit path to seals file (from config.settings.sealsPath)
 * @returns The seals file contents, or an empty seals file if the file doesn't exist
 * @throws Error if file exists but cannot be read or parsed
 * @public
 */
export function readSealsSync(dir: string, sealsPathOverride?: string): SealsFile {
  // If override path is provided, use it directly
  if (sealsPathOverride) {
    const sealsPath = path.resolve(dir, sealsPathOverride)
    let content: string
    try {
      content = fs.readFileSync(sealsPath, 'utf8')
    } catch (error) {
      if (isFileNotFoundError(error)) {
        return createEmptySealsFile()
      }
      throw new Error(
        `Failed to read seals file: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
    return parseSealsContent(content, detectFormat(sealsPath))
  }

  // Try seals.yaml first (preferred), then fall back to seals.json (legacy)
  const yamlPath = path.join(dir, '.attest-it', 'seals.yaml')
  const jsonPath = path.join(dir, '.attest-it', 'seals.json')

  // Try YAML first
  try {
    const content = fs.readFileSync(yamlPath, 'utf8')
    return parseSealsContent(content, 'yaml')
  } catch (error) {
    if (!isFileNotFoundError(error)) {
      throw new Error(
        `Failed to read seals file: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  // Fall back to JSON
  try {
    const content = fs.readFileSync(jsonPath, 'utf8')
    return parseSealsContent(content, 'json')
  } catch (error) {
    if (isFileNotFoundError(error)) {
      return createEmptySealsFile()
    }
    throw new Error(
      `Failed to read seals file: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

/**
 * Serialize seals file content based on format.
 * @internal
 */
function serializeSealsContent(data: SealsFile, format: 'yaml' | 'json'): string {
  if (format === 'json') {
    // JSON with $schema for editor support
    const dataWithSchema = { $schema: SEALS_SCHEMA_URL, ...data }
    return JSON.stringify(dataWithSchema, null, 2) + '\n'
  }
  // YAML with schema header for editor support
  return SEALS_SCHEMA_HEADER + stringifyYaml(data)
}

/**
 * Write seals to the seals file (async).
 *
 * Defaults to YAML format (seals.yaml). When a custom path is provided,
 * the format is inferred from the file extension (.json = JSON, otherwise YAML).
 *
 * Uses Zod schema from the migration graph for validation before writing.
 *
 * @param dir - Directory containing .attest-it/seals.yaml
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
    : path.join(dir, '.attest-it', 'seals.yaml')
  const sealsDir = path.dirname(sealsPath)
  const format = detectFormat(sealsPath)

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

    // Serialize based on format
    const content = serializeSealsContent(validationResult.data, format)
    await fs.promises.writeFile(sealsPath, content, 'utf8')
  } catch (error) {
    throw new Error(
      `Failed to write seals file: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

/**
 * Write seals to the seals file (sync).
 *
 * Defaults to YAML format (seals.yaml). When a custom path is provided,
 * the format is inferred from the file extension (.json = JSON, otherwise YAML).
 *
 * Uses Zod schema from the migration graph for validation before writing.
 *
 * @param dir - Directory containing .attest-it/seals.yaml
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
    : path.join(dir, '.attest-it', 'seals.yaml')
  const sealsDir = path.dirname(sealsPath)
  const format = detectFormat(sealsPath)

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

    // Serialize based on format
    const content = serializeSealsContent(validationResult.data, format)
    fs.writeFileSync(sealsPath, content, 'utf8')
  } catch (error) {
    throw new Error(
      `Failed to write seals file: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}
