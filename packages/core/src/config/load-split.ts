/**
 * Split configuration loading for attest-it.
 *
 * This module provides unified config loading that works for both CLI and GitHub Action.
 * Both tools use the same code path for loading, validating, and merging configs.
 *
 * The only difference is WHERE the policy comes from:
 * - CLI: Always loads policy from local filesystem
 * - GitHub Action in PR context: Can provide policy content fetched from base branch
 *
 * @module
 */

import { readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parse as parseYaml } from 'yaml'
import type { AttestItConfig } from '../types.js'
import { mergeConfigs } from './merge.js'
import { parsePolicyContent, PolicyValidationError, type PolicyConfig } from './policy-schema.js'
import {
  parseOperationalContent,
  OperationalValidationError,
  type OperationalConfig,
} from './operational-schema.js'
import { validateSuiteGateReferences } from './validation.js'

/**
 * Source for loading policy configuration.
 * @public
 */
export interface PolicySource {
  /** Type of source */
  type: 'filesystem' | 'content'
  /** For filesystem: path to policy file (optional, will auto-detect if not provided) */
  path?: string
  /** For content: raw content (used by GitHub Action when fetching from API) */
  content?: string
  /** Format of the content (required when type is 'content') */
  format?: 'yaml' | 'json'
}

/**
 * Options for loading split configuration.
 * @public
 */
export interface LoadSplitConfigOptions {
  /** Where to load policy from. Defaults to filesystem auto-detection. */
  policySource?: PolicySource
  /** Path to operational config. Defaults to auto-detection. */
  operationalPath?: string
  /** Base directory for auto-detection. Defaults to cwd. */
  baseDir?: string
}

/**
 * Error thrown when a configuration file cannot be found.
 * @public
 */
export class SplitConfigNotFoundError extends Error {
  constructor(
    message: string,
    public readonly configType: 'policy' | 'operational',
  ) {
    super(message)
    this.name = 'SplitConfigNotFoundError'
  }
}

/**
 * Error thrown when cross-configuration validation fails.
 * @public
 */
export class CrossConfigValidationError extends Error {
  constructor(
    message: string,
    public readonly errors: { type: string; message: string }[],
  ) {
    super(message)
    this.name = 'CrossConfigValidationError'
  }
}

/**
 * Migration guidance surfaced when a repository still uses the retired unified
 * configuration format instead of split policy + operational config.
 */
const UNIFIED_MIGRATION_HINT =
  'attest-it now requires split configuration: a trust-critical .attest-it/policy.yaml ' +
  '(team, gates) plus an operational .attest-it/config.yaml (suites, command settings). ' +
  'The legacy unified config.yaml format is no longer loaded. ' +
  'Run "attest-it init --migrate" to convert your existing config into policy.yaml + config.yaml, ' +
  'then commit the generated policy.yaml.'

/**
 * Error thrown when a repository has no policy.yaml but does have a legacy
 * unified config.yaml. Points the user at the migration path rather than
 * silently loading the retired format.
 * @public
 */
export class UnifiedConfigError extends Error {
  constructor(
    /** Path to the detected legacy unified config file. */
    public readonly unifiedPath: string,
  ) {
    super(`${UNIFIED_MIGRATION_HINT} (found legacy unified config at ${unifiedPath})`)
    this.name = 'UnifiedConfigError'
  }
}

/**
 * Determine whether a parsed config object is a legacy unified config.
 *
 * The operational config.yaml legitimately lives at `.attest-it/config.yaml`,
 * so the file name alone is not enough. A unified config is distinguished by
 * carrying trust-critical `team`/`gates` at the top level — data that only ever
 * belongs in policy.yaml under the split model.
 */
function isUnifiedShape(parsed: unknown): boolean {
  return typeof parsed === 'object' && parsed !== null && ('team' in parsed || 'gates' in parsed)
}

/**
 * Find a legacy unified config file (one carrying top-level team/gates) in the
 * standard `.attest-it/config.*` locations, if one exists.
 */
function findUnifiedConfigPath(baseDir: string): string | null {
  const configDir = join(baseDir, '.attest-it')
  const candidates = ['config.yaml', 'config.yml', 'config.json']

  for (const candidate of candidates) {
    const configPath = join(configDir, candidate)
    try {
      const content = readFileSync(configPath, 'utf8')
      const parsed: unknown = candidate.endsWith('.json') ? JSON.parse(content) : parseYaml(content)
      if (isUnifiedShape(parsed)) {
        return configPath
      }
    } catch {
      // File missing or unparseable — not a migratable unified config.
    }
  }

  return null
}

/**
 * Find policy file in standard locations.
 *
 * Searches for policy configuration in the following order:
 * 1. .attest-it/policy.yaml
 * 2. .attest-it/policy.yml
 * 3. .attest-it/policy.json
 *
 * @param startDir - Directory to start searching from. Defaults to cwd.
 * @returns Path to policy file, or null if not found.
 * @public
 */
