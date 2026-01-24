/**
 * Local CLI resolution for attest-it.
 *
 * When a global installation of attest-it is invoked, this module
 * searches for a local (project-specific) installation and delegates
 * execution to it. This ensures projects use their pinned version,
 * which is critical for configs with `minVersion` requirements.
 *
 * The resolution process:
 * 1. Search upward from cwd for `node_modules/.bin/attest-it`
 * 2. If found and different from current CLI, spawn the local version
 * 3. If not found or same as current, continue with current CLI
 *
 * Set `ATTEST_IT_SKIP_LOCAL_RESOLUTION=1` to disable this behavior.
 *
 * @packageDocumentation
 */

import { existsSync, realpathSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)

/**
 * Walks up the directory tree looking for a local installation of attest-it CLI.
 * Starts from the current working directory and checks each parent directory
 * for node_modules/.bin/attest-it.
 *
 * @returns The path to the local CLI binary, or null if not found
 */
function findLocalCli(): string | null {
  let dir = process.cwd()

  while (dir !== dirname(dir)) {
    const localBin = join(dir, 'node_modules', '.bin', 'attest-it')
    if (existsSync(localBin)) {
      return localBin
    }
    dir = dirname(dir)
  }

  return null
}

/**
 * Extracts the package root path from a resolved file path.
 * Looks for the pattern 'node_modules/@attest-it/cli' in the path.
 *
 * @param filePath - The resolved file path
 * @returns The package root directory path, or null if not found
 */
function getPackageRoot(filePath: string): string | null {
  // Look for node_modules/@attest-it/cli in the path
  const regex = /(.*node_modules\/@attest-it\/cli)/
  const match = regex.exec(filePath)
  return match?.[1] ?? null
}

/**
 * Compares the resolved path of the local CLI with the current CLI to determine
 * if they are the same installation. Uses realpathSync to resolve symlinks.
 *
 * @param localCliPath - Path to the local CLI binary to check
 * @returns true if the local CLI is the same as the currently executing CLI
 */
function isSameAsCurrentCli(localCliPath: string): boolean {
  try {
    const localReal = realpathSync(localCliPath)
    const currentReal = realpathSync(__filename)

    // Compare the resolved paths directly
    if (localReal === currentReal) {
      return true
    }

    // Extract and compare package roots
    const localPkgRoot = getPackageRoot(localReal)
    const currentPkgRoot = getPackageRoot(currentReal)

    // If both are from the same package installation, they're the same
    return localPkgRoot !== null && localPkgRoot === currentPkgRoot
  } catch (err) {
    // Log the error to help with debugging filesystem issues
    console.warn(
      `Warning: Could not resolve CLI paths for comparison: ${err instanceof Error ? err.message : String(err)}`,
    )
    // If we can't resolve paths, assume they're different
    return false
  }
}

/**
 * Attempts to delegate execution to a locally installed version of attest-it CLI.
 * This ensures that projects use their pinned version rather than a global installation.
 *
 * The function:
 * 1. Checks if local resolution should be skipped (via environment variable)
 * 2. Searches for a local installation in node_modules/.bin
 * 3. Verifies the local installation is different from the current one
 * 4. Spawns the local CLI with the same arguments and environment
 * 5. Exits with the same status code as the delegated process
 *
 * @returns false if no delegation was needed or possible. If delegation occurs,
 *          this function does not return - it exits the process.
 * @public
 */
export function tryDelegateToLocal(): false {
  // Prevent infinite loops if a local CLI tries to delegate to itself
  if (process.env.ATTEST_IT_SKIP_LOCAL_RESOLUTION === '1') {
    return false
  }

  const localCli = findLocalCli()

  if (!localCli || isSameAsCurrentCli(localCli)) {
    return false
  }

  // Delegate to local CLI with the same arguments (skip node and script name)
  const result = spawnSync(localCli, process.argv.slice(2), {
    stdio: 'inherit',
    env: { ...process.env, ATTEST_IT_SKIP_LOCAL_RESOLUTION: '1' },
  })

  // Exit with the same status code as the delegated process
  process.exit(result.status ?? 1)
}
