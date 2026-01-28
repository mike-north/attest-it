/**
 * Migration graph for seals file (.attest-it/seals.json).
 *
 * The seals file stores cryptographic signatures for gate attestations.
 *
 * @packageDocumentation
 */

import { createMigrationGraph, integerStrategy } from '@migrex/core'
import { fromZod } from '@migrex/zod'
import { z } from 'zod'

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
 * Zod schema for a single seal (v1).
 * @internal
 */
const sealSchemaV1 = z.object({
  gateId: z.string().min(1, 'Gate ID cannot be empty'),
  fingerprint: z
    .string()
    .regex(/^sha256:[a-f0-9]+$/i, 'Invalid fingerprint format (expected sha256:<hex>)'),
  timestamp: z.string().datetime({ message: 'Invalid ISO 8601 timestamp' }),
  sealedBy: z.string().min(1, 'Signer slug cannot be empty'),
  signature: z.string().min(1, 'Signature cannot be empty'),
})

/**
 * Zod schema for the seals file (v1).
 * @internal
 */
const sealsFileSchemaV1 = z.object({
  version: versionSchema(1),
  seals: z.record(z.string(), sealSchemaV1),
})

/**
 * Migrex versioned schema for seals file v1.
 * @internal
 */
const schemaV1 = fromZod('1', sealsFileSchemaV1)

/**
 * Migration graph for seals file.
 *
 * Uses integer versioning (1, 2, 3, ...) to match the simple version: 1 field.
 *
 * @public
 */
export const sealsMigrationGraph = createMigrationGraph({
  id: 'attest-it-seals',
  versionStrategy: integerStrategy,
  schemas: [schemaV1],
  migrations: [],
})

/**
 * Type alias for seals file v1.
 * @public
 */
export type SealsFileV1 = z.infer<typeof sealsFileSchemaV1>

/**
 * Union of all seals file versions.
 * @public
 */
export type SealsFileVersions = SealsFileV1

// Re-export the Zod schemas for use in operations.ts
export { sealsFileSchemaV1, sealSchemaV1 }
