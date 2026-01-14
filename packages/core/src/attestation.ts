/**
 * Attestation file I/O module with JSON canonicalization.
 */

import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import * as canonicalizeNamespace from 'canonicalize'
import { z } from 'zod'
import type { Attestation, AttestationsFile } from './types.js'

/**
 * Extract the serialize function from the canonicalize CommonJS module.
 *
 * Context: The canonicalize package uses `module.exports = function(...)`, which is
 * a CommonJS pattern. With `esModuleInterop: false` (required for library code to
 * avoid leaking tsconfig options to consumers), TypeScript treats the namespace import
 * as the module object itself, not as an object with a default export.
 *
 * The package's type definitions declare `export default function serialize(...)`,
 * which TypeScript interprets as `{ default: function }` when esModuleInterop is off.
 * However, at runtime with NodeNext module resolution, the actual value is just the
 * function itself.
 *
 * This type assertion is safe because:
 * 1. We verified the runtime export structure of the canonicalize module
 * 2. The type matches the published @types signature
 * 3. This is the standard pattern for importing CommonJS modules in strict ESM
 */
// eslint-disable-next-line @typescript-eslint/consistent-type-assertions
const canonicalize = canonicalizeNamespace as unknown as {
  default: (input: unknown) => string | undefined
}
const serialize = canonicalize.default

// Zod schema for attestation validation
const attestationSchema = z.object({
  suite: z.string().min(1),
  fingerprint: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  attestedAt: z.string().datetime(),
  attestedBy: z.string().min(1),
  command: z.string().min(1),
  exitCode: z.literal(0),
})

const attestationsFileSchema = z.object({
  schemaVersion: z.literal('1'),
  attestations: z.array(attestationSchema),
  signature: z.string(), // Will be validated by crypto module
})

/**
 * Type guard to check if an error is a Node.js file system error with code.
 * We need to disable the type assertion rule here because TypeScript doesn't
 * provide a way to narrow an object type after checking for a property without
 * using type assertions or indexed access. This is a safe assertion because we
 * check for the property existence and type before using it.
 */
function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  if (error === null || typeof error !== 'object') {
    return false
  }
  if (!('code' in error)) {
    return false
  }
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
  const errorObj = error as Record<string, unknown>
  return typeof errorObj.code === 'string'
}

/**
 * Read attestations file from disk (async).
 *
 * @param filePath - Absolute path to the attestations JSON file
 * @returns Parsed attestations file, or null if the file doesn't exist
 * @throws Error on parse or validation errors
 * @public
 */
export async function readAttestations(filePath: string): Promise<AttestationsFile | null> {
  try {
    const content = await fs.promises.readFile(filePath, 'utf-8')
    const parsed: unknown = JSON.parse(content)
    // Zod validates and returns the correct type
    return attestationsFileSchema.parse(parsed)
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return null
    }
    throw error
  }
}

/**
 * Read attestations file from disk (sync).
 *
 * @param filePath - Absolute path to the attestations JSON file
 * @returns Parsed attestations file, or null if the file doesn't exist
 * @throws Error on parse or validation errors
 * @public
 */
export function readAttestationsSync(filePath: string): AttestationsFile | null {
  try {
    const content = fs.readFileSync(filePath, 'utf-8')
    const parsed: unknown = JSON.parse(content)
    // Zod validates and returns the correct type
    return attestationsFileSchema.parse(parsed)
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return null
    }
    throw error
  }
}

/**
 * Write attestations file to disk (async).
 *
 * Creates parent directories if needed. The signature should be computed
 * separately and passed in.
 *
 * @param filePath - Absolute path to write the attestations file
 * @param attestations - Array of attestation entries
 * @param signature - Cryptographic signature of the attestations
 * @throws Error on validation or write errors
 * @public
 */
export async function writeAttestations(
  filePath: string,
  attestations: Attestation[],
  signature: string,
): Promise<void> {
  const fileContent: AttestationsFile = {
    schemaVersion: '1',
    attestations,
    signature,
  }

  // Validate before writing
  attestationsFileSchema.parse(fileContent)

  // Create parent directories if needed
  const dir = path.dirname(filePath)
  await fs.promises.mkdir(dir, { recursive: true })

  // Write with pretty formatting for readability
  const json = JSON.stringify(fileContent, null, 2)
  await fs.promises.writeFile(filePath, json, 'utf-8')
}

