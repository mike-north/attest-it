/**
 * Authorization logic for attest-it v2.0.
 * @packageDocumentation
 */

import ms from 'ms'

import type { AttestItConfig, GateConfig, TeamMember } from './types.js'

/**
 * Check if a public key belongs to an authorized signer for a gate.
 *
 * @param config - The attest-it configuration
 * @param gateId - The gate identifier (slug)
 * @param publicKey - Base64-encoded Ed25519 public key to check
 * @returns true if the public key belongs to an authorized signer for the gate
 * @public
 */
export function isAuthorizedSigner(
  config: AttestItConfig,
  gateId: string,
  publicKey: string,
): boolean {
  // eslint-disable-next-line security/detect-object-injection
  const gate = config.gates?.[gateId]
  if (!gate) {
    return false
  }

  const teamMember = findTeamMemberByPublicKey(config, publicKey)
  if (!teamMember) {
    return false
  }

  // Find the slug for this team member
  const teamMemberSlug = findTeamMemberSlug(config, teamMember)
  if (!teamMemberSlug) {
    return false
  }

  return gate.authorizedSigners.includes(teamMemberSlug)
}

/**
 * Get all team members authorized to sign for a gate.
 *
 * @param config - The attest-it configuration
 * @param gateId - The gate identifier (slug)
 * @returns Array of authorized team members, or empty array if gate not found
 * @public
 */
export function getAuthorizedSignersForGate(config: AttestItConfig, gateId: string): TeamMember[] {
  // eslint-disable-next-line security/detect-object-injection
  const gate = config.gates?.[gateId]
  if (!gate || !config.team) {
    return []
  }

  const authorizedMembers: TeamMember[] = []
  for (const signerSlug of gate.authorizedSigners) {
    // eslint-disable-next-line security/detect-object-injection
    const member = config.team[signerSlug]
    if (member) {
      authorizedMembers.push(member)
    }
  }

  return authorizedMembers
}

/**
 * Find a team member by their public key.
 *
 * @param config - The attest-it configuration
 * @param publicKey - Base64-encoded Ed25519 public key
 * @returns The team member with matching public key, or undefined if not found
 * @public
 */
export function findTeamMemberByPublicKey(
  config: AttestItConfig,
  publicKey: string,
): TeamMember | undefined {
  if (!config.team) {
    return undefined
  }

  for (const member of Object.values(config.team)) {
    if (member.publicKey === publicKey) {
      return member
    }
  }

  return undefined
}

/**
 * Find the slug for a team member.
 *
 * @param config - The attest-it configuration
 * @param teamMember - The team member to find the slug for
 * @returns The team member slug, or undefined if not found
 */
function findTeamMemberSlug(config: AttestItConfig, teamMember: TeamMember): string | undefined {
  if (!config.team) {
    return undefined
  }

  for (const [slug, member] of Object.entries(config.team)) {
    if (member === teamMember || member.publicKey === teamMember.publicKey) {
      return slug
    }
  }

  return undefined
}

/**
 * Get the gate configuration for a given gate ID.
 *
 * @param config - The attest-it configuration
 * @param gateId - The gate identifier (slug)
 * @returns The gate configuration, or undefined if not found
 * @public
 */
export function getGate(config: AttestItConfig, gateId: string): GateConfig | undefined {
  // eslint-disable-next-line security/detect-object-injection
  return config.gates?.[gateId]
}

/**
 * Regular expression pattern for valid duration strings.
 * Matches formats like "30d", "7d", "24h", "1w", "2y", "100ms", etc.
 * Negative durations are not supported.
 * @internal
 */
const DURATION_PATTERN = /^\d+(\.\d+)?\s*(ms|s|m|h|d|w|y)$/i

/**
 * Type guard to check if a string is a valid duration format.
 *
 * @param value - String to check
 * @returns true if the string matches the duration pattern
 * @internal
 */
function isValidDurationFormat(value: string): boolean {
  return DURATION_PATTERN.test(value.trim())
}

/**
 * Parse a duration string to milliseconds.
 * Uses the ms library to parse strings like "30d", "7d", "24h".
 *
 * @param duration - Duration string (e.g., "30d", "7d", "24h")
 * @returns Duration in milliseconds
 * @throws {Error} If duration string is invalid
 * @public
 */
export function parseDuration(duration: string): number {
  // Validate format before calling ms to avoid type assertion issues
  if (!isValidDurationFormat(duration)) {
    throw new Error(`Invalid duration string: ${duration}`)
  }

  // The ms function accepts the StringValue type which is a union of specific string patterns
  // After validating the format, we can safely call ms
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- safe after format validation
  const result = ms(duration as Parameters<typeof ms>[0])
  if (typeof result !== 'number' || result <= 0) {
    throw new Error(`Invalid duration string: ${duration}`)
  }
  return result
}
