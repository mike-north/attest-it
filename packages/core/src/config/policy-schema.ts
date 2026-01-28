/**
 * Policy configuration schema and validation for attest-it.
 *
 * Policy files contain trust and security-critical configuration that should
 * be loaded from the default branch to prevent tampering by PR authors.
 *
 * ============================================================================
 * IMPORTANT: DOCUMENTATION SYNC REQUIRED
 * ============================================================================
 * When modifying any schema in this file, you MUST also update:
 *
 * 1. README.md - Update the "Configuration" section's quick example
 * 2. docs/configuration.md - Update the comprehensive configuration reference
 * 3. schemas/policy.schema.json - Run `pnpm --filter @attest-it/core generate:schemas`
 *
 * The configuration format is a key part of the user experience. Any schema
 * changes should be reflected in user-facing documentation.
 * ============================================================================
 */

import { parse as parseYaml } from 'yaml'
import { z } from 'zod'
import {
  durationSchema,
  fingerprintConfigSchema,
  gateSchema,
  semverSchema,
  teamMemberSchema,
} from './shared-schemas.js'
import { checkVersionCompatibility } from '../version.js'
import {
  policyMigrationGraph,
  policySchemaV1,
  type PolicyConfigV1,
} from './migrations/index.js'

/**
 * Zod schema for the policy configuration file.
 *
 * Policy files define:
 * - Security settings (key paths, attestation storage, max age)
 * - Team members and their public keys
 * - Gates with authorization rules
 *
 * Note: The schema is defined in migrations/policy-graph.ts for versioning.
 * This export maintains backward compatibility.
 *
 * @public
 */
export const policySchema = policySchemaV1

/**
 * Policy configuration type inferred from the Zod schema.
 * @public
 */
export type PolicyConfig = PolicyConfigV1

/**
 * Error thrown when policy configuration is invalid.
 * @public
 */
export class PolicyValidationError extends Error {
  constructor(
    message: string,
    public readonly issues: z.ZodIssue[],
  ) {
    super(message)
    this.name = 'PolicyValidationError'
  }
}

/**
 * Parse policy configuration content from a string.
 *
 * @param content - The policy file content
 * @param format - The format of the content ('yaml' or 'json')
 * @returns Parsed and validated policy configuration
 * @throws {@link PolicyValidationError} If validation fails
 * @public
 */
export function parsePolicyContent(content: string, format: 'yaml' | 'json'): PolicyConfig {
  let rawConfig: unknown

  try {
    if (format === 'yaml') {
      rawConfig = parseYaml(content)
    } else {
      rawConfig = JSON.parse(content)
    }
  } catch (error) {
    throw new PolicyValidationError(
      `Failed to parse ${format.toUpperCase()}: ${error instanceof Error ? error.message : String(error)}`,
      [],
    )
  }

  const result = policySchema.safeParse(rawConfig)

  if (!result.success) {
    throw new PolicyValidationError(
      'Policy validation failed:\n' +
        result.error.issues
          .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
          .join('\n'),
      result.error.issues,
    )
  }

  // Check version compatibility if minVersion is specified
  if (result.data.minVersion !== undefined) {
    checkVersionCompatibility(result.data.minVersion)
  }

  return result.data
}

// Re-export shared schemas for convenience
export { durationSchema, fingerprintConfigSchema, gateSchema, teamMemberSchema }
