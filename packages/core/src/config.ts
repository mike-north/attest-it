/**
 * Configuration loading and validation for attest-it.
 */

import { readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import ms from 'ms'
import { parse as parseYaml } from 'yaml'
import { z } from 'zod'
import { semverSchema } from './config/shared-schemas.js'
import { checkVersionCompatibility, VersionIncompatibleError } from './version.js'

/**
 * Zod schema for key provider configuration.
 */
const keyProviderOptionsSchema = z
  .object({
    privateKeyPath: z.string().optional(),
    account: z.string().optional(),
    vault: z.string().optional(),
    itemName: z.string().optional(),
  })
  .strict()

const keyProviderSchema = z
  .object({
    type: z.enum(['filesystem', '1password']).or(z.string()),
    options: keyProviderOptionsSchema.optional(),
  })
  .strict()

/**
 * Zod schema for a team member configuration.
 */
const teamMemberSchema = z
  .object({
    name: z.string().min(1, 'Team member name cannot be empty'),
    email: z.string().email().optional(),
    github: z.string().min(1).optional(),
    publicKey: z.string().min(1, 'Public key is required'),
    publicKeyAlgorithm: z.enum(['ed25519']).optional(),
  })
  .strict()

/**
 * Zod schema for fingerprint configuration.
 */
const fingerprintConfigSchema = z
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
 */
const durationSchema = z.string().refine(
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
 */
const gateSchema = z
  .object({
    name: z.string().min(1, 'Gate name cannot be empty'),
    description: z.string().min(1, 'Gate description cannot be empty'),
    authorizedSigners: z.array(z.string().min(1, 'Authorized signer slug cannot be empty')),
    fingerprint: fingerprintConfigSchema,
    maxAge: durationSchema,
  })
  .strict()

/**
 * Zod schema for settings with defaults applied.
 */
const settingsSchema = z
  .object({
    maxAgeDays: z.number().int().positive().default(30),
    publicKeyPath: z.string().default('.attest-it/pubkey.pem'),
    attestationsPath: z.string().default('.attest-it/attestations.json'),
    sealsPath: z.string().default('.attest-it/seals.json'),
    defaultCommand: z.string().optional(),
    keyProvider: keyProviderSchema.optional(),
    // Note: algorithm field was removed - RSA is the only supported algorithm
  })
  .passthrough()

/**
 * Zod schema for a suite configuration.
 * Suites are CLI-layer extensions of gates with command execution capabilities.
 */
const suiteSchema = z
  .object({
    gate: z.string().min(1, 'Gate reference cannot be empty'),
    description: z.string().optional(),
    command: z.string().optional(),
    timeout: z.string().optional(),
    interactive: z.boolean().optional(),
    invalidates: z.array(z.string().min(1, 'Invalidated suite name cannot be empty')).optional(),
    depends_on: z.array(z.string().min(1, 'Dependency suite name cannot be empty')).optional(),
  })
  .strict()

/**
 * Zod schema for the full configuration file.
 * @public
 */
export const configSchema = z
  .object({
    version: z.literal(1),
    minVersion: semverSchema.optional(),
    settings: settingsSchema.default({}),
    team: z.record(z.string(), teamMemberSchema).optional(),
    gates: z.record(z.string(), gateSchema).optional(),
    suites: z.record(z.string(), suiteSchema).refine((suites) => Object.keys(suites).length >= 1, {
      message: 'At least one suite must be defined',
    }),
    groups: z
      .record(z.string(), z.array(z.string().min(1, 'Suite name in group cannot be empty')))
      .optional(),
  })
  .strict()

/**
 * Type inference from Zod schema (should match AttestItConfig).
 * This is the same as AttestItConfig but with defaults applied.
 * @public
 */
export type Config = z.infer<typeof configSchema>

/**
 * Error thrown when configuration is invalid.
 * @public
 */
export class ConfigValidationError extends Error {
  constructor(
    message: string,
    public readonly issues: z.ZodIssue[],
  ) {
    super(message)
    this.name = 'ConfigValidationError'
  }
}

/**
 * Error thrown when configuration file cannot be found.
 * @public
 */
export class ConfigNotFoundError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConfigNotFoundError'
  }
}

