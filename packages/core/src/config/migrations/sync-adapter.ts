/**
 * Synchronous file operations adapter for migrex.
 *
 * The @migrex/files package only provides async operations.
 * This adapter provides sync variants for identity and seals configs.
 *
 * @packageDocumentation
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import type { MigrationGraph } from '@migrex/core'

/**
 * Type for validation errors returned by migrex schemas.
 * @internal
 */
interface ValidationErrorItem {
  path: (string | number)[]
  message: string
}

/**
 * Options for loading a versioned file synchronously.
 * @public
 */
export interface LoadSyncOptions {
  /** File format - defaults to auto-detect from extension */
  format?: 'yaml' | 'json'
}

/**
 * Options for saving a versioned file synchronously.
 * @public
 */
export interface SaveSyncOptions {
  /** File format - defaults to auto-detect from extension */
  format?: 'yaml' | 'json'
  /** Header to prepend to the file content (e.g., schema reference) */
  header?: string
  /** Whether to pretty-print JSON output (default: true) */
  pretty?: boolean
}

/**
 * Result from loading a versioned file synchronously.
 * @public
 */
export interface LoadSyncResult<T> {
  /** The loaded and validated data */
  data: T
  /** The version that was detected in the file */
  sourceVersion: string
}

/**
 * Detect file format from extension.
 * @internal
 */
function detectFormat(filepath: string): 'yaml' | 'json' {
  const ext = filepath.split('.').pop()?.toLowerCase()
  if (ext === 'json') return 'json'
  if (ext === 'yaml' || ext === 'yml') return 'yaml'
  // Default to YAML for unknown extensions
  return 'yaml'
}

/**
 * Detect the version from raw data.
 *
 * Looks for a 'version' field in the data. If not found, returns '1'
 * to support legacy versionless files.
 *
 * @internal
 */
function detectVersion(data: unknown): string {
  if (data && typeof data === 'object' && 'version' in data) {
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- narrowing from unknown after type guard
    const record = data as Record<string, unknown>
    const version = record.version
    if (typeof version === 'number') return String(version)
    if (typeof version === 'string') return version
  }
  // Default to version 1 for versionless files
  return '1'
}

/**
 * Load a versioned file synchronously.
 *
 * @param graph - The migration graph to use for validation
 * @param filepath - Path to the file
 * @param options - Loading options
 * @returns The loaded and validated data, or null if file doesn't exist
 * @throws Error if file exists but cannot be parsed or validated
 * @public
 */
export function loadVersionedFileSync<T>(
  graph: MigrationGraph,
  filepath: string,
  options: LoadSyncOptions = {},
): LoadSyncResult<T> | null {
  const format = options.format ?? detectFormat(filepath)

  let content: string
  try {
    content = readFileSync(filepath, 'utf8')
  } catch (error) {
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- Node.js fs errors are ErrnoException
    const nodeError = error as NodeJS.ErrnoException | null
    if (nodeError?.code === 'ENOENT' || nodeError?.code === 'ENOTDIR') {
      return null
    }
    throw error
  }

  // Parse the content
  let rawData: unknown
  try {
    rawData = format === 'yaml' ? parseYaml(content) : JSON.parse(content)
  } catch (error) {
    throw new Error(
      `Failed to parse ${format.toUpperCase()}: ${error instanceof Error ? error.message : String(error)}`,
    )
  }

  // Detect version
  const sourceVersion = detectVersion(rawData)

  // Get the latest version from the graph (last in sorted order)
  const versions = graph.getVersions()
  if (versions.length === 0) {
    throw new Error('Migration graph has no registered versions')
  }
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- length check above guarantees at least one element
  const latestVersion = versions[versions.length - 1]!

  // Check if source version is supported
  const sourceSchema = graph.getSchema(sourceVersion)
  if (!sourceSchema) {
    throw new Error(`Unsupported version: ${sourceVersion}`)
  }

  // Validate and potentially migrate
  if (sourceVersion !== latestVersion) {
    // Check if there's a migration path
    if (!graph.hasPath(sourceVersion, latestVersion)) {
      throw new Error(`Unsupported version: ${sourceVersion}`)
    }
    // Migrate from source to latest
    const result = graph.migrate(rawData, sourceVersion, latestVersion)
    if (!result.success) {
      throw new Error(`Migration failed: ${result.error?.message ?? 'Unknown error'}`)
    }
    return {
      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- migrex returns unknown, caller knows the expected type
      data: result.data as T,
      sourceVersion,
    }
  }

  // Validate against the current version schema
  const schema = graph.getSchema(sourceVersion)
  if (!schema) {
    throw new Error(`No schema found for version ${sourceVersion}`)
  }

  const validationResult = schema.schema(rawData)
  if (!validationResult.success) {
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- migrex uses internal error type
    const errors = (validationResult.errors as ValidationErrorItem[])
      .map((e) => `  - ${e.path.join('.')}: ${e.message}`)
      .join('\n')
    throw new Error(`Validation failed:\n${errors}`)
  }

  return {
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- migrex returns unknown, caller knows the expected type
    data: validationResult.data as T,
    sourceVersion,
  }
}

/**
 * Save a versioned file synchronously.
 *
 * @param graph - The migration graph (used for validation)
 * @param filepath - Path to save the file
 * @param data - Data to save
 * @param options - Saving options
 * @throws Error if validation fails or file cannot be written
 * @public
 */
export function saveVersionedFileSync(
  graph: MigrationGraph,
  filepath: string,
  data: unknown,
  options: SaveSyncOptions = {},
): void {
  const format = options.format ?? detectFormat(filepath)
  const pretty = options.pretty ?? true

  // Detect version in data and validate
  const version = detectVersion(data)
  const schema = graph.getSchema(version)
  if (!schema) {
    throw new Error(`No schema found for version ${version}`)
  }

  const validationResult = schema.schema(data)
  if (!validationResult.success) {
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- migrex uses internal error type
    const errors = (validationResult.errors as ValidationErrorItem[])
      .map((e) => `  - ${e.path.join('.')}: ${e.message}`)
      .join('\n')
    throw new Error(`Validation failed:\n${errors}`)
  }

  // Serialize
  let content: string
  if (format === 'yaml') {
    content = stringifyYaml(validationResult.data)
  } else {
    content = pretty
      ? JSON.stringify(validationResult.data, null, 2) + '\n'
      : JSON.stringify(validationResult.data) + '\n'
  }

  // Add header if provided
  if (options.header) {
    content = options.header + content
  }

  // Ensure directory exists (recursive: true makes this idempotent)
  const dir = dirname(filepath)
  mkdirSync(dir, { recursive: true })

  writeFileSync(filepath, content, 'utf8')
}
