/**
 * Configuration loading for local identity system.
 * @packageDocumentation
 */

import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { mkdir as mkdirAsync, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import { z } from 'zod'
import type { Identity, LocalConfig, PrivateKeyRef } from './types.js'

/**
 * Module-level override for the attest-it home directory.
 * When set, this overrides the default ~/.config/attest-it location.
 * @internal
 */
let homeDirOverride: string | null = null

/**
 * Set a custom home directory for attest-it configuration.
 * This is useful for testing or running with isolated state.
 *
 * @param dir - The directory to use, or null to reset to default
 * @public
 */
export function setAttestItHomeDir(dir: string | null): void {
  homeDirOverride = dir
}

/**
 * Get the current attest-it home directory override.
 *
 * @returns The override directory, or null if using default
 * @public
 */
export function getAttestItHomeDir(): string | null {
  return homeDirOverride
}

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
    keychain: z.string().optional(),
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
    identities: z
      .record(z.string(), identitySchema)
      .refine((identities) => Object.keys(identities).length >= 1, {
        message: 'At least one identity must be defined',
      }),
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
 * If a home directory override is set via setAttestItHomeDir(),
 * returns {homeDir}/config.yaml. Otherwise returns ~/.config/attest-it/config.yaml.
 *
 * @returns Path to the local config file
 * @public
 */
export function getLocalConfigPath(): string {
  if (homeDirOverride) {
    return join(homeDirOverride, 'config.yaml')
  }
  const home = homedir()
  return join(home, '.config', 'attest-it', 'config.yaml')
}

/**
 * Get the attest-it configuration directory.
 *
 * If a home directory override is set via setAttestItHomeDir(),
 * returns that directory. Otherwise returns ~/.config/attest-it.
 *
 * @returns Path to the configuration directory
 * @public
 */
export function getAttestItConfigDir(): string {
  if (homeDirOverride) {
    return homeDirOverride
  }
  return join(homedir(), '.config', 'attest-it')
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
          ...(identity.privateKey.account !== undefined && {
            account: identity.privateKey.account,
          }),
          ...(identity.privateKey.field !== undefined && { field: identity.privateKey.field }),
        }
      } else if (identity.privateKey.type === 'keychain') {
        privateKey = {
          type: 'keychain',
          service: identity.privateKey.service,
          account: identity.privateKey.account,
          ...(identity.privateKey.keychain !== undefined && {
            keychain: identity.privateKey.keychain,
          }),
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
 * Schema reference header for identity config files.
 * This enables editor support (autocomplete, validation) in VS Code and other YAML-aware editors.
 */
const IDENTITY_SCHEMA_HEADER =
  '# yaml-language-server: $schema=https://raw.githubusercontent.com/mike-north/attest-it/main/schemas/v1/identity.schema.json\n'

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
  const yamlContent = stringifyYaml(config)
  const content = IDENTITY_SCHEMA_HEADER + yamlContent

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
  const yamlContent = stringifyYaml(config)
  const content = IDENTITY_SCHEMA_HEADER + yamlContent

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

/**
 * Get the user's home public keys directory.
 *
 * This returns ~/.attest-it/public-keys, which is different from the
 * config directory (~/.config/attest-it). The public keys directory
 * is designed to be easily shareable and discoverable.
 *
 * @returns Path to the user's home public keys directory
 * @public
 */
export function getHomePublicKeysDir(): string {
  if (homeDirOverride) {
    return join(homeDirOverride, 'public-keys')
  }
  return join(homedir(), '.attest-it', 'public-keys')
}

/**
 * Get the project public keys directory.
 *
 * @deprecated Public keys are now stored inline in the team section of config.yaml.
 * This function is kept for backward compatibility but should not be used in new code.
 *
 * @param projectRoot - The project root directory (defaults to cwd)
 * @returns Path to the project public keys directory
 * @public
 */
export function getProjectPublicKeysDir(projectRoot: string = process.cwd()): string {
  return join(projectRoot, '.attest-it', 'public-keys')
}

/**
 * Check if a project has attest-it configuration.
 *
 * @deprecated This function is kept for backward compatibility but is no longer used
 * by the core library. Public keys are now stored inline in config.yaml.
 *
 * @param projectRoot - The project root directory (defaults to cwd)
 * @returns True if the project has .attest-it/config.yaml or similar
 * @public
 */
export function hasProjectConfig(projectRoot: string = process.cwd()): boolean {
  const configDir = join(projectRoot, '.attest-it')
  const candidates = ['config.yaml', 'config.yml', 'config.json']
  return candidates.some((candidate) => existsSync(join(configDir, candidate)))
}

/**
 * Result from saving public keys.
 * @public
 */
export interface SavePublicKeyResult {
  /** Path where the key was saved in the user's home directory */
  homePath: string
  /** Path where the key was saved in the project directory, if applicable */
  projectPath?: string
}

/**
 * Save a public key to the user's home directory.
 *
 * This saves the public key as a base64-encoded string (matching the format in config.yaml)
 * to ~/.attest-it/public-keys/<slug>.pem for backup purposes.
 *
 * Public keys are now stored inline in the team section of config.yaml and no longer
 * written to the project directory.
 *
 * @param slug - The identity slug (used for the filename)
 * @param publicKey - The base64-encoded public key
 * @param projectRoot - The project root directory (deprecated, kept for backward compatibility)
 * @returns Paths where the key was saved
 * @public
 */
export async function savePublicKey(
  slug: string,
  publicKey: string,
  projectRoot: string = process.cwd(),
): Promise<SavePublicKeyResult> {
  // projectRoot parameter is kept for backward compatibility but is no longer used
  void projectRoot

  const result: SavePublicKeyResult = {
    homePath: '',
  }

  // Save to user's home directory (~/.attest-it/public-keys/<slug>.pem)
  const homeDir = getHomePublicKeysDir()
  await mkdirAsync(homeDir, { recursive: true })
  const homePath = join(homeDir, `${slug}.pem`)
  await writeFile(homePath, publicKey, 'utf8')
  result.homePath = homePath

  // No longer write to project directory
  // Public keys are now stored inline in the team section of config.yaml

  return result
}

/**
 * Save a public key to the user's home directory (sync).
 *
 * This saves the public key as a base64-encoded string (matching the format in config.yaml)
 * to ~/.attest-it/public-keys/<slug>.pem for backup purposes.
 *
 * Public keys are now stored inline in the team section of config.yaml and no longer
 * written to the project directory.
 *
 * @param slug - The identity slug (used for the filename)
 * @param publicKey - The base64-encoded public key
 * @param projectRoot - The project root directory (deprecated, kept for backward compatibility)
 * @returns Paths where the key was saved
 * @public
 */
export function savePublicKeySync(
  slug: string,
  publicKey: string,
  projectRoot: string = process.cwd(),
): SavePublicKeyResult {
  // projectRoot parameter is kept for backward compatibility but is no longer used
  void projectRoot

  const result: SavePublicKeyResult = {
    homePath: '',
  }

  // Save to user's home directory (~/.attest-it/public-keys/<slug>.pem)
  const homeDir = getHomePublicKeysDir()
  mkdirSync(homeDir, { recursive: true })
  const homePath = join(homeDir, `${slug}.pem`)
  writeFileSync(homePath, publicKey, 'utf8')
  result.homePath = homePath

  // No longer write to project directory
  // Public keys are now stored inline in the team section of config.yaml

  return result
}