/**
 * Parse configuration content from a string.
 *
 * @param content - The configuration file content
 * @param format - The format of the content ('yaml' or 'json')
 * @returns Parsed and validated configuration
 * @throws {ConfigValidationError} If validation fails
 */
function parseConfigContent(content: string, format: 'yaml' | 'json'): Config {
  let rawConfig: unknown

  try {
    if (format === 'yaml') {
      rawConfig = parseYaml(content)
    } else {
      rawConfig = JSON.parse(content)
    }
  } catch (error) {
    throw new ConfigValidationError(
      `Failed to parse ${format.toUpperCase()}: ${error instanceof Error ? error.message : String(error)}`,
      [],
    )
  }

  const result = configSchema.safeParse(rawConfig)

  if (!result.success) {
    throw new ConfigValidationError(
      'Configuration validation failed:\n' +
        result.error.issues
          .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
          .join('\n'),
      result.error.issues,
    )
  }

  // Check version compatibility if minVersion is specified
  if (result.data.minVersion !== undefined) {
    checkVersionCompatibility(result.data.minVersion)
  }

  return result.data
}

/**
 * Determine the format of a config file from its extension.
 *
 * @param filePath - Path to the config file
 * @returns 'yaml' or 'json'
 */
function getConfigFormat(filePath: string): 'yaml' | 'json' {
  const ext = filePath.toLowerCase()
  if (ext.endsWith('.yaml') || ext.endsWith('.yml')) {
    return 'yaml'
  }
  if (ext.endsWith('.json')) {
    return 'json'
  }
  // Default to yaml for extensionless files
  return 'yaml'
}

/**
 * Find the configuration file in default locations.
 *
 * Searches in this order:
 * 1. .attest-it/config.yaml
 * 2. .attest-it/config.yml
 * 3. .attest-it/config.json
 *
 * @param startDir - Directory to start searching from (defaults to cwd)
 * @returns Absolute path to the config file, or null if not found
 * @public
 */
export function findConfigPath(startDir: string = process.cwd()): string | null {
  const configDir = join(startDir, '.attest-it')
  const candidates = ['config.yaml', 'config.yml', 'config.json']

  for (const candidate of candidates) {
    const configPath = join(configDir, candidate)
    try {
      readFileSync(configPath, 'utf8')
      return configPath
    } catch {
      // File doesn't exist or can't be read, try next candidate
      continue
    }
  }

  return null
}

/**
 * Load and validate configuration from a file (async).
 *
 * @param configPath - Optional path to config file. If not provided, searches default locations.
 * @returns Validated configuration object
 * @throws {@link ConfigNotFoundError} If config file cannot be found
 * @throws {@link ConfigValidationError} If validation fails
 * @throws {@link VersionIncompatibleError} If config requires newer attest-it version
 * @public
 */
export async function loadConfig(configPath?: string): Promise<Config> {
  const resolvedPath = configPath ?? findConfigPath()

  if (!resolvedPath) {
    throw new ConfigNotFoundError(
      'Configuration file not found. Expected .attest-it/config.yaml, .attest-it/config.yml, or .attest-it/config.json',
    )
  }

  try {
    const content = await readFile(resolvedPath, 'utf8')
    const format = getConfigFormat(resolvedPath)
    return parseConfigContent(content, format)
  } catch (error) {
    if (error instanceof ConfigValidationError || error instanceof VersionIncompatibleError) {
      throw error
    }
    throw new ConfigNotFoundError(
      `Failed to read configuration file at ${resolvedPath}: ${String(error)}`,
    )
  }
}

/**
 * Load and validate configuration from a file (sync).
 *
 * @param configPath - Optional path to config file. If not provided, searches default locations.
 * @returns Validated configuration object
 * @throws {@link ConfigNotFoundError} If config file cannot be found
 * @throws {@link ConfigValidationError} If validation fails
 * @throws {@link VersionIncompatibleError} If config requires newer attest-it version
 * @public
 */
