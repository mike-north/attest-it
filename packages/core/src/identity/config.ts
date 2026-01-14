/**
 * Configuration loading for local identity system.
 * @packageDocumentation
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { mkdir as mkdirAsync, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import { z } from 'zod'
import type { Identity, LocalConfig, PrivateKeyRef } from './types.js'

/**
 * Zod schema for private key references.
 */
const privateKeyRefSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('file'),
    path: z.string().min(1, 'File path cannot be empty'),
  }),
  z.object({
    type: z.literal('keychain'),
    service: z.string().min(1, 'Service name cannot be empty'),
    account: z.string().min(1, 'Account name cannot be empty'),
  }),
  z.object({
    type: z.literal('1password'),
    account: z.string().optional(),
    vault: z.string().min(1, 'Vault name cannot be empty'),
    item: z.string().min(1, 'Item name cannot be empty'),
    field: z.string().optional(),
  }),
])

/**
 * Zod schema for a single identity.
 */
const identitySchema = z
  .object({
    name: z.string().min(1, 'Identity name cannot be empty'),
    email: z.string().optional(),
    github: z.string().optional(),
    publicKey: z.string().min(1, 'Public key cannot be empty'),
    privateKey: privateKeyRefSchema,
  })
  .strict()

/**
 * Zod schema for the local config file.
 */
const localConfigSchema = z
  .object({
    activeIdentity: z.string().min(1, 'Active identity name cannot be empty'),
    identities: z.record(z.string(), identitySchema).refine(
      (identities) => Object.keys(identities).length >= 1,
      {
        message: 'At least one identity must be defined',
      },
    ),
  })
  .strict()

/**
 * Error thrown when local config validation fails.
 * @public
 */
export class LocalConfigValidationError extends Error {
  constructor(
    message: string,
    public readonly issues: z.ZodIssue[],
  ) {
    super(message)
    this.name = 'LocalConfigValidationError'
  }
}

/**
 * Get the path to the local config file.
 *
 * @returns Path to ~/.config/attest-it/config.yaml
 * @public
 */
export function getLocalConfigPath(): string {
  const home = homedir()
  return join(home, '.config', 'attest-it', 'config.yaml')
}

/**
 * Parse and validate local config content.
 *
 * @param content - YAML content to parse
 * @returns Validated LocalConfig object
 * @throws {LocalConfigValidationError} If validation fails
 */
function parseLocalConfigContent(content: string): LocalConfig {
  let rawConfig: unknown

  try {
    rawConfig = parseYaml(content)
  } catch (error) {
    throw new LocalConfigValidationError(
      `Failed to parse YAML: ${error instanceof Error ? error.message : String(error)}`,
      [],
    )
  }

  const result = localConfigSchema.safeParse(rawConfig)

  if (!result.success) {
    throw new LocalConfigValidationError(
      'Local configuration validation failed:\n' +
        result.error.issues
          .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
          .join('\n'),
      result.error.issues,
    )
  }

  // Transform Zod output to match LocalConfig interface by removing undefined values
  const identities: Record<string, Identity> = Object.fromEntries(
    Object.entries(result.data.identities).map(([key, identity]) => {
      // Transform private key ref to remove undefined optional fields
      let privateKey: PrivateKeyRef
      if (identity.privateKey.type === '1password') {
        privateKey = {
          type: '1password',
          vault: identity.privateKey.vault,
          item: identity.privateKey.item,
          ...(identity.privateKey.account !== undefined && { account: identity.privateKey.account }),
          ...(identity.privateKey.field !== undefined && { field: identity.privateKey.field }),
        }
      } else {
        privateKey = identity.privateKey
      }

      return [
        key,
        {
          name: identity.name,
          publicKey: identity.publicKey,
          privateKey,
          ...(identity.email !== undefined && { email: identity.email }),
          ...(identity.github !== undefined && { github: identity.github }),
        },
      ]
    }),
  )

  return {
    activeIdentity: result.data.activeIdentity,
    identities,
  }
}

/**
 * Load and validate local config from file (async).
 *
 * @param configPath - Optional path to config file. If not provided, uses default location.
 * @returns Validated LocalConfig object, or null if file does not exist
 * @throws {LocalConfigValidationError} If validation fails
 * @public
 */
export async function loadLocalConfig(configPath?: string): Promise<LocalConfig | null> {
  const resolvedPath = configPath ?? getLocalConfigPath()

  try {
    const content = await readFile(resolvedPath, 'utf8')
    return parseLocalConfigContent(content)
  } catch (error) {
    if (error instanceof LocalConfigValidationError) {
      throw error
    }
    // Check if it's a file not found error
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      (error.code === 'ENOENT' || error.code === 'ENOTDIR')
    ) {
      return null
    }
    // Re-throw other errors
    throw error
  }
}

/**
 * Load and validate local config from file (sync).
 *
 * @param configPath - Optional path to config file. If not provided, uses default location.
 * @returns Validated LocalConfig object, or null if file does not exist
 * @throws {LocalConfigValidationError} If validation fails
 * @public
 */
export function loadLocalConfigSync(configPath?: string): LocalConfig | null {
  const resolvedPath = configPath ?? getLocalConfigPath()

  try {
    const content = readFileSync(resolvedPath, 'utf8')
    return parseLocalConfigContent(content)
  } catch (error) {
    if (error instanceof LocalConfigValidationError) {
      throw error
    }
    // Check if it's a file not found error
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      (error.code === 'ENOENT' || error.code === 'ENOTDIR')
    ) {
      return null
    }
    // Re-throw other errors
    throw error
  }
}

/**
 * Save local config to file (async).
 *
 * @param config - LocalConfig object to save
 * @param configPath - Optional path to config file. If not provided, uses default location.
 * @throws {Error} If write fails
 * @public
 */
export async function saveLocalConfig(config: LocalConfig, configPath?: string): Promise<void> {
  const resolvedPath = configPath ?? getLocalConfigPath()
  const content = stringifyYaml(config)

  // Ensure parent directory exists
  const dir = dirname(resolvedPath)
  await mkdirAsync(dir, { recursive: true })

  await writeFile(resolvedPath, content, 'utf8')
}

/**
 * Save local config to file (sync).
 *
 * @param config - LocalConfig object to save
 * @param configPath - Optional path to config file. If not provided, uses default location.
 * @throws {Error} If write fails
 * @public
 */
export function saveLocalConfigSync(config: LocalConfig, configPath?: string): void {
  const resolvedPath = configPath ?? getLocalConfigPath()
  const content = stringifyYaml(config)

  // Ensure parent directory exists
  const dir = dirname(resolvedPath)
  mkdirSync(dir, { recursive: true })

  writeFileSync(resolvedPath, content, 'utf8')
}

/**
 * Get the active identity from a config.
 *
 * @param config - LocalConfig object
 * @returns The active Identity, or undefined if not found
 * @public
 */
export function getActiveIdentity(config: LocalConfig): Identity | undefined {
  return config.identities[config.activeIdentity]
}
