/**
 * Tests for the one-shot unified -> split configuration migration (issue #68).
 *
 * The unified config.yaml format is retired; this migration is the only reader
 * of that shape and converts it into split policy.yaml + operational config.yaml.
 * It must route trust-critical data (team, gates, security settings) to policy
 * and operational data (suites, command settings) to the operational config, and
 * it must refuse to resurrect the insecure gate-less (`packages`-only) suite.
 *
 * @see https://github.com/mike-north/attest-it/issues/68
 */

import { describe, expect, it } from 'vitest'
import {
  migrateUnifiedConfig,
  migrateUnifiedContent,
  UnifiedMigrationError,
} from '../../src/config/migrations/unified-to-split.js'

const UNIFIED_YAML = `version: 1

settings:
  maxAgeDays: 45
  publicKeyPath: .attest-it/pubkey.pem
  sealsPath: .attest-it/seals.json
  defaultCommand: pnpm test
  keyProvider:
    type: filesystem
    options:
      privateKeyPath: .attest-it/private.pem

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

groups:
  quick:
    - unit
`

describe('migrateUnifiedConfig (issue #68)', () => {
  it('routes trust-critical data (team, gates, security settings) to policy', () => {
    const { policy } = migrateUnifiedContent(UNIFIED_YAML, 'yaml')

    expect(policy.version).toBe(1)
    expect(policy.settings.maxAgeDays).toBe(45)
    expect(policy.settings.publicKeyPath).toBe('.attest-it/pubkey.pem')
    expect(policy.settings.sealsPath).toBe('.attest-it/seals.json')
    expect(policy.team?.alice?.name).toBe('Alice')
    expect(policy.gates?.['unit-gate']?.authorizedSigners).toEqual(['alice'])
  })

  it('routes operational data (suites, groups, command settings) to the operational config', () => {
    const { operational } = migrateUnifiedContent(UNIFIED_YAML, 'yaml')

    expect(operational.version).toBe(1)
    expect(operational.settings.defaultCommand).toBe('pnpm test')
    expect(operational.settings.keyProvider?.type).toBe('filesystem')
    expect(operational.suites.unit.gate).toBe('unit-gate')
    expect(operational.groups?.quick).toEqual(['unit'])
  })

  it('does not leak trust data into the operational config', () => {
    const { operational } = migrateUnifiedContent(UNIFIED_YAML, 'yaml')
    // team/gates must never appear in the operational (PR-reachable) config.
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- OperationalConfig has no team/gates fields; assert to unknown to probe for their absence at runtime
    expect((operational as Record<string, unknown>).team).toBeUndefined()
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- see above
    expect((operational as Record<string, unknown>).gates).toBeUndefined()
  })

  it('produces a split pair that both validate under the current schemas', () => {
    // migrateUnifiedConfig validates its output against policySchemaV1 /
    // operationalSchemaV1 before returning, so a successful call is proof the
    // migrated repo will load under the current rules.
    const result = migrateUnifiedContent(UNIFIED_YAML, 'yaml')
    expect(result.policy).toBeDefined()
    expect(result.operational).toBeDefined()
  })

  it('refuses to migrate a legacy gate-less (packages-only) suite', () => {
    const legacyYaml = `version: 1
team: {}
gates: {}
suites:
  unit:
    packages:
      - src
`
    expect(() => migrateUnifiedContent(legacyYaml, 'yaml')).toThrow(UnifiedMigrationError)
  })

  it('throws UnifiedMigrationError on structurally invalid input', () => {
    expect(() => migrateUnifiedConfig({ not: 'a config' })).toThrow(UnifiedMigrationError)
  })

  it('throws UnifiedMigrationError on unparseable YAML', () => {
    expect(() => migrateUnifiedContent(':\n  - [unbalanced', 'yaml')).toThrow(UnifiedMigrationError)
  })
})
