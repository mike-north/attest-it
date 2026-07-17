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

// ─── V1 schemas ──────────────────────────────────────────────────────────────

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

// ─── V2 schemas ──────────────────────────────────────────────────────────────

/**
 * Zod schema for private key references (v2).
 *
 * V2 uses flat VaultKeeper-style IDs. Provider-specific details are managed
 * by VaultKeeper's own configuration. The `filesystem` variant is a legacy
 * fallback retained for backwards compatibility during migration.
 *
 * @internal
 */
const privateKeyRefSchemaV2 = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('file'),
    id: z.string().min(1, 'Secret ID cannot be empty'),
  }),
  z.object({
    type: z.literal('keychain'),
    id: z.string().min(1, 'Secret ID cannot be empty'),
  }),
  z.object({
    type: z.literal('1password'),
    id: z.string().min(1, 'Secret ID cannot be empty'),
    vault: z.string().optional(),
  }),
  z.object({
    type: z.literal('yubikey'),
    id: z.string().min(1, 'Secret ID cannot be empty'),
  }),
  z.object({
    type: z.literal('filesystem'),
    path: z.string().min(1, 'Filesystem path cannot be empty'),
  }),
])

/**
 * Zod schema for a single identity (v2).
 * @internal
 */
const identitySchemaV2 = z
  .object({
    name: z.string().min(1, 'Identity name cannot be empty'),
    email: z.string().optional(),
    github: z.string().optional(),
    publicKey: z.string().min(1, 'Public key cannot be empty'),
    privateKey: privateKeyRefSchemaV2,
  })
  .strict()

/**
 * Zod schema for the local config file (v2).
 * @internal
 */
const localConfigSchemaV2 = z
  .object({
    version: z.literal(2),
    activeIdentity: z.string().min(1, 'Active identity name cannot be empty'),
    identities: z
      .record(z.string(), identitySchemaV2)
      .refine((identities) => Object.keys(identities).length >= 1, {
        message: 'At least one identity must be defined',
      }),
  })
  .strict()

// ─── Migrex versioned schemas ────────────────────────────────────────────────

/**
 * Migrex versioned schema for identity config v1.
 * @internal
 */
const schemaV1 = fromZod('1', localConfigSchemaV1)

/**
 * Migrex versioned schema for identity config v2.
 * @internal
 */
const schemaV2 = fromZod('2', localConfigSchemaV2)

// ─── Migration graph ─────────────────────────────────────────────────────────

/**
 * Migrate a v1 private key ref to v2.
 *
 * The v1 format stored provider-specific details inline. The v2 format uses
 * flat VaultKeeper-style secret IDs. Since the v1 keys have not been moved to
 * VaultKeeper yet, we convert them to the legacy `filesystem` variant so they
 * continue to work without VaultKeeper intervention.
 *
 * @internal
 */
function migratePrivateKeyRefV1ToV2(
  v1: z.infer<typeof privateKeyRefSchemaV1>,
): z.infer<typeof privateKeyRefSchemaV2> {
  switch (v1.type) {
    case 'file':
      return { type: 'filesystem', path: v1.path }
    case 'keychain':
      // Cannot auto-generate a stable VaultKeeper ID without importing; preserve as filesystem ref
      return { type: 'filesystem', path: `keychain://${v1.service}/${v1.account}` }
    case '1password':
      return {
        type: 'filesystem',
        path: `1password://${v1.vault}/${v1.item}`,
      }
    case 'yubikey':
      return { type: 'filesystem', path: v1.encryptedKeyPath }
  }
}

/**
 * Migration graph for identity configuration.
 *
 * Uses integer versioning (1, 2, 3, ...) to match the simple version field.
 *
 * @public
 */
export const identityMigrationGraph = createMigrationGraph({
  id: 'attest-it-identity-config',
  versionStrategy: integerStrategy,
  schemas: [schemaV1, schemaV2],
  migrations: [
    {
      fromVersion: '1',
      toVersion: '2',
      irreversibleReason:
        'V1 private key refs lose provider-specific details when converted to the legacy filesystem fallback format. The original provider-specific fields (service, vault, item, etc.) cannot be fully recovered from the filesystem pseudo-URI paths.',
      up: (v1Data: z.infer<typeof localConfigSchemaV1>) => {
        const identities: Record<string, z.infer<typeof identitySchemaV2>> = {}
        for (const [key, identity] of Object.entries(v1Data.identities)) {
          identities[key] = {
            name: identity.name,
            publicKey: identity.publicKey,
            privateKey: migratePrivateKeyRefV1ToV2(identity.privateKey),
            ...(identity.email !== undefined && { email: identity.email }),
            ...(identity.github !== undefined && { github: identity.github }),
          }
        }
        return {
          version: 2 as const,
          activeIdentity: v1Data.activeIdentity,
          identities,
        }
      },
    },
  ],
})

/**
 * Type alias for identity config v1.
 * @public
 */
export type IdentityConfigV1 = z.infer<typeof localConfigSchemaV1>

/**
 * Type alias for identity config v2 (current version).
 * @public
 */
export type IdentityConfigV2 = z.infer<typeof localConfigSchemaV2>

/**
 * Union of all identity config versions.
 * @public
 */
export type IdentityConfigVersions = IdentityConfigV1 | IdentityConfigV2

// Re-export the Zod schemas for use in config.ts
export { localConfigSchemaV1, localConfigSchemaV2 }
