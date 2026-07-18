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
import { durationSchema, gateSchema, semverSchema, teamMemberSchema } from '../shared-schemas.js'

/**
 * Reserved gate identifier for the root gate over `.attest-it/policy.yaml`.
 *
 * This slug is intentionally not usable as a normal gate id (the policy schema
 * rejects it in `gates`), so a pull request cannot define an ordinary gate
 * named `__root__` and have it treated as the trust anchor. The root gate's
 * identity comes solely from the top-level `rootGate` section.
 *
 * @public
 */
export const ROOT_GATE_ID = '__root__'

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
 * Zod schema for policy settings (v1).
 * @internal
 */
const policySettingsSchemaV1 = z
  .object({
    maxAgeDays: z.number().int().positive().default(30),
    publicKeyPath: z.string().default('.attest-it/pubkey.pem'),
    attestationsPath: z.string().default('.attest-it/attestations.json'),
    sealsPath: z.string().default('.attest-it/seals/'),
  })
  .strict()

/**
 * Zod schema for the reserved root gate (v1).
 *
 * Unlike an ordinary gate, the root gate has no user-configurable `fingerprint`:
 * the artifact it covers is always the policy file itself. Omitting the
 * fingerprint from the schema is a security property — a branch cannot repoint
 * the root gate at empty or unrelated content.
 * @internal
 */
const rootGateSchemaV1 = z
  .object({
    authorizedSigners: z
      .array(z.string().min(1, 'Root-gate signer slug cannot be empty'))
      .min(1, 'The root gate requires at least one authorized signer'),
    maxAge: durationSchema.default('365d'),
    description: z.string().min(1, 'Root gate description cannot be empty').optional(),
  })
  .strict()

/**
 * Key schema for the `gates` record: an ordinary gate slug may never be the
 * reserved root-gate id.
 *
 * The reservation is enforced here — on the record KEY within the object schema
 * itself — rather than only via a wrapping `superRefine`. This is what keeps the
 * guard from silently dropping on any validation path: both the refined
 * {@link policySchemaV1} used by the live loader AND the bare object schema
 * registered in the migrex migration graph share this exact key constraint, so a
 * future validation through the graph cannot bypass it. A branch therefore cannot
 * define an ordinary gate named `__root__` and have it treated as the trust anchor.
 * @internal
 */
const ordinaryGateSlugSchemaV1 = z.string().refine((slug) => slug !== ROOT_GATE_ID, {
  message: `'${ROOT_GATE_ID}' is a reserved gate id for the root gate and cannot be used as an ordinary gate. Use the top-level 'rootGate' section instead.`,
})

/**
 * Base object schema for the policy configuration file (v1).
 *
 * Kept as a bare `ZodObject` (no wrapping effects) so the migrex `fromZod`
 * adapter, which expects an object schema, can consume it. The reserved-slug
 * guard lives on the `gates` record key ({@link ordinaryGateSlugSchemaV1}), so it
 * holds identically here and in {@link policySchemaV1}.
 * @internal
 */
const policyObjectSchemaV1 = z
  .object({
    version: versionSchema(1),
    minVersion: semverSchema.optional(),
    settings: policySettingsSchemaV1.default({}),
    rootGate: rootGateSchemaV1.optional(),
    team: z.record(z.string(), teamMemberSchema).optional(),
    gates: z.record(ordinaryGateSlugSchemaV1, gateSchema).optional(),
  })
  .strict()

/**
 * Zod schema for the policy configuration file (v1).
 *
 * Identical validation to {@link policyObjectSchemaV1} — the reserved-slug guard
 * is enforced on the record key in the object schema itself, so no additional
 * refinement is required. Exported separately to preserve the historical name.
 * @internal
 */
const policySchemaV1 = policyObjectSchemaV1

/**
 * Migrex versioned schema for policy config v1.
 *
 * Uses the same object schema the live loader validates against, so the
 * reserved-slug reservation cannot diverge between the two paths.
 * @internal
 */
const schemaV1 = fromZod('1', policyObjectSchemaV1)

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
export { policySchemaV1 }