export function loadConfigSync(configPath?: string): Config {
  const resolvedPath = configPath ?? findConfigPath()

  if (!resolvedPath) {
    throw new ConfigNotFoundError(
      'Configuration file not found. Expected .attest-it/config.yaml, .attest-it/config.yml, or .attest-it/config.json',
    )
  }

  try {
    const content = readFileSync(resolvedPath, 'utf8')
    const format = getConfigFormat(resolvedPath)
    return parseConfigContent(content, format)
  } catch (error) {
    if (error instanceof ConfigValidationError || error instanceof VersionIncompatibleError) {
      throw error
    }
    throw new ConfigNotFoundError(
      `Failed to read configuration file at ${resolvedPath}: ${String(error)}`,
    )
  }
}

/**
 * Resolve relative paths in the configuration against the repository root.
 *
 * This converts relative paths in settings.publicKeyPath and settings.attestationsPath
 * to absolute paths relative to the repository root.
 *
 * @param config - The configuration object
 * @param repoRoot - Absolute path to the repository root
 * @returns Configuration with resolved absolute paths
 * @public
 */
export function resolveConfigPaths(config: Config, repoRoot: string): Config {
  return {
    ...config,
    settings: {
      ...config.settings,
      publicKeyPath: resolve(repoRoot, config.settings.publicKeyPath),
      attestationsPath: resolve(repoRoot, config.settings.attestationsPath),
    },
  }
}

/**
 * Convert Zod-validated Config to AttestItConfig by removing undefined values.
 *
 * The Config type (from Zod) has optional fields as `T | undefined`,
 * while AttestItConfig has optional fields as `T?` (can be absent, not undefined).
 *
 * This adapter removes any undefined values to match the AttestItConfig interface
 * that the core functions expect.
 *
 * @param config - The Zod-validated configuration from loadConfig()
 * @returns Configuration compatible with AttestItConfig
 * @public
 */
export function toAttestItConfig(config: Config): import('./types.js').AttestItConfig {
  const result: import('./types.js').AttestItConfig = {
    version: config.version,
    settings: {
      maxAgeDays: config.settings.maxAgeDays,
      publicKeyPath: config.settings.publicKeyPath,
      attestationsPath: config.settings.attestationsPath,
      sealsPath: config.settings.sealsPath,
    },
    suites: {},
  }

  // Add optional minVersion field
  if (config.minVersion !== undefined) {
    result.minVersion = config.minVersion
  }

  // Add optional settings fields
  if (config.settings.defaultCommand !== undefined) {
    result.settings.defaultCommand = config.settings.defaultCommand
  }
  if (config.settings.keyProvider !== undefined) {
    result.settings.keyProvider = {
      type: config.settings.keyProvider.type,
      ...(config.settings.keyProvider.options !== undefined && {
        options: config.settings.keyProvider.options,
      }),
    }
  }

  // Add optional top-level fields
  if (config.team !== undefined) {
    result.team = config.team
  }
  if (config.gates !== undefined) {
    result.gates = config.gates
  }
  if (config.groups !== undefined) {
    result.groups = config.groups
  }

  // Map suites
  result.suites = Object.fromEntries(
    Object.entries(config.suites).map(([name, suite]) => {
      const mappedSuite: import('./types.js').SuiteConfig = {
        gate: suite.gate,
      }

      if (suite.description !== undefined) mappedSuite.description = suite.description
      if (suite.command !== undefined) mappedSuite.command = suite.command
      if (suite.timeout !== undefined) mappedSuite.timeout = suite.timeout
      if (suite.interactive !== undefined) mappedSuite.interactive = suite.interactive
      if (suite.invalidates !== undefined) mappedSuite.invalidates = suite.invalidates
      if (suite.depends_on !== undefined) mappedSuite.depends_on = suite.depends_on

      return [name, mappedSuite]
    }),
  )

  return result
}
