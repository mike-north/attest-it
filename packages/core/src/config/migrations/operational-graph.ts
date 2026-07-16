/**
 * Migration graph for operational configuration (.attest-it/config.yaml).
 *
 * Operational files contain non-security-critical configuration that can
 * be loaded from PR branches (e.g., suite definitions, command execution settings).
 *
 * @packageDocumentation
 */

import { createMigrationGraph, integerStrategy } from '@migrex/core'
import { fromZod } from '@migrex/zod'
import { z } from 'zod'
import { keyProviderSchema, semverSchema } from '../shared-schemas.js'

/**
 * Helper to create a version schema that accepts both number and string versions.
 * This allows migrex (which uses string versions internally) to work with our
 * numeric version fields while maintaining backward compatibility.
 *
 * @param version - The expected version number
 * @returns A Zod schema that accepts both number and string versions
 * @internal
 */
function versionSchema<V extends number>(version: V) {
  return z.union([z.literal(version), z.literal(String(version))]).transform((): V => version)
}

/**
 * Zod schema for operational settings (v1).
 * @internal
 */
const operationalSettingsSchemaV1 = z
  .object({
    defaultCommand: z.string().optional(),
    keyProvider: keyProviderSchema.optional(),
  })
  .strict()

/**
 * Zod schema for a suite configuration (v1).
 *
 * Every suite must reference a gate. The gate is the single source of truth for
 * a suite's fingerprint configuration and authorized signers; there is no
 * gate-less suite shape. This keeps every suite subject to cross-config gate
 * validation against the trusted policy (PRD R1).
 *
 * @internal
 */
const suiteSchemaV1 = z
  .object({
    // Reference to a gate (required — defines fingerprint config and authorization)
    gate: z.string().min(1, 'Gate reference cannot be empty'),
    description: z.string().optional(),
    // CLI-specific fields
    command: z.string().optional(),
    timeout: z.string().optional(),
    interactive: z.boolean().optional(),
    // Relationship fields
    invalidates: z.array(z.string().min(1, 'Invalidated suite name cannot be empty')).optional(),
    depends_on: z.array(z.string().min(1, 'Dependency suite name cannot be empty')).optional(),
  })
  .strict()

/**
 * Zod schema for the operational configuration file (v1).
 * @internal
 */
const operationalSchemaV1 = z
  .object({
    version: versionSchema(1),
    minVersion: semverSchema.optional(),
    settings: operationalSettingsSchemaV1.default({}),
    suites: z
      .record(z.string(), suiteSchemaV1)
      .refine((suites) => Object.keys(suites).length >= 1, {
        message: 'At least one suite must be defined',
      }),
    groups: z
      .record(z.string(), z.array(z.string().min(1, 'Suite name in group cannot be empty')))
      .optional(),
  })
  .strict()

/**
 * Migrex versioned schema for operational config v1.
 * @internal
 */
const schemaV1 = fromZod('1', operationalSchemaV1)

/**
 * Migration graph for operational configuration.
 *
 * Uses integer versioning (1, 2, 3, ...) to match the simple version: 1 field.
 *
 * @public
 */
export const operationalMigrationGraph = createMigrationGraph({
  id: 'attest-it-operational',
  versionStrategy: integerStrategy,
  schemas: [schemaV1],
  migrations: [],
})

/**
 * Type alias for operational config v1.
 * @public
 */
export type OperationalConfigV1 = z.infer<typeof operationalSchemaV1>

/**
 * Union of all operational config versions.
 * @public
 */
export type OperationalConfigVersions = OperationalConfigV1

// Re-export schemas for use in operational-schema.ts
export { operationalSchemaV1, suiteSchemaV1 }
