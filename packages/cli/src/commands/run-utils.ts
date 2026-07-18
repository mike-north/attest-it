/**
 * Shared utilities for the run command.
 *
 * Provides functions for checking suite status, filtering suites,
 * and formatting status information.
 *
 * @packageDocumentation
 */

import type {
  AttestItConfig,
  VerificationState,
  SealsFile,
  SealVerificationResult,
  GateConfig,
} from '@attest-it/core'
import { computeFingerprint, readSealsSync, verifyGateSeal } from '@attest-it/core'
import { isPatternGate, verifyPatternGateSync } from '../utils/pattern-gate.js'

/**
 * Information about a suite's current status.
 * @public
 */
export interface SuiteStatus {
  /** Suite name */
  name: string
  /** Current verification status */
  status: VerificationState
  /** Human-readable reason for the status */
  reason: string
  /** Current fingerprint of source files */
  currentFingerprint: string
  /** Fingerprint from existing seal (if any) */
  sealedFingerprint?: string | undefined
  /** ISO timestamp of seal (if any) */
  sealedAt?: string | undefined
  /** Days since seal was created (if any) */
  age?: number | undefined
}

/**
 * Get status information for all suites.
 *
 * @param config - Configuration object (merged policy + operational)
 * @returns Array of suite statuses
 * @public
 */
export async function getAllSuiteStatuses(config: AttestItConfig): Promise<SuiteStatus[]> {
  // Load seals file (may not exist)
  let sealsFile: SealsFile
  try {
    sealsFile = readSealsSync(process.cwd(), config.settings.sealsPath)
  } catch {
    // Seals file may not exist or be invalid - start with empty
    sealsFile = { version: 1, seals: {} }
  }

  const results: SuiteStatus[] = []

  for (const [suiteName, suiteConfig] of Object.entries(config.suites)) {
    // Suites must reference a gate
    if (!suiteConfig.gate || !config.gates) {
      continue
    }

    // Get the gate configuration
    const gateConfig = config.gates[suiteConfig.gate]
    if (!gateConfig) {
      continue
    }

    // Get fingerprint paths from the gate
    const paths = gateConfig.fingerprint.paths
    const exclude = gateConfig.fingerprint.exclude

    // Skip if no paths configured
    if (paths.length === 0) {
      continue
    }

    // A pattern gate is evaluated per matched file; roll the per-file results up
    // into a single suite status (VALID only when every matched file is valid) so
    // `run --all`/interactive reflect real per-file state rather than the old
    // single-combined-fingerprint verdict (issue #130).
    if (isPatternGate(gateConfig)) {
      results.push(rollUpPatternSuite(suiteName, config, suiteConfig.gate, gateConfig))
      continue
    }

    // Compute current fingerprint
    const fingerprintResult = await computeFingerprint({
      paths,
      ...(exclude && { exclude }),
    })

    // Verify the seal for this gate using the new seal verification system
    const verificationResult = verifyGateSeal(
      config,
      suiteConfig.gate,
      sealsFile,
      fingerprintResult.fingerprint,
    )

    // Calculate age if we have a seal
    let age: number | undefined
    if (verificationResult.seal) {
      const sealedAt = new Date(verificationResult.seal.timestamp)
      age = Math.floor((Date.now() - sealedAt.getTime()) / (1000 * 60 * 60 * 24))
    }

    results.push({
      name: suiteName,
      status: verificationResult.state,
      reason: verificationResult.message ?? formatStatusReason(verificationResult.state, age),
      currentFingerprint: fingerprintResult.fingerprint,
      sealedFingerprint: verificationResult.seal?.fingerprint,
      sealedAt: verificationResult.seal?.timestamp,
      age,
    })
  }

  return results
}

/**
 * Roll a pattern gate's independent per-file verification results into one
 * {@link SuiteStatus}. The suite is `VALID` only when it matched at least one
 * file and every matched file verifies `VALID`; otherwise the first non-valid
 * file drives the reported state/reason (e.g. a newly-added unsealed file
 * surfaces as `MISSING`, a modified sealed file as `FINGERPRINT_MISMATCH`).
 */
function rollUpPatternSuite(
  suiteName: string,
  config: AttestItConfig,
  gateId: string,
  gateConfig: GateConfig,
): SuiteStatus {
  const perFile = verifyPatternGateSync(config, gateId, gateConfig, process.cwd())

  const [first] = perFile
  if (!first) {
    return {
      name: suiteName,
      status: 'MISSING',
      reason: 'Pattern gate matched no files',
      currentFingerprint: '',
    }
  }

  const firstInvalid = perFile.find((f) => f.result.state !== 'VALID')
  const representative: SealVerificationResult = (firstInvalid ?? first).result
  const fileCount = perFile.length

  if (!firstInvalid) {
    return {
      name: suiteName,
      status: 'VALID',
      reason: `All ${String(fileCount)} matched file(s) sealed`,
      currentFingerprint: first.fingerprint,
    }
  }

  return {
    name: suiteName,
    status: representative.state,
    reason: `${representative.artifactPath ?? ''}: ${representative.message ?? formatStatusReason(representative.state)}`,
    currentFingerprint: first.fingerprint,
  }
}

/**
 * Get suites that need attestation (not VALID).
 *
 * @param config - Configuration object (merged policy + operational)
 * @returns Array of suite statuses that are not valid
 * @public
 */
export async function getSuitesNeedingAttestation(config: AttestItConfig): Promise<SuiteStatus[]> {
  const allStatuses = await getAllSuiteStatuses(config)
  return allStatuses.filter((s) => s.status !== 'VALID')
}

/**
 * Filter suites by a glob/regex pattern.
 * Matches against suite name.
 *
 * @param suites - Array of suite statuses to filter
 * @param pattern - Pattern to match (supports * wildcard)
 * @returns Filtered array of suite statuses
 * @public
 */
export function filterByPattern(suites: SuiteStatus[], pattern: string): SuiteStatus[] {
  // Support simple glob patterns: * matches anything
  const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$', 'i')
  return suites.filter((s) => regex.test(s.name))
}

/**
 * Get suites belonging to a group.
 *
 * @param groupName - Name of the group
 * @param config - Configuration object (merged policy + operational)
 * @returns Array of suite names in the group
 * @public
 */
export function getSuitesInGroup(groupName: string, config: AttestItConfig): string[] {
  // eslint-disable-next-line security/detect-object-injection -- groupName is a user parameter, but we safely return empty array if not found
  return config.groups?.[groupName] ?? []
}

/**
 * Format a human-readable reason for a suite's status.
 *
 * @param status - Verification state
 * @param age - Age in days (if available)
 * @returns Human-readable status reason
 * @public
 */
export function formatStatusReason(status: VerificationState, age?: number): string {
  switch (status) {
    case 'VALID':
      return `Sealed ${String(age ?? 0)} days ago`
    case 'MISSING':
      return 'No attestation found'
    case 'FINGERPRINT_MISMATCH':
      return 'Source files modified'
    case 'STALE':
      return `Seal expired (${String(age ?? 0)} days old)`
    case 'INVALID_SIGNATURE':
      return 'Signature verification failed'
    case 'UNKNOWN_SIGNER':
      return 'Signer not authorized'
    default:
      return status
  }
}
