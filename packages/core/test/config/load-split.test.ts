/**
 * Tests for split-config loading and the retired unified-config guardrail.
 *
 * Covers the removal of the silent unified-config fallback (issue #68): when a
 * repository has no policy.yaml but still carries a legacy unified config.yaml
 * (top-level team/gates), loading must fail with an explicit, migration-pointing
 * error instead of transparently succeeding.
 *
 * @see https://github.com/mike-north/attest-it/issues/68
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {
  loadSplitConfigSync,
  loadSplitConfig,
  UnifiedConfigError,
  SplitConfigNotFoundError,
} from '../../src/config/load-split.js'

/** A legacy unified config: trust-critical team/gates bundled with suites. */
const UNIFIED_CONFIG_YAML = `version: 1

settings:
  maxAgeDays: 30
  publicKeyPath: .attest-it/pubkey.pem

team:
  alice:
    name: Alice
    publicKey: ssh-ed25519 ALICE

gates:
  unit-gate:
    name: Unit Gate
    description: Unit tests
    authorizedSigners:
      - alice
    fingerprint:
      paths:
        - src
    maxAge: 30d

suites:
  unit:
    description: Unit suite
    gate: unit-gate
    command: pnpm test
`

/** A proper split policy.yaml (trust-critical). */
const POLICY_YAML = `version: 1

settings:
  maxAgeDays: 30
  publicKeyPath: .attest-it/pubkey.pem

team:
  alice:
    name: Alice
    publicKey: ssh-ed25519 ALICE

gates:
  unit-gate:
    name: Unit Gate
    description: Unit tests
    authorizedSigners:
      - alice
    fingerprint:
      paths:
        - src
    maxAge: 30d
`

/** A proper split operational config.yaml (no trust data). */
const OPERATIONAL_YAML = `version: 1

settings:
  defaultCommand: pnpm test

suites:
  unit:
    description: Unit suite
    gate: unit-gate
    command: pnpm test
`

describe('loadSplitConfig — retired unified-config fallback (issue #68)', () => {
  let baseDir: string

  beforeEach(() => {
    baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'attest-it-load-split-'))
    fs.mkdirSync(path.join(baseDir, '.attest-it'), { recursive: true })
  })

  afterEach(() => {
    fs.rmSync(baseDir, { recursive: true, force: true })
  })

  describe('sync', () => {
    it('throws UnifiedConfigError (not silent fallback) when only a unified config.yaml exists', () => {
      fs.writeFileSync(path.join(baseDir, '.attest-it', 'config.yaml'), UNIFIED_CONFIG_YAML)

      expect(() => loadSplitConfigSync({ baseDir })).toThrow(UnifiedConfigError)
    })

    it('names the migration path in the error message', () => {
      const unifiedPath = path.join(baseDir, '.attest-it', 'config.yaml')
      fs.writeFileSync(unifiedPath, UNIFIED_CONFIG_YAML)

      let thrown: unknown
      try {
        loadSplitConfigSync({ baseDir })
      } catch (error) {
        thrown = error
      }

      expect(thrown).toBeInstanceOf(UnifiedConfigError)
      if (thrown instanceof UnifiedConfigError) {
        expect(thrown.unifiedPath).toBe(unifiedPath)
        expect(thrown.message).toContain('attest-it init --migrate')
        expect(thrown.message).toContain('policy.yaml')
      }
    })

    it('loads successfully when a proper split policy.yaml + config.yaml pair exists', () => {
      fs.writeFileSync(path.join(baseDir, '.attest-it', 'policy.yaml'), POLICY_YAML)
      fs.writeFileSync(path.join(baseDir, '.attest-it', 'config.yaml'), OPERATIONAL_YAML)

      const config = loadSplitConfigSync({ baseDir })
      expect(config.suites.unit.gate).toBe('unit-gate')
      expect(config.gates?.['unit-gate']).toBeDefined()
    })

    it('reports missing policy (not a unified error) when config.yaml is a plain operational file', () => {
      // An operational-only config.yaml has no top-level team/gates, so it is not
      // a migratable unified config — the failure is a plain missing-policy error.
      fs.writeFileSync(path.join(baseDir, '.attest-it', 'config.yaml'), OPERATIONAL_YAML)

      expect(() => loadSplitConfigSync({ baseDir })).toThrow(SplitConfigNotFoundError)
      expect(() => loadSplitConfigSync({ baseDir })).not.toThrow(UnifiedConfigError)
    })
  })

  describe('async', () => {
    it('rejects with UnifiedConfigError when only a unified config.yaml exists', async () => {
      fs.writeFileSync(path.join(baseDir, '.attest-it', 'config.yaml'), UNIFIED_CONFIG_YAML)

      await expect(loadSplitConfig({ baseDir })).rejects.toBeInstanceOf(UnifiedConfigError)
    })

    it('loads successfully with a proper split pair', async () => {
      fs.writeFileSync(path.join(baseDir, '.attest-it', 'policy.yaml'), POLICY_YAML)
      fs.writeFileSync(path.join(baseDir, '.attest-it', 'config.yaml'), OPERATIONAL_YAML)

      const config = await loadSplitConfig({ baseDir })
      expect(config.suites.unit.gate).toBe('unit-gate')
    })
  })
})
