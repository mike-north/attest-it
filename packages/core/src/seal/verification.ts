/**
 * Seal verification logic and states.
 * @packageDocumentation
 */

import { parseDuration, getGate, isAuthorizedSigner } from '../authorization.js'
import type { AttestItConfig } from '../types.js'
import type { Seal, SealsFile } from './types.js'
import { verifySeal } from './operations.js'

/**
 * Verification state for a gate's seal.
 * @public
 */
export type VerificationState =
  | 'VALID' // Seal exists, signature valid, not stale, fingerprint matches
  | 'MISSING' // No seal for this gate
  | 'STALE' // Seal exists but exceeds maxAge
  | 'FINGERPRINT_MISMATCH' // Seal fingerprint doesn't match current fingerprint
  | 'INVALID_SIGNATURE' // Signature doesn't verify
  | 'UNKNOWN_SIGNER' // sealedBy not in team or not authorized for this gate

/**
 * Result of verifying a single gate's seal.
 * @public
 */
export interface SealVerificationResult {
  /** Gate identifier */
  gateId: string
  /**
   * For a pattern-gate per-file verification, the specific matched file this
   * result covers (repo-relative, forward-slash). Absent for an ordinary
   * single-gate result.
   */
  artifactPath?: string
  /** Verification state */
  state: VerificationState
  /** The seal, if one exists */
  seal?: Seal
  /** Human-readable message explaining the state */
  message?: string
}

/**
 * Verify a single gate's seal.
 *
 * @param config - The attest-it configuration
 * @param gateId - Gate identifier to verify
 * @param seals - The seals file containing all seals
 * @param currentFingerprint - Current computed fingerprint for the gate
 * @returns Verification result for the gate
 * @public
 */
export function verifyGateSeal(
  config: AttestItConfig,
  gateId: string,
  seals: SealsFile,
  currentFingerprint: string,
): SealVerificationResult {
  // Get the gate configuration
  const gate = getGate(config, gateId)
  if (!gate) {
    return {
      gateId,
      state: 'MISSING',
      message: `Gate '${gateId}' not found in configuration`,
    }
  }

  // Check if a seal exists for this gate
  // eslint-disable-next-line security/detect-object-injection
  const seal = seals.seals[gateId]
  if (!seal) {
    return {
      gateId,
      state: 'MISSING',
      message: `No seal found for gate '${gateId}'`,
    }
  }

  return evaluateSeal({ config, gateId, seal, currentFingerprint, maxAge: gate.maxAge })
}

/**
 * Verify a single matched file within a **pattern gate**.
 *
 * The caller supplies the specific per-file seal (looked up by gate + artifact
 * path, or `undefined` if none exists) and the file's individual current
 * fingerprint. This mirrors {@link verifyGateSeal} but is keyed to one file, so a
 * pattern gate's files verify independently.
 *
 * @param config - The attest-it configuration
 * @param gateId - The pattern gate's identifier
 * @param artifactPath - The matched file (repo-relative, forward-slash)
 * @param seal - The per-file seal for this file, or `undefined` if none exists
 * @param currentFingerprint - The file's current individual fingerprint
 * @param maxAge - The gate's `maxAge`, or `undefined` for an indefinite gate
 * @returns Verification result for this file, carrying `artifactPath`
 * @public
 */
export function verifyPatternArtifactSeal(
  config: AttestItConfig,
  gateId: string,
  artifactPath: string,
  seal: Seal | undefined,
  currentFingerprint: string,
  maxAge: string | undefined,
): SealVerificationResult {
  if (!seal) {
    return {
      gateId,
      artifactPath,
      state: 'MISSING',
      message: `No seal found for '${artifactPath}' in gate '${gateId}'`,
    }
  }
  return evaluateSeal({ config, gateId, seal, currentFingerprint, maxAge, artifactPath })
}

/**
 * Shared seal evaluation: fingerprint match, signer authorization, signature
 * validity, then optional staleness. Used by both the single-gate and
 * pattern-gate verification entry points so their rules never drift.
 *
 * When `maxAge` is `undefined` the gate is **indefinite**: the staleness check is
 * skipped entirely and no `STALE` state is ever produced, regardless of seal age.
 * @internal
 */