export function findPolicyPath(startDir: string = process.cwd()): string | null {
  const configDir = join(startDir, '.attest-it')
  const candidates = ['policy.yaml', 'policy.yml', 'policy.json']

  for (const candidate of candidates) {
    const configPath = join(configDir, candidate)
    try {
      readFileSync(configPath, 'utf8')
      return configPath
    } catch {
      // File doesn't exist or can't be read, try next candidate
    }
  }

  return null
}

/**
 * Find operational config file in standard locations.
 *
 * Searches for operational configuration in the following order:
 * 1. .attest-it/config.yaml
 * 2. .attest-it/config.yml
 * 3. .attest-it/config.json
 *
 * @param startDir - Directory to start searching from. Defaults to cwd.
 * @returns Path to operational config file, or null if not found.
 * @public
 */
export function findOperationalPath(startDir: string = process.cwd()): string | null {
  const configDir = join(startDir, '.attest-it')
  const candidates = ['config.yaml', 'config.yml', 'config.json']

  for (const candidate of candidates) {
    const configPath = join(configDir, candidate)
    try {
      readFileSync(configPath, 'utf8')
      return configPath
    } catch {
      // File doesn't exist or can't be read, try next candidate
    }
  }

  return null
}

/**
 * Get config format from file path.
 */
function getConfigFormat(filePath: string): 'yaml' | 'json' {
  return filePath.endsWith('.json') ? 'json' : 'yaml'
}

/**
 * Load and parse policy configuration.
 */
function loadPolicySync(source: PolicySource, baseDir: string): PolicyConfig {
  if (source.type === 'content') {
    if (!source.content) {
      throw new SplitConfigNotFoundError(
        'Policy content is required when type is "content"',
        'policy',
      )
    }
    if (!source.format) {
      throw new SplitConfigNotFoundError(
        'Policy format is required when type is "content"',
        'policy',
      )
    }
    return parsePolicyContent(source.content, source.format)
  }

  // Filesystem loading
  const policyPath = source.path ?? findPolicyPath(baseDir)
  if (!policyPath) {
    throw new SplitConfigNotFoundError(
      'Policy file not found. Expected .attest-it/policy.yaml, .attest-it/policy.yml, or .attest-it/policy.json',
      'policy',
    )
  }

  try {
    const content = readFileSync(policyPath, 'utf8')
    const format = getConfigFormat(policyPath)
    return parsePolicyContent(content, format)
  } catch (error) {
    if (error instanceof PolicyValidationError) {
      throw error
    }
    throw new SplitConfigNotFoundError(
      `Failed to read policy file at ${policyPath}: ${String(error)}`,
      'policy',
    )
  }
}

/**
 * Load and parse policy configuration (async).
 */
async function loadPolicyAsync(source: PolicySource, baseDir: string): Promise<PolicyConfig> {
  if (source.type === 'content') {
    if (!source.content) {
      throw new SplitConfigNotFoundError(
        'Policy content is required when type is "content"',
        'policy',
      )
    }
    if (!source.format) {
      throw new SplitConfigNotFoundError(
        'Policy format is required when type is "content"',
        'policy',
      )
    }
    return parsePolicyContent(source.content, source.format)
  }

  // Filesystem loading
  const policyPath = source.path ?? findPolicyPath(baseDir)
  if (!policyPath) {
    throw new SplitConfigNotFoundError(
      'Policy file not found. Expected .attest-it/policy.yaml, .attest-it/policy.yml, or .attest-it/policy.json',
      'policy',
    )
  }

  try {
    const content = await readFile(policyPath, 'utf8')
    const format = getConfigFormat(policyPath)
    return parsePolicyContent(content, format)
  } catch (error) {
    if (error instanceof PolicyValidationError) {
      throw error
    }
    throw new SplitConfigNotFoundError(
      `Failed to read policy file at ${policyPath}: ${String(error)}`,
      'policy',
    )
  }
}

/**
 * Load and parse operational configuration.
 */
function loadOperationalSync(
  operationalPath: string | undefined,
  baseDir: string,
): OperationalConfig {
  const resolvedPath = operationalPath ?? findOperationalPath(baseDir)
  if (!resolvedPath) {
    throw new SplitConfigNotFoundError(
      'Operational config file not found. Expected .attest-it/config.yaml, .attest-it/config.yml, or .attest-it/config.json',
      'operational',
    )
  }

  try {
    const content = readFileSync(resolvedPath, 'utf8')
    const format = getConfigFormat(resolvedPath)
    return parseOperationalContent(content, format)
  } catch (error) {
    if (error instanceof OperationalValidationError) {
      throw error
    }
    throw new SplitConfigNotFoundError(
      `Failed to read operational config file at ${resolvedPath}: ${String(error)}`,
      'operational',
    )
  }
}

/**
 * Load and parse operational configuration (async).
 */
