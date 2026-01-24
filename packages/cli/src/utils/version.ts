import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

/**
 * Type guard for package.json structure with version field.
 */
function hasVersion(data: unknown): data is { version: string } {
  return (
    typeof data === 'object' &&
    data !== null &&
    'version' in data &&
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    typeof (data as { version: unknown }).version === 'string'
  )
}

/**
 * Cached version to avoid repeated file reads.
 */
let cachedVersion: string | undefined

/**
 * Get the current version of the attest-it CLI package.
 *
 * This function reads the version from package.json at runtime, handling
 * different bundle output locations created by tsup. The version is cached
 * after the first read for performance.
 *
 * @returns The version string from package.json
 * @throws {Error} If package.json cannot be found or is missing version field
 * @public
 */
export function getPackageVersion(): string {
  if (cachedVersion !== undefined) {
    return cachedVersion
  }

  // Read version from package.json at runtime
  const __filename = fileURLToPath(import.meta.url)
  const __dirname = dirname(__filename)

  // Try multiple paths since tsup creates separate bundles for each entry point:
  // - dist/index.js (library entry) needs ../package.json
  // - dist/bin/attest-it.js (CLI entry) needs ../../package.json
  const possiblePaths = [join(__dirname, '../package.json'), join(__dirname, '../../package.json')]

  for (const packageJsonPath of possiblePaths) {
    try {
      const content = readFileSync(packageJsonPath, 'utf-8')
      const packageJsonData: unknown = JSON.parse(content)

      if (!hasVersion(packageJsonData)) {
        throw new Error(`Invalid package.json at ${packageJsonPath}: missing version field`)
      }

      cachedVersion = packageJsonData.version
      return cachedVersion
    } catch (error) {
      // Only suppress "file not found" errors; rethrow anything else
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        // Try next path
        continue
      }
      throw error
    }
  }

  throw new Error('Could not find package.json')
}