function evaluateSeal(params: {
  config: AttestItConfig
  gateId: string
  seal: Seal
  currentFingerprint: string
  maxAge: string | undefined
  artifactPath?: string
}): SealVerificationResult {
  const { config, gateId, seal, currentFingerprint, maxAge, artifactPath } = params
  const base = artifactPath !== undefined ? { gateId, artifactPath } : { gateId }

  // Check if fingerprint matches
  if (seal.fingerprint !== currentFingerprint) {
    return {
      ...base,
      state: 'FINGERPRINT_MISMATCH',
      seal,
      message: `Fingerprint changed since seal was created`,
    }
  }

  // Check if signer is in team and authorized
  if (!config.team) {
    return { ...base, state: 'UNKNOWN_SIGNER', seal, message: `No team configuration found` }
  }

  const teamMember = config.team[seal.sealedBy]
  if (!teamMember) {
    return {
      ...base,
      state: 'UNKNOWN_SIGNER',
      seal,
      message: `Signer '${seal.sealedBy}' not found in team`,
    }
  }

  // Check if signer is authorized for this gate
  const authorized = isAuthorizedSigner(config, gateId, teamMember.publicKey)
  if (!authorized) {
    return {
      ...base,
      state: 'UNKNOWN_SIGNER',
      seal,
      message: `Signer '${seal.sealedBy}' is not authorized for gate '${gateId}'`,
    }
  }

  // Verify signature
  const verificationResult = verifySeal(seal, config)
  if (!verificationResult.valid) {
    return {
      ...base,
      state: 'INVALID_SIGNATURE',
      seal,
      message: verificationResult.error ?? 'Signature verification failed',
    }
  }

  // Staleness — only when the gate declares a maxAge. An indefinite gate (no
  // maxAge) never expires: skip the check so it can never be reported STALE.
  if (maxAge !== undefined) {
    try {
      const maxAgeMs = parseDuration(maxAge)
      const sealTimestamp = new Date(seal.timestamp).getTime()
      const ageMs = Date.now() - sealTimestamp

      if (ageMs > maxAgeMs) {
        const ageDays = Math.floor(ageMs / (1000 * 60 * 60 * 24))
        const maxAgeDays = Math.floor(maxAgeMs / (1000 * 60 * 60 * 24))
        return {
          ...base,
          state: 'STALE',
          seal,
          message: `Seal is ${ageDays.toString()} days old, exceeds maxAge of ${maxAgeDays.toString()} days`,
        }
      }
    } catch (error) {
      // If we can't parse maxAge, fail closed - treat as stale to enforce freshness
      // This prevents bypassing staleness checks with invalid maxAge values
      return {
        ...base,
        state: 'STALE',
        seal,
        message: `Cannot verify freshness: invalid maxAge format: ${error instanceof Error ? error.message : String(error)}`,
      }
    }
  }

  // All checks passed
  return { ...base, state: 'VALID', seal }
}

/**
 * Verify all gates' seals.
 *
 * @param config - The attest-it configuration
 * @param seals - The seals file containing all seals
 * @param fingerprints - Map of gate IDs to their current fingerprints
 * @returns Array of verification results for all gates
 * @public
 */
export function verifyAllSeals(
  config: AttestItConfig,
  seals: SealsFile,
  fingerprints: Record<string, string>,
): SealVerificationResult[] {
  if (!config.gates) {
    return []
  }

  const results: SealVerificationResult[] = []

  for (const gateId of Object.keys(config.gates)) {
    // eslint-disable-next-line security/detect-object-injection
    const fingerprint = fingerprints[gateId]
    if (!fingerprint) {
      results.push({
        gateId,
        state: 'MISSING',
        message: `No fingerprint computed for gate '${gateId}'`,
      })
      continue
    }

    const result = verifyGateSeal(config, gateId, seals, fingerprint)
    results.push(result)
  }

  return results
}
