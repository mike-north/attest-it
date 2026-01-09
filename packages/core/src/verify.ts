/**
 * Verification logic for attestations.
 * @packageDocumentation
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import type {
  AttestItConfig,
  Attestation,
  AttestationsFile,
  SuiteVerificationResult,
} from './types.js'
import { computeFingerprint } from './fingerprint.js'
import { readAndVerifyAttestations, SignatureInvalidError } from './attestation.js'

/**
 * Options for verifying attestations.
 * @public
 */
export interface VerifyOptions {
  /** Configuration object */
  config: AttestItConfig
  /** Repository root directory (defaults to process.cwd()) */
  repoRoot?: string
}

/**
 * Result of verifying all attestations.
 * @public
 */
export interface VerifyResult {
  /** Overall success - true if all attestations are valid */
  success: boolean
  /** Whether the attestations file signature is valid */
  signatureValid: boolean
  /** Verification results for each suite */
  suites: SuiteVerificationResult[]
  /** Error messages encountered during verification */
  errors: string[]
}

/**
 * Verify all attestations against current code state.
 *
 * Verification algorithm:
 * 1. Load and verify attestations file signature
 * 2. For each suite in config:
 *    a. Compute current fingerprint
 *    b. Find matching attestation
 *    c. Compare fingerprints
 *    d. Check age
 * 3. Check invalidation chains
 * 4. Return aggregated results
 *
 * @param options - Verification options
 * @returns Verification result with status for each suite
 * @public
 */
export async function verifyAttestations(options: VerifyOptions): Promise<VerifyResult> {
  const { config, repoRoot = process.cwd() } = options
  const errors: string[] = []
  const suiteResults: SuiteVerificationResult[] = []
  let signatureValid = true
  let attestationsFile: AttestationsFile | null = null

  // Resolve paths
  const attestationsPath = resolvePath(config.settings.attestationsPath, repoRoot)
  const publicKeyPath = resolvePath(config.settings.publicKeyPath, repoRoot)

  // Step 1: Load and verify attestations
  try {
    if (!fs.existsSync(attestationsPath)) {
      // No attestations file - all suites need attestation
      attestationsFile = null
    } else if (!fs.existsSync(publicKeyPath)) {
      errors.push(`Public key not found: ${publicKeyPath}`)
      signatureValid = false
    } else {
      attestationsFile = await readAndVerifyAttestations({
        filePath: attestationsPath,
        publicKeyPath,
      })
    }
  } catch (err) {
    if (err instanceof SignatureInvalidError) {
      signatureValid = false
      errors.push(err.message)
    } else if (err instanceof Error) {
      errors.push(err.message)
    }
  }

  const attestations = attestationsFile?.attestations ?? []

  // Step 2: Check each suite
  for (const [suiteName, suiteConfig] of Object.entries(config.suites)) {
    const result = await verifySuite({
      suiteName,
      suiteConfig,
      attestations,
      maxAgeDays: config.settings.maxAgeDays,
      repoRoot,
    })
    suiteResults.push(result)
  }

  // Step 3: Check invalidation chains
  checkInvalidationChains(config, suiteResults)

  // Step 4: Aggregate results
  const allValid =
    signatureValid && suiteResults.every((r) => r.status === 'VALID') && errors.length === 0

  return {
    success: allValid,
    signatureValid,
    suites: suiteResults,
    errors,
  }
}

/**
 * Options for verifying a single suite.
 * @internal
 */
interface VerifySuiteOptions {
  /** Name of the suite */
  suiteName: string
  /** Suite configuration */
  suiteConfig: { packages: string[]; ignore?: string[] }
  /** All attestations from the attestations file */
  attestations: Attestation[]
  /** Maximum age in days before attestation expires */
  maxAgeDays: number
  /** Repository root directory */
  repoRoot: string
}

/**
 * Verify a single suite's attestation.
 * @internal
 */
async function verifySuite(options: VerifySuiteOptions): Promise<SuiteVerificationResult> {
  const { suiteName, suiteConfig, attestations, maxAgeDays, repoRoot } = options

  // Compute current fingerprint
  const fingerprintOptions = {
    packages: suiteConfig.packages.map((p) => resolvePath(p, repoRoot)),
    baseDir: repoRoot,
    ...(suiteConfig.ignore && { ignore: suiteConfig.ignore }),
  }
  const fingerprintResult = await computeFingerprint(fingerprintOptions)

  // Find attestation for this suite
  const attestation = attestations.find((a) => a.suite === suiteName)

  // No attestation found
  if (!attestation) {
    return {
      suite: suiteName,
      status: 'NEEDS_ATTESTATION',
      fingerprint: fingerprintResult.fingerprint,
      message: 'No attestation found for this suite',
    }
  }

  // Check fingerprint
  if (attestation.fingerprint !== fingerprintResult.fingerprint) {
    return {
      suite: suiteName,
      status: 'FINGERPRINT_CHANGED',
      fingerprint: fingerprintResult.fingerprint,
      attestation,
      message: `Fingerprint changed from ${attestation.fingerprint.slice(0, 20)}... to ${fingerprintResult.fingerprint.slice(0, 20)}...`,
    }
  }

  // Check age
  const attestedAt = new Date(attestation.attestedAt)
  const ageMs = Date.now() - attestedAt.getTime()
  const ageDays = Math.floor(ageMs / (1000 * 60 * 60 * 24))

  if (ageDays > maxAgeDays) {
    return {
      suite: suiteName,
      status: 'EXPIRED',
      fingerprint: fingerprintResult.fingerprint,
      attestation,
      age: ageDays,
      message: `Attestation expired (${String(ageDays)} days old, max ${String(maxAgeDays)} days)`,
    }
  }

  // All checks passed
  return {
    suite: suiteName,
    status: 'VALID',
    fingerprint: fingerprintResult.fingerprint,
    attestation,
    age: ageDays,
  }
}

/**
 * Check invalidation chains.
 *
 * If suite A invalidates suite B, and A's attestation is newer than B's,
 * then B should be marked as INVALIDATED_BY_PARENT.
 *
 * @param config - Full configuration
 * @param results - Array of suite verification results to mutate
 * @internal
 */
function checkInvalidationChains(config: AttestItConfig, results: SuiteVerificationResult[]): void {
  for (const [parentName, parentConfig] of Object.entries(config.suites)) {
    const invalidates = parentConfig.invalidates ?? []
    const parentResult = results.find((r) => r.suite === parentName)

    if (!parentResult?.attestation) continue

    const parentTime = new Date(parentResult.attestation.attestedAt).getTime()

    for (const childName of invalidates) {
      const childResult = results.find((r) => r.suite === childName)
      if (!childResult?.attestation) continue

      const childTime = new Date(childResult.attestation.attestedAt).getTime()

      // If parent was attested AFTER child, child is invalidated
      if (parentTime > childTime && childResult.status === 'VALID') {
        childResult.status = 'INVALIDATED_BY_PARENT'
        childResult.message = `Invalidated by ${parentName} (attested later)`
      }
    }
  }
}

/**
 * Resolve a path relative to a base directory.
 * @param relativePath - Path that may be relative or absolute
 * @param baseDir - Base directory for resolving relative paths
 * @returns Absolute path
 * @internal
 */
function resolvePath(relativePath: string, baseDir: string): string {
  if (path.isAbsolute(relativePath)) {
    return relativePath
  }
  return path.join(baseDir, relativePath)
}