async function loadOperationalAsync(
  operationalPath: string | undefined,
  baseDir: string,
): Promise<OperationalConfig> {
  const resolvedPath = operationalPath ?? findOperationalPath(baseDir)
  if (!resolvedPath) {
    throw new SplitConfigNotFoundError(
      'Operational config file not found. Expected .attest-it/config.yaml, .attest-it/config.yml, or .attest-it/config.json',
      'operational',
    )
  }

  try {
    const content = await readFile(resolvedPath, 'utf8')
    const format = getConfigFormat(resolvedPath)
    return parseOperationalContent(content, format)
  } catch (error) {
    if (error instanceof OperationalValidationError) {
      throw error
    }
    throw new SplitConfigNotFoundError(
      `Failed to read operational config file at ${resolvedPath}: ${String(error)}`,
      'operational',
    )
  }
}

/**
 * Validate and merge policy and operational configs.
 */
function validateAndMerge(policy: PolicyConfig, operational: OperationalConfig): AttestItConfig {
  // Validate cross-references
  const validationErrors = validateSuiteGateReferences(policy, operational)
  if (validationErrors.length > 0) {
    const messages = validationErrors.map((e) => e.message).join('; ')
    throw new CrossConfigValidationError(
      `Configuration validation failed: ${messages}`,
      validationErrors.map((e) => ({ type: e.type, message: e.message })),
    )
  }

  // Merge configurations
  return mergeConfigs(policy, operational)
}

/**
 * Load split configuration (policy + operational) and merge.
 *
 * This is the primary config loading function for both CLI and GitHub Action.
 * It loads policy and operational configs, validates cross-references, and merges them.
 *
 * The retired unified config.yaml format is not loaded. If policy.yaml is absent
 * but a legacy unified config.yaml is present, this throws {@link UnifiedConfigError}
 * pointing at the `attest-it init --migrate` migration path.
 *
 * @param options - Loading options
 * @returns Merged configuration
 * @throws {@link SplitConfigNotFoundError} If config files cannot be found
 * @throws {@link UnifiedConfigError} If only a legacy unified config.yaml is present
 * @throws {@link PolicyValidationError} If policy validation fails
 * @throws {@link OperationalValidationError} If operational config validation fails
 * @throws {@link CrossConfigValidationError} If cross-config validation fails
 * @public
 */
export async function loadSplitConfig(
  options: LoadSplitConfigOptions = {},
): Promise<AttestItConfig> {
  const baseDir = options.baseDir ?? process.cwd()
  const policySource: PolicySource = options.policySource ?? { type: 'filesystem' }

  // If policy source is provided explicitly (not auto-detect), use split config loading
  if (policySource.type === 'content' || policySource.path) {
    const policy = await loadPolicyAsync(policySource, baseDir)
    const operational = await loadOperationalAsync(options.operationalPath, baseDir)
    return validateAndMerge(policy, operational)
  }

  // Load split config. If policy.yaml is missing but a legacy unified config.yaml
  // is present, surface the migration path instead of silently loading it.
  try {
    const policy = await loadPolicyAsync(policySource, baseDir)
    const operational = await loadOperationalAsync(options.operationalPath, baseDir)
    return validateAndMerge(policy, operational)
  } catch (error) {
    if (error instanceof SplitConfigNotFoundError && error.configType === 'policy') {
      const unifiedPath = findUnifiedConfigPath(baseDir)
      if (unifiedPath) {
        throw new UnifiedConfigError(unifiedPath)
      }
    }
    throw error
  }
}

/**
 * Load split configuration synchronously.
 *
 * Sync version for CLI commands that need sync loading.
 *
 * The retired unified config.yaml format is not loaded. If policy.yaml is absent
 * but a legacy unified config.yaml is present, this throws {@link UnifiedConfigError}
 * pointing at the `attest-it init --migrate` migration path.
 *
 * @param options - Loading options
 * @returns Merged configuration
 * @throws {@link SplitConfigNotFoundError} If config files cannot be found
 * @throws {@link UnifiedConfigError} If only a legacy unified config.yaml is present
 * @throws {@link PolicyValidationError} If policy validation fails
 * @throws {@link OperationalValidationError} If operational config validation fails
 * @throws {@link CrossConfigValidationError} If cross-config validation fails
 * @public
 */
export function loadSplitConfigSync(options: LoadSplitConfigOptions = {}): AttestItConfig {
  const baseDir = options.baseDir ?? process.cwd()
  const policySource: PolicySource = options.policySource ?? { type: 'filesystem' }

  // If policy source is provided explicitly (not auto-detect), use split config loading
  if (policySource.type === 'content' || policySource.path) {
    const policy = loadPolicySync(policySource, baseDir)
    const operational = loadOperationalSync(options.operationalPath, baseDir)
    return validateAndMerge(policy, operational)
  }

  // Load split config. If policy.yaml is missing but a legacy unified config.yaml
  // is present, surface the migration path instead of silently loading it.
  try {
    const policy = loadPolicySync(policySource, baseDir)
    const operational = loadOperationalSync(options.operationalPath, baseDir)
    return validateAndMerge(policy, operational)
  } catch (error) {
    if (error instanceof SplitConfigNotFoundError && error.configType === 'policy') {
      const unifiedPath = findUnifiedConfigPath(baseDir)
      if (unifiedPath) {
        throw new UnifiedConfigError(unifiedPath)
      }
    }
    throw error
  }
}
