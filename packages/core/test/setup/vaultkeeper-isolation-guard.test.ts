/**
 * Regression coverage for issue #114: several integration/UAT tests
 * exercised the VaultKeeper `file` backend without an isolated
 * `VAULTKEEPER_CONFIG_DIR`, silently writing into the developer's/CI
 * runner's real `~/.config/vaultkeeper/file/` directory.
 *
 * These tests exercise the guard's pure logic (never the real
 * `~/.config/vaultkeeper` directory -- everything here operates on
 * disposable scratch directories under `os.tmpdir()`) to prove it actually
 * detects a leak: `assertNoNewEntries` must throw when a new file appears
 * between two {@link collectFilesRecursive} snapshots of the same
 * directory, and must not throw when nothing changed. Against a guard that
 * never compared snapshots at all (or compared them incorrectly), the
 * "detects a new file" case below would fail to throw.
 */
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { describe, it, expect, afterEach } from 'vitest'
import {
  assertNoNewEntries,
  collectFilesRecursive,
  resolveRealVaultKeeperConfigDir,
} from './vaultkeeper-isolation-guard.js'

describe('resolveRealVaultKeeperConfigDir', () => {
  it('resolves to a stable, platform-appropriate path under the home directory', () => {
    const dir = resolveRealVaultKeeperConfigDir()
    expect(dir).toContain('vaultkeeper')
    expect(path.isAbsolute(dir)).toBe(true)
  })

  it('never reads VAULTKEEPER_CONFIG_DIR (must reflect the real, unoverridden location)', () => {
    const original = process.env.VAULTKEEPER_CONFIG_DIR
    process.env.VAULTKEEPER_CONFIG_DIR = '/some/isolated/test/temp/dir'
    try {
      const dir = resolveRealVaultKeeperConfigDir()
      expect(dir).not.toBe('/some/isolated/test/temp/dir')
    } finally {
      if (original === undefined) {
        delete process.env.VAULTKEEPER_CONFIG_DIR
      } else {
        process.env.VAULTKEEPER_CONFIG_DIR = original
      }
    }
  })
})

describe('collectFilesRecursive', () => {
  let scratchDir: string

  afterEach(async () => {
    if (scratchDir) {
      await fs.rm(scratchDir, { recursive: true, force: true })
    }
  })

  it('returns an empty list for a directory that does not exist', () => {
    const missing = path.join(os.tmpdir(), 'attest-it-guard-test-does-not-exist')
    expect(collectFilesRecursive(missing)).toEqual([])
  })

  it('lists nested files (mirroring <configDir>/file/<id>.enc) but not directories', async () => {
    scratchDir = await fs.mkdtemp(path.join(os.tmpdir(), 'attest-it-guard-scan-'))
    await fs.mkdir(path.join(scratchDir, 'file'), { recursive: true })
    await fs.writeFile(path.join(scratchDir, 'file', 'abc123.enc'), 'secret')
    await fs.writeFile(path.join(scratchDir, 'config.yaml'), 'version: 1')

    const files = collectFilesRecursive(scratchDir)

    expect(files).toEqual(
      [path.join(scratchDir, 'config.yaml'), path.join(scratchDir, 'file', 'abc123.enc')].sort(),
    )
    // Directories themselves must never appear in the listing.
    expect(files).not.toContain(path.join(scratchDir, 'file'))
  })
})

describe('assertNoNewEntries', () => {
  it('does not throw when nothing changed between snapshots', () => {
    const before = ['/tmp/vk/config.yaml']
    const after = ['/tmp/vk/config.yaml']
    expect(() => {
      assertNoNewEntries('/tmp/vk', before, after)
    }).not.toThrow()
  })

  it('does not throw when files were only removed (never a false positive on cleanup)', () => {
    const before = ['/tmp/vk/config.yaml', '/tmp/vk/file/stale.enc']
    const after = ['/tmp/vk/config.yaml']
    expect(() => {
      assertNoNewEntries('/tmp/vk', before, after)
    }).not.toThrow()
  })

  // This is the core regression case: a leaking test would cause a new
  // `.enc` file to appear under the real VaultKeeper directory between the
  // "before" and "after" snapshots. Against a no-op or miswired guard, this
  // would silently pass instead of throwing.
  it('throws naming the new file when a leak writes into the guarded directory', () => {
    const before = ['/tmp/vk/config.yaml']
    const after = ['/tmp/vk/config.yaml', '/tmp/vk/file/leaked-secret.enc']
    expect(() => {
      assertNoNewEntries('/tmp/vk', before, after)
    }).toThrow(/leaked-secret\.enc/)
    expect(() => {
      assertNoNewEntries('/tmp/vk', before, after)
    }).toThrow(/VAULTKEEPER_CONFIG_DIR/)
  })

  it('names every new file when a leak writes more than one', () => {
    const before: string[] = []
    const after = ['/tmp/vk/file/one.enc', '/tmp/vk/file/two.enc']
    expect(() => {
      assertNoNewEntries('/tmp/vk', before, after)
    }).toThrow(/one\.enc.*two\.enc|two\.enc.*one\.enc/)
  })
})
