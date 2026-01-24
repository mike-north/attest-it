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
 * Gets the list of executable extensions to check based on the platform.
 * On Windows, npm creates .cmd and .ps1 shims in addition to the base executable.
 *
 * @returns Array of extensions to check (empty string for base name, then platform-specific)
 */
function getExecutableExtensions(): string[] {
  if (process.platform === 'win32') {
    // On Windows, check for .cmd (batch) and .ps1 (PowerShell) shims
    // The .cmd shim is created by npm and is the primary way to run CLI tools
    return ['.cmd', '.ps1', '']
  }
  // On Unix-like systems, the executable has no extension
  return ['']
}

/**
 * Walks up the directory tree looking for a local installation of attest-it CLI.
 * Starts from the current working directory and checks each parent directory
 * for node_modules/.bin/attest-it (with platform-appropriate extensions).
 *
 * @returns The path to the local CLI binary, or null if not found
 */
function findLocalCli(): string | null {
  let dir = process.cwd()
  const extensions = getExecutableExtensions()

  while (dir !== dirname(dir)) {
    const binDir = join(dir, 'node_modules', '.bin')
    for (const ext of extensions) {
      const localBin = join(binDir, `attest-it${ext}`)
      if (existsSync(localBin)) {
        return localBin
      }
    }
    dir = dirname(dir)
  }

  return null
}

/**
 * Extracts the package root path from a resolved file path.
 * Looks for the pattern 'node_modules/@attest-it/cli' in the path.
 * Handles both POSIX (/) and Windows (\) path separators.
 *
 * @param filePath - The resolved file path
 * @returns The package root directory path, or null if not found
 */
function getPackageRoot(filePath: string): string | null {
  // Normalize path separators to forward slashes for consistent matching
  // This handles both POSIX (/) and Windows (\) paths
  const normalizedPath = filePath.replace(/\\/g, '/')

  // Look for node_modules/@attest-it/cli in the normalized path
  const regex = /(.*node_modules\/@attest-it\/cli)/
  const match = regex.exec(normalizedPath)

  if (!match?.[1]) {
    return null
  }

  // Return the matched portion using original path separators
  // by taking the same length substring from the original path
  return filePath.slice(0, match[1].length)
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
