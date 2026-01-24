/**
 * Version checking utilities for attest-it
 * @packageDocumentation
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import * as path from 'node:path'
import semver from 'semver'

/**
 * Build-time version constant injected by tsup.
 * This is replaced with a string literal during bundling.
 * When not bundled (development mode), this will be undefined.
 */
declare const __ATTEST_IT_VERSION__: string | undefined

/**
 * Cached package version to avoid repeated file reads
 */
let cachedVersion: string | undefined

/**
 * Get the current version of the @attest-it/core package.
 *
 * This function uses a build-time injected version when available (for bundled
 * contexts like github-action), falling back to reading package.json at runtime
 * for development and standard library usage.
 *
 * @returns The semantic version string (e.g., "1.2.3")
 * @throws Error if package.json cannot be found or parsed (only in fallback mode)
 * @public
 */
export function getPackageVersion(): string {
  if (cachedVersion !== undefined) {
    return cachedVersion
  }

  // Use build-time version if available (bundled contexts like github-action)
  // The typeof check prevents ReferenceError when the constant isn't defined
  if (typeof __ATTEST_IT_VERSION__ !== 'undefined') {
    cachedVersion = __ATTEST_IT_VERSION__
    return cachedVersion
  }

  // Fallback to runtime resolution (development and standard library usage)
  return getVersionFromPackageJson()
}

/**
 * Reads the version from package.json at runtime.
 * This is used as a fallback when the build-time version constant is not available.
 *
 * @internal
 */
function getVersionFromPackageJson(): string {
  // Get the directory containing this source file
  const currentFileUrl = import.meta.url
  const currentFilePath = fileURLToPath(currentFileUrl)
  const currentDir = path.dirname(currentFilePath)

  // Try to find package.json - could be in parent (if in dist/) or grandparent (if in src/)
  // Try ../package.json (for dist/version.js)
  const distPath = path.join(currentDir, '..', 'package.json')
  let packageJsonContent: string | undefined
  let packageJsonPath: string

  try {
    packageJsonContent = readFileSync(distPath, 'utf-8')
    packageJsonPath = distPath
  } catch {
    // Try ../../package.json (for src/version.ts during development)
    const srcPath = path.join(currentDir, '..', '..', 'package.json')
    try {
      packageJsonContent = readFileSync(srcPath, 'utf-8')
      packageJsonPath = srcPath
    } catch {
      throw new Error(
        `Could not find package.json from ${currentDir}. Tried ${distPath} and ${srcPath}`,
      )
    }
  }
  const packageJson: unknown = JSON.parse(packageJsonContent)

  // Validate the parsed JSON structure
  if (
    typeof packageJson !== 'object' ||
    packageJson === null ||
    !('version' in packageJson) ||
    typeof packageJson.version !== 'string'
  ) {
    throw new Error(`Invalid or missing version in package.json at ${packageJsonPath}`)
  }

  cachedVersion = packageJson.version
  return cachedVersion
}

/**
 * Error thrown when the current attest-it version does not satisfy
 * the minimum version requirement specified in a configuration file.
 *
 * @public
 */
export class VersionIncompatibleError extends Error {
  /**
   * The minimum required version
   */
  public readonly requiredVersion: string

  /**
   * The current running version
   */
  public readonly currentVersion: string

  /**
   * @param requiredVersion - The minimum required version
   * @param currentVersion - The current running version
   */
  constructor(requiredVersion: string, currentVersion: string) {
    const message = [
      `This configuration requires attest-it version ${requiredVersion} or newer, but you are running ${currentVersion}.`,
      '',
      'To upgrade:',
      `  pnpm add -D @attest-it/cli@^${requiredVersion}`,
      '  # then run: pnpm install',
    ].join('\n')

    super(message)
    this.name = 'VersionIncompatibleError'
    this.requiredVersion = requiredVersion
    this.currentVersion = currentVersion

    // Restore prototype chain for proper instanceof checks
    Object.setPrototypeOf(this, VersionIncompatibleError.prototype)
  }
}

/**
 * Check if the current package version satisfies the minimum version requirement.
 *
 * This function is called automatically when loading configuration files that
 * specify a `minVersion` field. You typically don't need to call it directly.
 *
 * @param minVersion - The minimum required version from config (semver string)
 * @throws {VersionIncompatibleError} If current version is older than minVersion
 * @throws {Error} If minVersion is not a valid semver string
 * @public
 *
 * @example
 * ```typescript
 * // Manual usage (automatic during config load)
 * checkVersionCompatibility('1.0.0')
 * ```
 */
export function checkVersionCompatibility(minVersion: string): void {
  const currentVersion = getPackageVersion()

  // Validate version strings
  if (!semver.valid(minVersion)) {
    throw new Error(`Invalid minimum version string: "${minVersion}"`)
  }

  if (!semver.valid(currentVersion)) {
    throw new Error(`Invalid current version string: "${currentVersion}"`)
  }

  // Check if current version is greater than or equal to minimum version
  if (!semver.gte(currentVersion, minVersion)) {
    throw new VersionIncompatibleError(minVersion, currentVersion)
  }
}
