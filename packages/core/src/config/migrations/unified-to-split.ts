/**
 * One-shot migration from the retired unified configuration format to the
 * canonical split configuration (policy + operational).
 *
 * The unified `.attest-it/config.yaml` format bundled trust-critical data
 * (team, gates, security settings) together with operational data (suites,
 * command execution settings) in a single file. That format is retired: the
 * loader no longer accepts it. This module is the only remaining reader of the
 * unified shape, and it exists solely to migrate an existing unified file into
 * the split `policy.yaml` + operational `config.yaml` pair.
 *
 * It reuses the canonical policy and operational schemas (the migrex-backed
 * `policySchemaV1` / `operationalSchemaV1`) to validate the split output, so a
 * migrated repository is guaranteed to load under the current rules.
 *
 * @packageDocumentation
 */

import { parse as parseYaml } from 'yaml'
import { z } from 'zod'
import { gateSchema, keyProviderSchema, semverSchema, teamMemberSchema } from '../shared-schemas.js'
import type { PolicyConfig } from '../policy-schema.js'
import type { OperationalConfig } from '../operational-schema.js'
import { policySchemaV1, operationalSchemaV1 } from './index.js'

/**
 * Zod schema for the retired unified suite shape.
 *
 * A gate reference is required — the insecure gate-less (`packages`-only) suite
 * shape is not resurrected here. A unified config that still contains such a
 * suite cannot be migrated automatically and must be fixed by hand first.
 *
 * @internal
 */
const unifiedSuiteSchema = z
  .object({
    gate: z.string().min(1, 'Gate reference cannot be empty'),
    description: z.string().optional(),
    command: z.string().optional(),
    timeout: z.string().optional(),
    interactive: z.boolean().optional(),
    invalidates: z.array(z.string().min(1)).optional(),
    depends_on: z.array(z.string().min(1)).optional(),
  })
  .strict()

/**
 * Zod schema for the retired unified settings block. Combines security settings
 * (which move to policy) with operational settings (which move to operational).
 *
 * @internal
 */
const unifiedSettingsSchema = z
  .object({
    maxAgeDays: z.number().int().positive().default(30),
    publicKeyPath: z.string().default('.attest-it/pubkey.pem'),
    attestationsPath: z.string().default('.attest-it/attestations.json'),
    sealsPath: z.string().default('.attest-it/seals.json'),
    defaultCommand: z.string().optional(),
    keyProvider: keyProviderSchema.optional(),
  })
  .passthrough()

/**
 * Zod schema for the retired unified configuration file.
 *
 * @internal
 */
const unifiedConfigSchema = z
  .object({
    version: z.literal(1),
    minVersion: semverSchema.optional(),
    settings: unifiedSettingsSchema.default({}),
    team: z.record(z.string(), teamMemberSchema).optional(),
    gates: z.record(z.string(), gateSchema).optional(),
    suites: z
      .record(z.string(), unifiedSuiteSchema)
      .refine((suites) => Object.keys(suites).length >= 1, {
        message: 'At least one suite must be defined',
      }),
    groups: z.record(z.string(), z.array(z.string().min(1))).optional(),
  })
  .strict()

/**
 * The split configuration produced by migration.
 * @public
 */
export interface SplitConfigResult {
  /** Trust-critical policy configuration destined for `.attest-it/policy.yaml`. */
  policy: PolicyConfig
  /** Operational configuration destined for `.attest-it/config.yaml`. */
  operational: OperationalConfig
}

/**
 * Error thrown when a unified configuration cannot be migrated to split form.
 * @public
 */
export class UnifiedMigrationError extends Error {
  constructor(
    message: string,
    public readonly issues: z.ZodIssue[] = [],
  ) {
    super(message)
    this.name = 'UnifiedMigrationError'
  }
}

/**
 * Migrate a raw unified configuration document into split policy + operational
 * configurations.
 *
 * @param raw - The parsed unified configuration object (e.g. from YAML/JSON).
 * @returns The validated split policy and operational configurations.
 * @throws {@link UnifiedMigrationError} If the input is not a valid unified config,
 *   or the resulting split configuration fails validation.
 * @public
 */
export function migrateUnifiedConfig(raw: unknown): SplitConfigResult {
  const parsed = unifiedConfigSchema.safeParse(raw)
  if (!parsed.success) {
    throw new UnifiedMigrationError(
      'Unified configuration is not valid and cannot be migrated:\n' +
        parsed.error.issues
          .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
          .join('\n'),
      parsed.error.issues,
    )
  }

  const unified = parsed.data

  // Security-critical settings live in policy; operational settings live in
  // the operational config. Split the unified settings block accordingly.
  const policyDraft: Record<string, unknown> = {
    version: 1,
    settings: {
      maxAgeDays: unified.settings.maxAgeDays,
      publicKeyPath: unified.settings.publicKeyPath,
      attestationsPath: unified.settings.attestationsPath,
      sealsPath: unified.settings.sealsPath,
    },
  }
  if (unified.minVersion !== undefined) policyDraft.minVersion = unified.minVersion
  if (unified.team !== undefined) policyDraft.team = unified.team
  if (unified.gates !== undefined) policyDraft.gates = unified.gates

  const operationalSettings: Record<string, unknown> = {}
  if (unified.settings.defaultCommand !== undefined) {
    operationalSettings.defaultCommand = unified.settings.defaultCommand
  }
  if (unified.settings.keyProvider !== undefined) {
    operationalSettings.keyProvider = unified.settings.keyProvider
  }

  const operationalDraft: Record<string, unknown> = {
    version: 1,
    settings: operationalSettings,
    suites: unified.suites,
  }
  if (unified.minVersion !== undefined) operationalDraft.minVersion = unified.minVersion
  if (unified.groups !== undefined) operationalDraft.groups = unified.groups

  const policyResult = policySchemaV1.safeParse(policyDraft)
  if (!policyResult.success) {
    throw new UnifiedMigrationError(
      'Migrated policy configuration failed validation:\n' +
        policyResult.error.issues
          .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
          .join('\n'),
      policyResult.error.issues,
    )
  }

  const operationalResult = operationalSchemaV1.safeParse(operationalDraft)
  if (!operationalResult.success) {
    throw new UnifiedMigrationError(
      'Migrated operational configuration failed validation:\n' +
        operationalResult.error.issues
          .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
          .join('\n'),
      operationalResult.error.issues,
    )
  }

  return { policy: policyResult.data, operational: operationalResult.data }
}

/**
 * Parse and migrate unified configuration content from a string.
 *
 * @param content - The unified configuration file content.
 * @param format - The format of the content ('yaml' or 'json').
 * @returns The validated split policy and operational configurations.
 * @throws {@link UnifiedMigrationError} If parsing or migration fails.
 * @public
 */
export function migrateUnifiedContent(content: string, format: 'yaml' | 'json'): SplitConfigResult {
  let raw: unknown
  try {
    raw = format === 'yaml' ? parseYaml(content) : JSON.parse(content)
  } catch (error) {
    throw new UnifiedMigrationError(
      `Failed to parse ${format.toUpperCase()}: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  return migrateUnifiedConfig(raw)
}
