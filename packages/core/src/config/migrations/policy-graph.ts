/**
 * Migration graph for policy configuration (.attest-it/policy.yaml).
 *
 * Policy files contain trust and security-critical configuration that should
 * be loaded from the default branch to prevent tampering by PR authors.
 *
 * @packageDocumentation
 */

import { createMigrationGraph, integerStrategy } from '@migrex/core'
import { fromZod } from '@migrex/zod'
import { z } from 'zod'
import {
  durationSchema,
  fingerprintConfigSchema,
  gateSchema,
  semverSchema,
  teamMemberSchema,
} from '../shared-schemas.js'

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
  return z
    .union([z.literal(version), z.literal(String(version))])
    .transform((): V => version)
}

/**
 * Zod schema for policy settings (v1).
 * @internal
 */
const policySettingsSchemaV1 = z
  .object({
    maxAgeDays: z.number().int().positive().default(30),
    publicKeyPath: z.string().default('.attest-it/pubkey.pem'),
    attestationsPath: z.string().default('.attest-it/attestations.json'),
    sealsPath: z.string().default('.attest-it/seals.json'),
  })
  .strict()

/**
 * Zod schema for the policy configuration file (v1).
 * @internal
 */
const policySchemaV1 = z
  .object({
    version: versionSchema(1),
    minVersion: semverSchema.optional(),
    settings: policySettingsSchemaV1.default({}),
    team: z.record(z.string(), teamMemberSchema).optional(),
    gates: z.record(z.string(), gateSchema).optional(),
  })
  .strict()

/**
 * Migrex versioned schema for policy config v1.
 * @internal
 */
const schemaV1 = fromZod('1', policySchemaV1)

/**
 * Migration graph for policy configuration.
 *
 * Uses integer versioning (1, 2, 3, ...) to match the simple version: 1 field.
 *
 * @public
 */
export const policyMigrationGraph = createMigrationGraph({
  id: 'attest-it-policy',
  versionStrategy: integerStrategy,
  schemas: [schemaV1],
  migrations: [],
})

/**
 * Type alias for policy config v1.
 * @public
 */
export type PolicyConfigV1 = z.infer<typeof policySchemaV1>

/**
 * Union of all policy config versions.
 * @public
 */
export type PolicyConfigVersions = PolicyConfigV1

// Re-export schemas for use in policy-schema.ts
export {
  policySchemaV1,
  policySettingsSchemaV1,
  durationSchema,
  fingerprintConfigSchema,
  gateSchema,
  teamMemberSchema,
}
