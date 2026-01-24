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
import { keyProviderSchema, semverSchema } from './shared-schemas.js'
import { checkVersionCompatibility } from '../version.js'

/**
 * Zod schema for operational settings (non-security-critical fields only).
 */
const operationalSettingsSchema = z
  .object({
    defaultCommand: z.string().optional(),
    keyProvider: keyProviderSchema.optional(),
  })
  .strict()

/**
 * Zod schema for a suite configuration.
 * Suites are CLI-layer extensions of gates with command execution capabilities.
 * For backward compatibility, suites can define their own fingerprint via packages/files/ignore.
 */
const suiteSchema = z
  .object({
    // Gate fields (if present, this suite references a gate)
    gate: z.string().optional(),
    // Legacy fingerprint definition (for backward compatibility)
    description: z.string().optional(),
    packages: z.array(z.string().min(1, 'Package path cannot be empty')).optional(),
    files: z.array(z.string().min(1, 'File path cannot be empty')).optional(),
    ignore: z.array(z.string().min(1, 'Ignore pattern cannot be empty')).optional(),
    // CLI-specific fields
    command: z.string().optional(),
    timeout: z.string().optional(),
    interactive: z.boolean().optional(),
    // Relationship fields
    invalidates: z.array(z.string().min(1, 'Invalidated suite name cannot be empty')).optional(),
    depends_on: z.array(z.string().min(1, 'Dependency suite name cannot be empty')).optional(),
  })
  .strict()
  .refine(
    (suite) => {
      // Either gate is specified, or packages is specified (for legacy compatibility)
      return suite.gate !== undefined || (suite.packages !== undefined && suite.packages.length > 0)
    },
    {
      message: 'Suite must either reference a gate or define packages for fingerprinting',
    },
  )

/**
 * Zod schema for the operational configuration file.
 *
 * Operational files define:
 * - Command execution settings (default command, key provider)
 * - Suite definitions with command execution details
 * - Suite groups for organizational purposes
 *
 * @public
 */
export const operationalSchema = z
  .object({
    version: z.literal(1),
    minVersion: semverSchema.optional(),
    settings: operationalSettingsSchema.default({}),
    suites: z.record(z.string(), suiteSchema).refine((suites) => Object.keys(suites).length >= 1, {
      message: 'At least one suite must be defined',
    }),
    groups: z
      .record(z.string(), z.array(z.string().min(1, 'Suite name in group cannot be empty')))
      .optional(),
  })
  .strict()

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
export { suiteSchema }
