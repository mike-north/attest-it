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

  // Check if fingerprint matches
  if (seal.fingerprint !== currentFingerprint) {
    return {
      gateId,
      state: 'FINGERPRINT_MISMATCH',
      seal,
      message: `Fingerprint changed since seal was created`,
    }
  }

  // Check if signer is in team and authorized
  if (!config.team) {
    return {
      gateId,
      state: 'UNKNOWN_SIGNER',
      seal,
      message: `No team configuration found`,
    }
  }

  // eslint-disable-next-line security/detect-object-injection
  const teamMember = config.team[seal.sealedBy]
  if (!teamMember) {
    return {
      gateId,
      state: 'UNKNOWN_SIGNER',
      seal,
      message: `Signer '${seal.sealedBy}' not found in team`,
    }
  }

  // Check if signer is authorized for this gate
  const authorized = isAuthorizedSigner(config, gateId, teamMember.publicKey)
  if (!authorized) {
    return {
      gateId,
      state: 'UNKNOWN_SIGNER',
      seal,
      message: `Signer '${seal.sealedBy}' is not authorized for gate '${gateId}'`,
    }
  }

  // Verify signature
  const verificationResult = verifySeal(seal, config)
  if (!verificationResult.valid) {
    return {
      gateId,
      state: 'INVALID_SIGNATURE',
      seal,
      message: verificationResult.error ?? 'Signature verification failed',
    }
  }

  // Check if seal is stale (exceeds maxAge)
  try {
    const maxAgeMs = parseDuration(gate.maxAge)
    const sealTimestamp = new Date(seal.timestamp).getTime()
    const now = Date.now()
    const ageMs = now - sealTimestamp

    if (ageMs > maxAgeMs) {
      const ageDays = Math.floor(ageMs / (1000 * 60 * 60 * 24))
      const maxAgeDays = Math.floor(maxAgeMs / (1000 * 60 * 60 * 24))
      return {
        gateId,
        state: 'STALE',
        seal,
        message: `Seal is ${ageDays.toString()} days old, exceeds maxAge of ${maxAgeDays.toString()} days`,
      }
    }
  } catch (error) {
    // If we can't parse maxAge, fail closed - treat as stale to enforce freshness
    // This prevents bypassing staleness checks with invalid maxAge values
    return {
      gateId,
      state: 'STALE',
      seal,
      message: `Cannot verify freshness: invalid maxAge format: ${error instanceof Error ? error.message : String(error)}`,
    }
  }

  // All checks passed
  return {
    gateId,
    state: 'VALID',
    seal,
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
