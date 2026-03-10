/**
 * Shared Zod schemas used by both policy and operational configuration.
 *
 * ============================================================================
 * IMPORTANT: DOCUMENTATION SYNC REQUIRED
 * ============================================================================
 * When modifying any schema in this file, you MUST also update:
 *
 * 1. README.md - Update the "Configuration" section's quick example
 * 2. docs/configuration.md - Update the comprehensive configuration reference
 * 3. Run `pnpm --filter @attest-it/core generate:schemas` to regenerate JSON schemas
 *
 * The configuration format is a key part of the user experience. Any schema
 * changes should be reflected in user-facing documentation.
 * ============================================================================
 */

import ms from 'ms'
import { z } from 'zod'

/**
 * Zod schema for semantic version strings.
 *
 * Validates semantic version format: MAJOR.MINOR.PATCH with optional
 * prerelease and build metadata (e.g., "1.0.0", "2.1.0-beta.1", "1.0.0+build.123").
 *
 * Used primarily for the `minVersion` configuration field to ensure
 * configuration files specify valid version requirements.
 *
 * @public
 * @see {@link checkVersionCompatibility} for version checking logic
 */
export const semverSchema = z
  .string()
  .regex(
    /^\d+\.\d+\.\d+(-[\w.]+)?(\+[\w.]+)?$/,
    'Must be a valid semver version (e.g., "0.8.0", "1.0.0-beta.1")',
  )

/**
 * Zod schema for a team member configuration.
 * @public
 */
export const teamMemberSchema = z
  .object({
    name: z.string().min(1, 'Team member name cannot be empty'),
    email: z.string().email().optional(),
    github: z.string().min(1).optional(),
    publicKey: z.string().min(1, 'Public key is required'),
    publicKeyAlgorithm: z.literal('ed25519').optional(),
  })
  .strict()

/**
 * Zod schema for fingerprint configuration.
 * @public
 */
export const fingerprintConfigSchema = z
  .object({
    paths: z
      .array(z.string().min(1, 'Path cannot be empty'))
      .min(1, 'At least one path is required'),
    exclude: z.array(z.string().min(1, 'Exclude pattern cannot be empty')).optional(),
  })
  .strict()

/**
 * Zod schema for duration strings.
 * Validates and parses duration strings like "30d", "7d", "24h".
 * @public
 */
export const durationSchema = z.string().refine(
  (val) => {
    try {
      // Type assertion needed because ms has strict StringValue type
      // We validate the result is a positive number below
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument, @typescript-eslint/consistent-type-assertions
      const parsed = ms(val as any)
      return typeof parsed === 'number' && parsed > 0
    } catch {
      return false
    }
  },
  {
    message: 'Duration must be a valid duration string (e.g., "30d", "7d", "24h")',
  },
)

/**
 * Zod schema for a gate configuration.
 * @public
 */
export const gateSchema = z
  .object({
    name: z.string().min(1, 'Gate name cannot be empty'),
    description: z.string().min(1, 'Gate description cannot be empty'),
    authorizedSigners: z.array(z.string().min(1, 'Authorized signer slug cannot be empty')),
    fingerprint: fingerprintConfigSchema,
    maxAge: durationSchema,
  })
  .strict()

/**
 * Zod schema for key provider configuration options.
 * @public
 */
export const keyProviderOptionsSchema = z
  .object({
    privateKeyPath: z.string().optional(),
    account: z.string().optional(),
    vault: z.string().optional(),
    itemName: z.string().optional(),
  })
  .passthrough()

/**
 * Zod schema for key provider configuration.
 * @public
 */
export const keyProviderSchema = z
  .object({
    type: z.enum(['filesystem', '1password']).or(z.string()),
    options: keyProviderOptionsSchema.optional(),
  })
  .strict()
