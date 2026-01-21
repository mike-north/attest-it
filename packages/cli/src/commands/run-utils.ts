/**
 * Shared utilities for the run command.
 *
 * Provides functions for checking suite status, filtering suites,
 * and formatting status information.
 *
 * @packageDocumentation
 */

import type { Config, VerificationStatus, Attestation, AttestationsFile } from '@attest-it/core'
import { computeFingerprint, readAttestations, findAttestation } from '@attest-it/core'

/**
 * Information about a suite's current status.
 * @public
 */
export interface SuiteStatus {
  /** Suite name */
  name: string
  /** Current verification status */
  status: VerificationStatus
  /** Human-readable reason for the status */
  reason: string
  /** Current fingerprint of source files */
  currentFingerprint: string
  /** Fingerprint from existing attestation (if any) */
  attestedFingerprint?: string | undefined
  /** ISO timestamp of attestation (if any) */
  attestedAt?: string | undefined
  /** Days since attestation (if any) */
  age?: number | undefined
}

/**
 * Determine the verification status for a suite.
 *
 * @param attestation - Existing attestation, if any
 * @param currentFingerprint - Current computed fingerprint
 * @param maxAgeDays - Maximum allowed age in days
 * @returns Verification status
 * @internal
 */
function determineStatus(
  attestation: Attestation | null | undefined,
  currentFingerprint: string,
  maxAgeDays: number,
): VerificationStatus {
  if (!attestation) {
    return 'NEEDS_ATTESTATION'
  }

  if (attestation.fingerprint !== currentFingerprint) {
    return 'FINGERPRINT_CHANGED'
  }

  const attestedAt = new Date(attestation.attestedAt)
  const ageInDays = Math.floor((Date.now() - attestedAt.getTime()) / (1000 * 60 * 60 * 24))

  if (ageInDays > maxAgeDays) {
    return 'EXPIRED'
  }

  return 'VALID'
}

/**
 * Get status information for all suites.
 *
 * @param config - Configuration object
 * @returns Array of suite statuses
 * @public
 */
export async function getAllSuiteStatuses(config: Config): Promise<SuiteStatus[]> {
  // Load attestations (may not exist)
  let attestationsFile: AttestationsFile | null = null
  try {
    attestationsFile = await readAttestations(config.settings.attestationsPath)
  } catch (err) {
    // Attestations file may not exist yet - that's okay
    if (err instanceof Error && !err.message.includes('ENOENT')) {
      throw err
    }
  }
  const attestations = attestationsFile?.attestations ?? []

  const results: SuiteStatus[] = []

  for (const [suiteName, suiteConfig] of Object.entries(config.suites)) {
    // Determine fingerprint paths - either from suite's packages or from referenced gate
    let packages: string[] | undefined
    let ignore: string[] | undefined

    if (suiteConfig.gate && config.gates) {
      // Suite references a gate - use gate's fingerprint config
      const gateConfig = config.gates[suiteConfig.gate]
      if (gateConfig) {
        packages = gateConfig.fingerprint.paths
        ignore = gateConfig.fingerprint.exclude
      }
    } else if (suiteConfig.packages) {
      // Legacy: suite defines packages directly
      packages = suiteConfig.packages
      ignore = suiteConfig.ignore
    }

    // Skip if we couldn't resolve fingerprint paths
    if (!packages || packages.length === 0) {
      continue
    }

    // Compute current fingerprint
    const fingerprintResult = await computeFingerprint({
      packages,
      ...(ignore && { ignore }),
    })

    // Find existing attestation
    const attestation = findAttestation(
      { schemaVersion: '1', attestations, signature: '' },
      suiteName,
    )

    // Determine status
    const status = determineStatus(
      attestation,
      fingerprintResult.fingerprint,
      config.settings.maxAgeDays,
    )

    // Calculate age
    let age: number | undefined
    if (attestation) {
      const attestedAt = new Date(attestation.attestedAt)
      age = Math.floor((Date.now() - attestedAt.getTime()) / (1000 * 60 * 60 * 24))
    }

    results.push({
      name: suiteName,
      status,
      reason: formatStatusReason(status, age, config.settings.maxAgeDays),
      currentFingerprint: fingerprintResult.fingerprint,
      attestedFingerprint: attestation?.fingerprint,
      attestedAt: attestation?.attestedAt,
      age,
    })
  }

  return results
}

/**
 * Get suites that need attestation (not VALID).
 *
 * @param config - Configuration object
 * @returns Array of suite statuses that are not valid
 * @public
 */
export async function getSuitesNeedingAttestation(config: Config): Promise<SuiteStatus[]> {
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
 * @param config - Configuration object
 * @returns Array of suite names in the group
 * @public
 */
export function getSuitesInGroup(groupName: string, config: Config): string[] {
  // eslint-disable-next-line security/detect-object-injection -- groupName is a user parameter, but we safely return empty array if not found
  return config.groups?.[groupName] ?? []
}

/**
 * Format a human-readable reason for a suite's status.
 *
 * @param status - Verification status
 * @param age - Age in days (if available)
 * @param maxAgeDays - Maximum allowed age in days (if available)
 * @returns Human-readable status reason
 * @public
 */
export function formatStatusReason(
  status: VerificationStatus,
  age?: number,
  maxAgeDays?: number,
): string {
  switch (status) {
    case 'VALID':
      return `Attested ${String(age ?? 0)} days ago`
    case 'NEEDS_ATTESTATION':
      return 'No attestation found'
    case 'FINGERPRINT_CHANGED':
      return 'Source files modified'
    case 'EXPIRED':
      return `${String(age ?? 0)} days old (max: ${String(maxAgeDays ?? 30)})`
    case 'SIGNATURE_INVALID':
      return 'Signature verification failed'
    case 'INVALIDATED_BY_PARENT':
      return 'Invalidated by parent suite'
    default:
      return status
  }
}