/**
 * Write attestations file to disk (sync).
 *
 * Creates parent directories if needed. The signature should be computed
 * separately and passed in.
 *
 * @param filePath - Absolute path to write the attestations file
 * @param attestations - Array of attestation entries
 * @param signature - Cryptographic signature of the attestations
 * @throws Error on validation or write errors
 * @public
 */
export function writeAttestationsSync(
  filePath: string,
  attestations: Attestation[],
  signature: string,
): void {
  const fileContent: AttestationsFile = {
    schemaVersion: '1',
    attestations,
    signature,
  }

  // Validate before writing
  attestationsFileSchema.parse(fileContent)

  // Create parent directories if needed
  const dir = path.dirname(filePath)
  fs.mkdirSync(dir, { recursive: true })

  // Write with pretty formatting for readability
  const json = JSON.stringify(fileContent, null, 2)
  fs.writeFileSync(filePath, json, 'utf-8')
}

/**
 * Find an attestation for a specific suite.
 *
 * @param attestations - Attestations file containing all attestations
 * @param suite - Name of the suite to find
 * @returns The attestation if found, undefined otherwise
 * @public
 */
export function findAttestation(
  attestations: AttestationsFile,
  suite: string,
): Attestation | undefined {
  return attestations.attestations.find((a) => a.suite === suite)
}

/**
 * Add or update an attestation for a suite.
 *
 * This is an immutable operation that returns a new array.
 *
 * @param attestations - Current array of attestations
 * @param newAttestation - Attestation to add or update
 * @returns New attestations array with the upserted attestation
 * @throws Error if the new attestation fails validation
 * @public
 */
export function upsertAttestation(
  attestations: Attestation[],
  newAttestation: Attestation,
): Attestation[] {
  // Validate the new attestation
  attestationSchema.parse(newAttestation)

  const existingIndex = attestations.findIndex((a) => a.suite === newAttestation.suite)

  if (existingIndex === -1) {
    // Add new attestation
    return [...attestations, newAttestation]
  } else {
    // Update existing attestation
    const updated = [...attestations]
    // eslint-disable-next-line security/detect-object-injection -- False positive: existingIndex is a safe number from findIndex
    updated[existingIndex] = newAttestation
    return updated
  }
}

/**
 * Remove attestations for a suite.
 *
 * This is an immutable operation that returns a new array.
 *
 * @param attestations - Current array of attestations
 * @param suite - Name of the suite to remove
 * @returns New attestations array without the specified suite
 * @public
 */
export function removeAttestation(attestations: Attestation[], suite: string): Attestation[] {
  return attestations.filter((a) => a.suite !== suite)
}

/**
 * Compute canonical JSON representation for signing.
 *
 * Implements RFC 8785 JSON Canonicalization Scheme. The canonicalize package provides:
 * 1. Keys sorted lexicographically (Unicode code point order)
 * 2. No whitespace between tokens
 * 3. No trailing commas
 * 4. Strings escaped using \uXXXX for control characters
 * 5. Numbers: no leading zeros, no +, use lowercase 'e' for exponent
 * 6. UTF-8 encoding
 *
 * @param attestations - Array of attestations to canonicalize
 * @returns Canonical JSON string representation
 * @throws Error if canonicalization fails
 * @public
 */
export function canonicalizeAttestations(attestations: Attestation[]): string {
  const canonical = serialize(attestations)
  if (canonical === undefined) {
    throw new Error('Failed to canonicalize attestations')
  }
  return canonical
}

/**
 * Create a new attestation entry.
 *
 * @param params - Parameters for creating the attestation
 * @param params.suite - Name of the test suite
 * @param params.fingerprint - Fingerprint of the packages in sha256 format
 * @param params.command - Command that was executed
 * @param params.attestedBy - Optional username (defaults to current OS user)
 * @returns Validated attestation object
 * @throws Error if attestation validation fails
 * @public
 */
