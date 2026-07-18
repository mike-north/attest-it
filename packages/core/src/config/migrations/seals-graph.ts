/**
 * Migration graph for the aggregate seals document.
 *
 * The seals document stores cryptographic signatures for gate attestations.
 *
 * - **v1** is the retired *monolithic* single-file shape
 *   (`.attest-it/seals.json` / `seals.yaml`): `{ version: 1, seals: {...} }`.
 * - **v2** is the current aggregate that the file-per-seal storage layer
 *   assembles in memory and fans out to one file per (gate, signer). The seal
 *   map is carried through unchanged — a seal's cryptographic content is bound
 *   to its artifact fingerprint, not to where it is stored, so relocating the
 *   seals from one monolith into many files does not alter any seal.
 *
 * The v1→v2 migration is the one-time bridge that lets a repository still
 * carrying a monolithic file adopt the file-per-seal layout on its next seal
 * operation. There is no remaining monolithic *read path* in steady state: once
 * migrated, the monolith is deleted and only per-seal files are read.
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
  return z.union([z.literal(version), z.literal(String(version))]).transform((): V => version)
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
 * Zod schema for the seals file (v1 — retired monolithic shape).
 * @internal
 */
const sealsFileSchemaV1 = z.object({
  version: versionSchema(1),
  seals: z.record(z.string(), sealSchemaV1),
})

/**
 * Zod schema for the seals aggregate (v2 — file-per-seal era).
 *
 * Structurally identical to v1 apart from the version marker: the seal map is
 * the same in-memory aggregate, only the on-disk layout changed (one file per
 * (gate, signer) instead of a single monolith).
 * @internal
 */
const sealsFileSchemaV2 = z.object({
  version: versionSchema(2),
  seals: z.record(z.string(), sealSchemaV1),
})

/**
 * Migrex versioned schema for seals file v1.
 * @internal
 */
const schemaV1 = fromZod('1', sealsFileSchemaV1)

/**
 * Migrex versioned schema for seals aggregate v2.
 * @internal
 */
const schemaV2 = fromZod('2', sealsFileSchemaV2)

/**
 * Migration graph for the seals document.
 *
 * Uses integer versioning (1, 2, 3, ...) to match the simple `version` field.
 *
 * @public
 */
export const sealsMigrationGraph = createMigrationGraph({
  id: 'attest-it-seals',
  versionStrategy: integerStrategy,
  schemas: [schemaV1, schemaV2],
  migrations: [
    {
      fromVersion: '1',
      toVersion: '2',
      irreversibleReason:
        'The monolithic single-file seals format (v1) is intentionally retired: once ' +
        'migrated to the file-per-seal layout (v2) the monolith is deleted and never ' +
        'rewritten, so there is no supported path back to v1.',
      up: (v1Data: z.infer<typeof sealsFileSchemaV1>): z.infer<typeof sealsFileSchemaV2> => ({
        version: 2,
        // Seals bind artifact content, not storage location; relocating them
        // from a monolith to per-seal files carries every seal through verbatim.
        seals: v1Data.seals,
      }),
    },
  ],
})

/**
 * Validate and migrate a raw parsed seals document (from a legacy monolithic
 * file) to the current aggregate shape (v2).
 *
 * Accepts either a v1 (`version: 1`) or already-v2 (`version: 2`) document and
 * normalizes it to v2, running the same version/validation rules the live
 * loader uses. Throws a descriptive error on an unsupported version or a
 * document that fails schema validation.
 *
 * @param raw - The parsed monolithic seals document.
 * @param source - Path of the source file, for error messages.
 * @returns The migrated v2 aggregate `{ version: 2, seals }`.
 * @public
 */
export function migrateSealsDocumentToCurrent(
  raw: unknown,
  source: string,
): z.infer<typeof sealsFileSchemaV2> {
  // Reject unsupported versions with a precise message before schema validation.
  if (typeof raw === 'object' && raw !== null && 'version' in raw) {
    const withVersion: { version: unknown } = raw
    const version = withVersion.version
    if (version !== 1 && version !== '1' && version !== 2 && version !== '2') {
      throw new Error(`Unsupported seals file version: ${String(version)}`)
    }
  }

  const asV2 = sealsFileSchemaV2.safeParse(raw)
  if (asV2.success) {
    return asV2.data
  }

  const asV1 = sealsFileSchemaV1.safeParse(raw)
  if (!asV1.success) {
    const errors = asV1.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join(', ')
    throw new Error(`Failed to read seals file '${source}': Validation failed: ${errors}`)
  }
  return { version: 2, seals: asV1.data.seals }
}

/**
 * Type alias for seals file v1.
 * @public
 */
export type SealsFileV1 = z.infer<typeof sealsFileSchemaV1>

/**
 * Union of all seals file versions.
 * @public
 */
export type SealsFileVersions = SealsFileV1 | z.infer<typeof sealsFileSchemaV2>

// Re-export the Zod schemas for use in generate-schemas / storage.ts.
export { sealsFileSchemaV1, sealSchemaV1 }
