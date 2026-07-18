import { describe, it, expect } from 'vitest'
import { resolveGateAuthorization } from '../src/commands/team/utils.js'
import type { PolicyConfig } from '@attest-it/core'

type GateConfig = NonNullable<PolicyConfig['gates']>[string]

function makeGate(overrides: Partial<GateConfig> = {}): GateConfig {
  return {
    name: 'Release gate',
    description: 'Release approval gate',
    authorizedSigners: [],
    fingerprint: { paths: ['src/**'] },
    maxAge: '30d',
    ...overrides,
  }
}

describe('resolveGateAuthorization', () => {
  it('should resolve a --gates flag naming real gate IDs', async () => {
    const gates = { release: makeGate() }

    const result = await resolveGateAuthorization(gates, 'release')

    expect(result).toEqual(['release'])
  })

  it('should throw naming unknown gate IDs from a --gates flag', async () => {
    const gates = { release: makeGate() }

    await expect(resolveGateAuthorization(gates, 'release,nonexistent')).rejects.toThrow(
      'nonexistent',
    )
  })

  it('should reject a gate ID that only matches an inherited Object.prototype property', async () => {
    // Regression test: `!gates[id]` treated `gates['toString']` as a known
    // gate because Object.prototype.toString is a truthy function value, so
    // an id of `toString` (or `constructor`, `hasOwnProperty`, etc.) silently
    // passed validation despite not being a real, own gate entry.
    const gates = { release: makeGate() }

    await expect(resolveGateAuthorization(gates, 'toString')).rejects.toThrow(
      '--gates references unknown gate(s): toString',
    )
  })

  it('should return an empty array when --gates is omitted and no gates are configured', async () => {
    const result = await resolveGateAuthorization(undefined, undefined)

    expect(result).toEqual([])
  })

  // Regression test for issue #135: `--gates <name>` naming a gate that
  // doesn't exist silently succeeded (returned `[]`) whenever `gates` was
  // undefined or `{}`, because that case short-circuited *before* the flag
  // was ever validated. A trust-critical authorization command must hard-fail
  // naming the missing gate instead of silently doing nothing.
  it('should throw naming the missing gate when --gates is supplied but no gates are configured at all', async () => {
    await expect(resolveGateAuthorization(undefined, 'release')).rejects.toThrow(
      '--gates references unknown gate(s): release',
    )
  })

  it('should throw naming the missing gate when --gates is supplied but gates is an empty object', async () => {
    await expect(resolveGateAuthorization({}, 'my-gate')).rejects.toThrow(
      '--gates references unknown gate(s): my-gate',
    )
  })
})