export function createAttestation(params: {
  suite: string
  fingerprint: string
  command: string
  attestedBy?: string
}): Attestation {
  const attestation: Attestation = {
    suite: params.suite,
    fingerprint: params.fingerprint,
    attestedAt: new Date().toISOString(),
    attestedBy: params.attestedBy ?? os.userInfo().username,
    command: params.command,
    exitCode: 0,
  }

  // Validate before returning
  attestationSchema.parse(attestation)

  return attestation
}

/**
 * Options for writing signed attestations.
 * @public
 */
export interface WriteSignedAttestationsOptions {
  /** Path to write the attestations file */
  filePath: string
  /** Array of attestations to write */
  attestations: Attestation[]
  /** Path to the private key for signing (legacy) */
  privateKeyPath?: string
  /** Key provider for signing */
  keyProvider?: import('./key-provider/types.js').KeyProvider
  /** Key reference for the provider */
  keyRef?: string
}

/**
 * Options for reading and verifying signed attestations.
 * @public
 */
export interface ReadSignedAttestationsOptions {
  /** Path to read the attestations file from */
  filePath: string
  /** Path to the public key for verification */
  publicKeyPath: string
}

/**
 * Write attestations with a cryptographic signature.
 *
 * This function canonicalizes the attestations, signs them with the private key,
 * and writes the attestations file with the signature.
 *
 * @param options - Options for writing signed attestations
 * @throws Error if signing or writing fails
 * @public
 */
export async function writeSignedAttestations(
  options: WriteSignedAttestationsOptions,
): Promise<void> {
  // Import sign function here to avoid circular dependency
  const { sign } = await import('./crypto.js')

  const { privateKeyPath, keyProvider, keyRef } = options

  // Validate that we have either legacy path or provider + ref
  if (!privateKeyPath && (!keyProvider || !keyRef)) {
    throw new Error(
      'Either privateKeyPath or both keyProvider and keyRef must be provided for signing',
    )
  }

  const canonical = canonicalizeAttestations(options.attestations)

  // Build sign options, only including defined properties
  const signOptions: Parameters<typeof sign>[0] = {
    data: canonical,
  }

  if (privateKeyPath !== undefined) {
    signOptions.privateKeyPath = privateKeyPath
  }
  if (keyProvider !== undefined) {
    signOptions.keyProvider = keyProvider
  }
  if (keyRef !== undefined) {
    signOptions.keyRef = keyRef
  }

  const signature = await sign(signOptions)
  await writeAttestations(options.filePath, options.attestations, signature)
}

/**
 * Read attestations and verify the signature.
 *
 * This function reads the attestations file, canonicalizes the attestations,
 * and verifies the signature using the public key. It throws an error if the
 * file doesn't exist or if signature verification fails.
 *
 * @param options - Options for reading and verifying attestations
 * @returns The attestations file if signature is valid
 * @throws Error if attestations file not found
 * @throws SignatureInvalidError if signature verification fails
 * @public
 */
export async function readAndVerifyAttestations(
  options: ReadSignedAttestationsOptions,
): Promise<AttestationsFile> {
  // Import verify function here to avoid circular dependency
  const { verify } = await import('./crypto.js')

  const file = await readAttestations(options.filePath)
  if (!file) {
    throw new Error(`Attestations file not found: ${options.filePath}`)
  }

  const canonical = canonicalizeAttestations(file.attestations)
  const isValid = await verify({
    publicKeyPath: options.publicKeyPath,
    data: canonical,
    signature: file.signature,
  })

  if (!isValid) {
    throw new SignatureInvalidError(options.filePath)
  }

  return file
}

/**
 * Error thrown when signature verification fails.
 * @public
 */
export class SignatureInvalidError extends Error {
  /**
   * Create a new SignatureInvalidError.
   * @param filePath - Path to the file that failed verification
   */
  constructor(filePath: string) {
    super(`Signature verification failed for: ${filePath}`)
    this.name = 'SignatureInvalidError'
  }
}
