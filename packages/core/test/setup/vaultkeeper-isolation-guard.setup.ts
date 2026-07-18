/**
 * Global vitest wiring for the VaultKeeper test-isolation guard (issue #114).
 *
 * Registered via `test.setupFiles` in `vitest.config.ts` so it runs for
 * every test in this package. Snapshots the REAL VaultKeeper config
 * directory before the suite and after every test, failing the offending
 * test loudly if any new file appeared there -- the signal that some test
 * exercised the `file` backend without redirecting it to an isolated
 * `VAULTKEEPER_CONFIG_DIR` temp directory.
 *
 * @see vaultkeeper-isolation-guard.ts for the pure, unit-tested logic.
 * @packageDocumentation
 */
import { afterEach, beforeAll } from 'vitest'
import {
  assertNoNewEntries,
  collectFilesRecursive,
  resolveRealVaultKeeperConfigDir,
} from './vaultkeeper-isolation-guard.js'

const REAL_VAULTKEEPER_CONFIG_DIR = resolveRealVaultKeeperConfigDir()
let baseline: string[] = []

beforeAll(() => {
  baseline = collectFilesRecursive(REAL_VAULTKEEPER_CONFIG_DIR)
})

afterEach(() => {
  const current = collectFilesRecursive(REAL_VAULTKEEPER_CONFIG_DIR)
  try {
    assertNoNewEntries(REAL_VAULTKEEPER_CONFIG_DIR, baseline, current)
  } finally {
    // Re-baseline regardless of outcome so a single leak is reported once,
    // on the test that caused it, rather than on every subsequent test in
    // the same file/worker.
    baseline = current
  }
})
