/**
 * Configuration loading and validation for attest-it.
 */

import { readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { parse as parseYaml } from 'yaml'
import { z } from 'zod'

/**
 * Zod schema for settings with defaults applied.
 */
const settingsSchema = z
  .object({
    maxAgeDays: z.number().int().positive().default(30),
    publicKeyPath: z.string().default('.attest-it/pubkey.pem'),
    attestationsPath: z.string().default('.attest-it/attestations.json'),
    defaultCommand: z.string().optional(),
    // Note: algorithm field was removed - RSA is the only supported algorithm
  })
  .passthrough()

/**
 * Zod schema for a suite configuration.
 */
const suiteSchema = z
  .object({
    description: z.string().optional(),
    packages: z
      .array(z.string().min(1, 'Package path cannot be empty'))
      .min(1, 'At least one package pattern is required'),
    files: z.array(z.string().min(1, 'File path cannot be empty')).optional(),
    ignore: z.array(z.string().min(1, 'Ignore pattern cannot be empty')).optional(),
    command: z.string().optional(),
    invalidates: z.array(z.string().min(1, 'Invalidated suite name cannot be empty')).optional(),
    depends_on: z.array(z.string().min(1, 'Dependency suite name cannot be empty')).optional(),
  })
  .strict()

/**
 * Zod schema for the full configuration file.
 */
const configSchema = z
  .object({
    version: z.literal(1),
    settings: settingsSchema.default({}),
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
    if (error instanceof ConfigValidationError) {
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
    if (error instanceof ConfigValidationError) {
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
  return {
    version: config.version,
    settings: {
      maxAgeDays: config.settings.maxAgeDays,
      publicKeyPath: config.settings.publicKeyPath,
      attestationsPath: config.settings.attestationsPath,
      ...(config.settings.defaultCommand !== undefined && {
        defaultCommand: config.settings.defaultCommand,
      }),
    },
    suites: Object.fromEntries(
      Object.entries(config.suites).map(([name, suite]) => [
        name,
        {
          packages: suite.packages,
          ...(suite.description !== undefined && { description: suite.description }),
          ...(suite.files !== undefined && { files: suite.files }),
          ...(suite.ignore !== undefined && { ignore: suite.ignore }),
          ...(suite.command !== undefined && { command: suite.command }),
          ...(suite.invalidates !== undefined && { invalidates: suite.invalidates }),
          ...(suite.depends_on !== undefined && { depends_on: suite.depends_on }),
        },
      ]),
    ),
    ...(config.groups !== undefined && { groups: config.groups }),
  }
}
