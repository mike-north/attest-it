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
 * A single independently-determined failing condition for a seal.
 * @see {@link SealVerificationResult.conditions}
 * @public
 */
export interface SealCondition {
  /** Verification state this condition represents. Never `VALID` — a condition only ever exists to describe a failure. */
  state: Exclude<VerificationState, 'VALID'>
  /** Human-readable message explaining this condition */
  message: string
}

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
  /**
   * Every independently-determined failing condition, in the same priority
   * order used to pick `state` (so `conditions[0]` mirrors `state`/`message`
   * exactly). Present only when MORE THAN ONE condition failed simultaneously
   * — a single-condition failure (the overwhelmingly common case) omits this
   * field, so existing single-condition consumers see no shape change.
   * `MISSING` is exclusive and never appears here.
   */
  conditions?: SealCondition[]
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
 * Every check below is evaluated regardless of whether an earlier check
 * failed, and each failing check contributes a {@link SealCondition} to the
 * result's `conditions` array (when more than one fails). Which conditions
 * are independent vs. mutually exclusive:
 *
 * - `FINGERPRINT_MISMATCH` (seal content vs. current fingerprint), the
 *   signer-resolution chain (`UNKNOWN_SIGNER`/`INVALID_SIGNATURE`), and
 *   `STALE` (seal age vs. `maxAge`) are all **independently determinable** —
 *   none of them depends on another's outcome. A seal can simultaneously have
 *   drifted content, be signed by an unauthorized party, and be too old, so
 *   all three are computed and reported.
 * - Within the signer chain, `UNKNOWN_SIGNER` (no team / signer not in team /
 *   signer not authorized for this gate) and `INVALID_SIGNATURE` are
 *   **mutually exclusive by necessity**: signature verification requires a
 *   resolved signer's public key, so signature validity literally cannot be
 *   checked until a signer has been resolved. This sub-chain therefore only
 *   ever contributes a single condition slot — either `UNKNOWN_SIGNER` fires
 *   (and signature checking never runs), or the signer resolves and the
 *   signature check proceeds, possibly producing `INVALID_SIGNATURE`.
 * - `MISSING` is exclusive and produced entirely outside this function (by
 *   {@link verifyGateSeal} / {@link verifyPatternArtifactSeal} before a seal
 *   object exists to evaluate), so it can never co-occur with anything here.
 *
 * When `maxAge` is `undefined` the gate is **indefinite**: the staleness check is
 * skipped entirely and no `STALE` condition is ever produced, regardless of seal age.
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

  const conditions: SealCondition[] = []

  // Check if fingerprint matches
  if (seal.fingerprint !== currentFingerprint) {
    conditions.push({
      state: 'FINGERPRINT_MISMATCH',
      message: `Fingerprint changed since seal was created`,
    })
  }

  // Check if signer is in team and authorized. Signature validity can only be
  // checked once a signer's public key has resolved, so this sub-chain
  // contributes at most one condition (UNKNOWN_SIGNER, or INVALID_SIGNATURE).
  if (!config.team) {
    conditions.push({ state: 'UNKNOWN_SIGNER', message: `No team configuration found` })
  } else {
    const teamMember = config.team[seal.sealedBy]
    if (!teamMember) {
      conditions.push({
        state: 'UNKNOWN_SIGNER',
        message: `Signer '${seal.sealedBy}' not found in team`,
      })
    } else {
      const authorized = isAuthorizedSigner(config, gateId, teamMember.publicKey)
      if (!authorized) {
        conditions.push({
          state: 'UNKNOWN_SIGNER',
          message: `Signer '${seal.sealedBy}' is not authorized for gate '${gateId}'`,
        })
      } else {
        // Verify signature
        const verificationResult = verifySeal(seal, config)
        if (!verificationResult.valid) {
          conditions.push({
            state: 'INVALID_SIGNATURE',
            message: verificationResult.error ?? 'Signature verification failed',
          })
        }
      }
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
        conditions.push({
          state: 'STALE',
          message: `Seal is ${ageDays.toString()} days old, exceeds maxAge of ${maxAgeDays.toString()} days`,
        })
      }
    } catch (error) {
      // If we can't parse maxAge, fail closed - treat as stale to enforce freshness
      // This prevents bypassing staleness checks with invalid maxAge values
      conditions.push({
        state: 'STALE',
        message: `Cannot verify freshness: invalid maxAge format: ${error instanceof Error ? error.message : String(error)}`,
      })
    }
  }

  const [primary, ...rest] = conditions
  if (!primary) {
    // No condition failed: all checks passed.
    return { ...base, state: 'VALID', seal }
  }

  return {
    ...base,
    state: primary.state,
    seal,
    message: primary.message,
    ...(rest.length > 0 && { conditions }),
  }
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
