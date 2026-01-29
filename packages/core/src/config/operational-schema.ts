/**
 * Operational configuration schema and validation for attest-it.
 *
 * Operational files contain non-security-critical configuration that can
 * be loaded from PR branches (e.g., suite definitions, command execution settings).
 *
 * ============================================================================
 * IMPORTANT: DOCUMENTATION SYNC REQUIRED
 * ============================================================================
 * When modifying any schema in this file, you MUST also update:
 *
 * 1. README.md - Update the "Configuration" section's quick example
 * 2. docs/configuration.md - Update the comprehensive configuration reference
 * 3. schemas/config.schema.json - Run `pnpm --filter @attest-it/core generate:schemas`
 *
 * The configuration format is a key part of the user experience. Any schema
 * changes should be reflected in user-facing documentation.
 * ============================================================================
 */

import { parse as parseYaml } from 'yaml'
import { z } from 'zod'
import { checkVersionCompatibility } from '../version.js'
import { operationalSchemaV1, suiteSchemaV1 } from './migrations/index.js'

/**
 * Zod schema for the operational configuration file.
 *
 * Operational files define:
 * - Command execution settings (default command, key provider)
 * - Suite definitions with command execution details
 * - Suite groups for organizational purposes
 *
 * Note: The schema is defined in migrations/operational-graph.ts for versioning.
 * This export maintains backward compatibility.
 *
 * @public
 */
export const operationalSchema = operationalSchemaV1

/**
 * Operational configuration type inferred from the Zod schema.
 * @public
 */
export type OperationalConfig = z.infer<typeof operationalSchema>

/**
 * Error thrown when operational configuration is invalid.
 * @public
 */
export class OperationalValidationError extends Error {
  constructor(
    message: string,
    public readonly issues: z.ZodIssue[],
  ) {
    super(message)
    this.name = 'OperationalValidationError'
  }
}

/**
 * Parse operational configuration content from a string.
 *
 * @param content - The operational config file content
 * @param format - The format of the content ('yaml' or 'json')
 * @returns Parsed and validated operational configuration
 * @throws {@link OperationalValidationError} If validation fails
 * @public
 */
export function parseOperationalContent(
  content: string,
  format: 'yaml' | 'json',
): OperationalConfig {
  let rawConfig: unknown

  try {
    if (format === 'yaml') {
      rawConfig = parseYaml(content)
    } else {
      rawConfig = JSON.parse(content)
    }
  } catch (error) {
    throw new OperationalValidationError(
      `Failed to parse ${format.toUpperCase()}: ${error instanceof Error ? error.message : String(error)}`,
      [],
    )
  }

  const result = operationalSchema.safeParse(rawConfig)

  if (!result.success) {
    throw new OperationalValidationError(
      'Operational configuration validation failed:\n' +
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

// Re-export suite schema for convenience
export { suiteSchemaV1 as suiteSchema }
