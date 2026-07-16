/**
 * Cross-configuration validation for split policy and operational configs.
 *
 * This module validates relationships between policy and operational configurations,
 * ensuring that suite-gate references are valid and that all authorized signers
 * are defined in the team.
 *
 * @packageDocumentation
 */

import type { OperationalConfig } from './operational-schema.js'
import type { PolicyConfig } from './policy-schema.js'

/**
 * Validation error types for cross-configuration validation.
 * @public
 */
export type ValidationErrorType = 'UNKNOWN_GATE' | 'MISSING_TEAM_MEMBER'

/**
 * Represents a validation error found during cross-configuration validation.
 * @public
 */
export interface ValidationError {
  /** The type of validation error */
  type: ValidationErrorType
  /** The suite name where the error was found (if applicable) */
  suite?: string
  /** The gate name involved in the error (if applicable) */
  gate?: string
  /** The signer slug that is missing (if applicable) */
  signer?: string
  /** Human-readable error message explaining the issue */
  message: string
}

/**
 * Validates that all suite-gate references and authorized signers are valid.
 *
 * This function performs cross-configuration validation to ensure:
 * 1. Every suite that references a gate refers to an existing gate in the policy
 * 2. Every authorized signer in each referenced gate is defined in the policy team
 *
 * These validations are critical because:
 * - Operational config (suites) can come from PR branches
 * - Policy config (gates, team) comes from the default branch
 * - We must ensure PR authors cannot reference non-existent gates or signers
 *
 * @param policy - The policy configuration containing gates and team definitions
 * @param operational - The operational configuration containing suite definitions
 * @returns An array of validation errors (empty if validation passes)
 *
 * @example
 * ```typescript
 * const errors = validateSuiteGateReferences(policy, operational)
 * if (errors.length > 0) {
 *   console.error('Validation failed:')
 *   for (const error of errors) {
 *     console.error(`  - ${error.message}`)
 *   }
 *   throw new Error('Configuration validation failed')
 * }
 * ```
 *
 * @public
 */
export function validateSuiteGateReferences(
  policy: PolicyConfig,
  operational: OperationalConfig,
): ValidationError[] {
  const errors: ValidationError[] = []
  const gates = policy.gates ?? {}
  const team = policy.team ?? {}

  // Validate every suite. Each suite references a gate (required by the
  // operational schema), so there is no gate-less shape that can skip this
  // check and evade authorization validation against the trusted policy.
  for (const [suiteName, suiteConfig] of Object.entries(operational.suites)) {
    const gateName = suiteConfig.gate

    // Check if the referenced gate exists in the policy
    // eslint-disable-next-line security/detect-object-injection
    const gate = gates[gateName]
    if (gate === undefined) {
      errors.push({
        type: 'UNKNOWN_GATE',
        suite: suiteName,
        gate: gateName,
        message: `Suite "${suiteName}" references unknown gate "${gateName}". The gate must be defined in policy.yaml.`,
      })
      continue
    }

    // Validate that all authorized signers exist in the team
    for (const signerSlug of gate.authorizedSigners) {
      // eslint-disable-next-line security/detect-object-injection
      if (team[signerSlug] === undefined) {
        errors.push({
          type: 'MISSING_TEAM_MEMBER',
          suite: suiteName,
          gate: gateName,
          signer: signerSlug,
          message: `Gate "${gateName}" (referenced by suite "${suiteName}") authorizes signer "${signerSlug}", but this team member is not defined in policy.yaml.`,
        })
      }
    }
  }

  return errors
}
