/**
 * Migration graph for identity configuration (~/.config/attest-it/config.yaml).
 *
 * The identity config stores user identities and their associated keys.
 * Historically, this config has not had a version field, so we treat
 * versionless files as version 1.
 *
 * @packageDocumentation
 */

import { createMigrationGraph, integerStrategy } from '@migrex/core'
import { fromZod } from '@migrex/zod'
import { z } from 'zod'

/**
 * Helper to create an optional version schema that accepts both number and string versions.
 * This allows migrex (which uses string versions internally) to work with our
 * numeric version fields while maintaining backward compatibility with versionless files.
 *
 * @param version - The expected version number
 * @returns A Zod schema that accepts number, string, or undefined versions
 * @internal
 */
function optionalVersionSchema<V extends number>(version: V) {
  return z
    .union([z.literal(version), z.literal(String(version)), z.undefined()])
    .transform((v) => (v === undefined ? undefined : version))
}

/**
 * Zod schema for private key references (v1).
 * @internal
 */
const privateKeyRefSchemaV1 = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('file'),
    path: z.string().min(1, 'File path cannot be empty'),
  }),
  z.object({
    type: z.literal('keychain'),
    service: z.string().min(1, 'Service name cannot be empty'),
    account: z.string().min(1, 'Account name cannot be empty'),
    keychain: z.string().optional(),
  }),
  z.object({
    type: z.literal('1password'),
    account: z.string().optional(),
    vault: z.string().min(1, 'Vault name cannot be empty'),
    item: z.string().min(1, 'Item name cannot be empty'),
    field: z.string().optional(),
  }),
  z.object({
    type: z.literal('yubikey'),
    encryptedKeyPath: z.string().min(1, 'Encrypted key path cannot be empty'),
    slot: z.union([z.literal(1), z.literal(2)]).optional(),
    serial: z.string().optional(),
  }),
])

/**
 * Zod schema for a single identity (v1).
 * @internal
 */
const identitySchemaV1 = z
  .object({
    name: z.string().min(1, 'Identity name cannot be empty'),
    email: z.string().optional(),
    github: z.string().optional(),
    publicKey: z.string().min(1, 'Public key cannot be empty'),
    privateKey: privateKeyRefSchemaV1,
  })
  .strict()

/**
 * Zod schema for the local config file (v1).
 *
 * Note: The version field is optional to support legacy files that don't have it.
 * Files without a version field are treated as v1.
 * @internal
 */
const localConfigSchemaV1 = z
  .object({
    version: optionalVersionSchema(1),
    activeIdentity: z.string().min(1, 'Active identity name cannot be empty'),
    identities: z
      .record(z.string(), identitySchemaV1)
      .refine((identities) => Object.keys(identities).length >= 1, {
        message: 'At least one identity must be defined',
      }),
  })
  .strict()

/**
 * Migrex versioned schema for identity config v1.
 * @internal
 */
const schemaV1 = fromZod('1', localConfigSchemaV1)

/**
 * Migration graph for identity configuration.
 *
 * Uses integer versioning (1, 2, 3, ...) to match the simple version: 1 field.
 *
 * @public
 */
export const identityMigrationGraph = createMigrationGraph({
  id: 'attest-it-identity-config',
  versionStrategy: integerStrategy,
  schemas: [schemaV1],
  migrations: [],
})

/**
 * Type alias for identity config versions.
 * @public
 */
export type IdentityConfigV1 = z.infer<typeof localConfigSchemaV1>

/**
 * Union of all identity config versions.
 * @public
 */
export type IdentityConfigVersions = IdentityConfigV1

// Re-export the Zod schemas for use in config.ts
export { localConfigSchemaV1, identitySchemaV1, privateKeyRefSchemaV1 }
