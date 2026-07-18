/**
 * Pure logic for the VaultKeeper test-isolation guard (issue #114).
 *
 * @remarks
 * Several integration/UAT tests exercise the VaultKeeper `file` backend
 * without redirecting it (via `VAULTKEEPER_CONFIG_DIR`) to an isolated temp
 * directory, so they silently read/write the developer's or CI runner's
 * REAL `~/.config/vaultkeeper/file/` directory -- accumulating stray
 * `.enc` secret files there (300+ observed on at least one machine).
 *
 * This module contains the guard's pure, unit-testable logic: resolving
 * the real (non-test-overridden) VaultKeeper config directory the same way
 * VaultKeeper itself does, recursively snapshotting its contents, and
 * asserting that no new files appeared between two snapshots. The recursive
 * snapshot covers the whole tree -- config files at the root AND the
 * encrypted private-key `.enc` blobs under `file/` and signing keys under
 * `signing-keys/` -- so a test that leaks *key* material (issue #129), not
 * just config, fails the guard. The vitest wiring (`beforeAll`/`afterEach`)
 * that actually runs this against the real directory during a test run lives
 * in `vaultkeeper-isolation-guard.setup.ts`, which is registered as a global
 * `setupFiles` entry so it applies to every test in this package without each
 * test file needing to opt in.
 *
 * @see vaultkeeper-isolation-guard.setup.ts
 * @see vaultkeeper-isolation-guard.test.ts
 * @packageDocumentation
 */
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

/**
 * Resolve the REAL VaultKeeper config directory -- i.e. where VaultKeeper's
 * own `getPlatformDefaultConfigDir()` resolves to when `VAULTKEEPER_CONFIG_DIR`
 * is unset. This intentionally does NOT read `process.env.VAULTKEEPER_CONFIG_DIR`
 * -- the guard needs the real machine location regardless of whatever a test
 * has (or hasn't) overridden the env var to, so it can detect writes that
 * land there instead of an isolated temp directory.
 */
export function resolveRealVaultKeeperConfigDir(): string {
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA
    if (appData !== undefined && appData !== '') {
      return path.join(appData, 'vaultkeeper')
    }
    return path.join(os.homedir(), 'AppData', 'Roaming', 'vaultkeeper')
  }
  return path.join(os.homedir(), '.config', 'vaultkeeper')
}

/**
 * Recursively list every file (not directory) under `dir`, as absolute
 * paths, sorted for stable comparison. Returns an empty list if `dir`
 * doesn't exist -- a missing directory is the common, expected case on a
 * clean CI runner.
 */
export function collectFilesRecursive(dir: string): string[] {
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return []
  }
  const results: string[] = []
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      results.push(...collectFilesRecursive(full))
    } else {
      results.push(full)
    }
  }
  return results.sort()
}

/**
 * Assert that `after` introduces no files beyond what was present in
 * `before`. Throws a descriptive error naming the offending directory and
 * the new file(s) if it does.
 *
 * @param dir - The directory being guarded (used only for the error message)
 * @param before - A prior {@link collectFilesRecursive} snapshot
 * @param after - A later {@link collectFilesRecursive} snapshot
 */
export function assertNoNewEntries(
  dir: string,
  before: readonly string[],
  after: readonly string[],
): void {
  const beforeSet = new Set(before)
  const newEntries = after.filter((entry) => !beforeSet.has(entry))
  if (newEntries.length > 0) {
    throw new Error(
      `VaultKeeper test-isolation guard (issues #114/#129): a test wrote to the REAL ` +
        `VaultKeeper config directory (${dir}) instead of an isolated temp directory. ` +
        `This includes encrypted private-key '.enc' blobs under file/ and signing-keys/, ` +
        `not just config. New file(s): ${newEntries.join(', ')}. Isolate the test by ` +
        `setting ATTEST_IT_HOME (or the programmatic home override / --home-dir flag) to a ` +
        `per-test temp directory -- attest-it now propagates that into VaultKeeper's ` +
        `config-dir resolution -- or, for tests that drive VaultKeeper directly, set ` +
        `process.env.VAULTKEEPER_CONFIG_DIR (and pass it through to any spawned CLI ` +
        `subprocess's env) before invoking anything that stores or deletes keys via the ` +
        `VaultKeeper file backend.`,
    )
  }
}
