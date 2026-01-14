/**
 * Tests for authorization logic.
 */

import { describe, expect, it } from 'vitest'
import {
  findTeamMemberByPublicKey,
  getAuthorizedSignersForGate,
  getGate,
  isAuthorizedSigner,
  parseDuration,
} from '../src/authorization.js'
import type { AttestItConfig } from '../src/types.js'

/**
 * Test helper to create a minimal valid config with team and gates.
 */
function createTestConfig(): AttestItConfig {
  return {
    version: 1,
    settings: {
      maxAgeDays: 30,
      publicKeyPath: '.attest-it/pubkey.pem',
      attestationsPath: '.attest-it/attestations.json',
    },
    team: {
      alice: {
        name: 'Alice Developer',
        email: 'alice@example.com',
        github: 'alice',
        publicKey: 'alice-public-key-base64',
      },
      bob: {
        name: 'Bob Engineer',
        email: 'bob@example.com',
        publicKey: 'bob-public-key-base64',
      },
      charlie: {
        name: 'Charlie Admin',
        github: 'charlie',
        publicKey: 'charlie-public-key-base64',
      },
    },
    gates: {
      'unit-tests': {
        name: 'Unit Tests',
        description: 'Core unit test suite',
        authorizedSigners: ['alice', 'bob'],
        fingerprint: {
          paths: ['src/**/*.ts', 'test/**/*.test.ts'],
          exclude: ['**/*.spec.ts'],
        },
        maxAge: '7d',
      },
      'integration-tests': {
        name: 'Integration Tests',
        description: 'Integration test suite',
        authorizedSigners: ['alice'],
        fingerprint: {
          paths: ['src/**/*.ts', 'test/integration/**/*.ts'],
        },
        maxAge: '30d',
      },
      'security-scan': {
        name: 'Security Scan',
        description: 'Security scanning',
        authorizedSigners: ['charlie'],
        fingerprint: {
          paths: ['**/*'],
        },
        maxAge: '24h',
      },
    },
    suites: {
      unit: {
        gate: 'unit-tests',
        command: 'npm test',
      },
    },
  }
}

describe('isAuthorizedSigner', () => {
  it('should return true when public key belongs to authorized signer', () => {
    const config = createTestConfig()
    expect(isAuthorizedSigner(config, 'unit-tests', 'alice-public-key-base64')).toBe(true)
    expect(isAuthorizedSigner(config, 'unit-tests', 'bob-public-key-base64')).toBe(true)
  })

  it('should return false when public key belongs to unauthorized signer', () => {
    const config = createTestConfig()
    // Charlie is not authorized for unit-tests
    expect(isAuthorizedSigner(config, 'unit-tests', 'charlie-public-key-base64')).toBe(false)
  })

  it('should return false when public key does not exist in team', () => {
    const config = createTestConfig()
    expect(isAuthorizedSigner(config, 'unit-tests', 'unknown-public-key')).toBe(false)
  })

  it('should return false when gate does not exist', () => {
    const config = createTestConfig()
    expect(isAuthorizedSigner(config, 'nonexistent-gate', 'alice-public-key-base64')).toBe(false)
  })

  it('should return false when gates section is missing', () => {
    const config = createTestConfig()
    delete config.gates
    expect(isAuthorizedSigner(config, 'unit-tests', 'alice-public-key-base64')).toBe(false)
  })

  it('should return false when team section is missing', () => {
    const config = createTestConfig()
    delete config.team
    expect(isAuthorizedSigner(config, 'unit-tests', 'alice-public-key-base64')).toBe(false)
  })

  it('should handle different gates with different authorized signers', () => {
    const config = createTestConfig()
    // Alice can sign for both unit-tests and integration-tests
    expect(isAuthorizedSigner(config, 'unit-tests', 'alice-public-key-base64')).toBe(true)
    expect(isAuthorizedSigner(config, 'integration-tests', 'alice-public-key-base64')).toBe(true)

    // Bob can only sign for unit-tests
    expect(isAuthorizedSigner(config, 'unit-tests', 'bob-public-key-base64')).toBe(true)
    expect(isAuthorizedSigner(config, 'integration-tests', 'bob-public-key-base64')).toBe(false)

    // Charlie can only sign for security-scan
    expect(isAuthorizedSigner(config, 'unit-tests', 'charlie-public-key-base64')).toBe(false)
    expect(isAuthorizedSigner(config, 'security-scan', 'charlie-public-key-base64')).toBe(true)
  })
})

describe('getAuthorizedSignersForGate', () => {
  it('should return all authorized team members for a gate', () => {
    const config = createTestConfig()
    const signers = getAuthorizedSignersForGate(config, 'unit-tests')

    expect(signers).toHaveLength(2)
    expect(signers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'Alice Developer' }),
        expect.objectContaining({ name: 'Bob Engineer' }),
      ]),
    )
  })

  it('should return single signer when only one is authorized', () => {
    const config = createTestConfig()
    const signers = getAuthorizedSignersForGate(config, 'integration-tests')

    expect(signers).toHaveLength(1)
    expect(signers[0]).toMatchObject({
      name: 'Alice Developer',
      email: 'alice@example.com',
      github: 'alice',
      publicKey: 'alice-public-key-base64',
    })
  })

  it('should return empty array when gate does not exist', () => {
    const config = createTestConfig()
    const signers = getAuthorizedSignersForGate(config, 'nonexistent-gate')

    expect(signers).toEqual([])
  })

  it('should return empty array when gates section is missing', () => {
    const config = createTestConfig()
    delete config.gates
    const signers = getAuthorizedSignersForGate(config, 'unit-tests')

    expect(signers).toEqual([])
  })

  it('should return empty array when team section is missing', () => {
    const config = createTestConfig()
    delete config.team
    const signers = getAuthorizedSignersForGate(config, 'unit-tests')

    expect(signers).toEqual([])
  })

  it('should skip team members that do not exist in team config', () => {
    const config = createTestConfig()
    // Add a gate with a non-existent team member
    config.gates ??= {}
    config.gates['broken-gate'] = {
      name: 'Broken Gate',
      description: 'Gate with invalid references',
      authorizedSigners: ['alice', 'nonexistent', 'bob'],
      fingerprint: { paths: ['**/*'] },
      maxAge: '7d',
    }

    const signers = getAuthorizedSignersForGate(config, 'broken-gate')

    // Should only return alice and bob, skipping the nonexistent member
    expect(signers).toHaveLength(2)
    expect(signers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'Alice Developer' }),
        expect.objectContaining({ name: 'Bob Engineer' }),
      ]),
    )
  })

  it('should return empty array when no authorized signers are valid', () => {
    const config = createTestConfig()
    config.gates ??= {}
    config.gates['empty-gate'] = {
      name: 'Empty Gate',
      description: 'Gate with no valid signers',
      authorizedSigners: ['nonexistent1', 'nonexistent2'],
      fingerprint: { paths: ['**/*'] },
      maxAge: '7d',
    }

    const signers = getAuthorizedSignersForGate(config, 'empty-gate')
    expect(signers).toEqual([])
  })
})

describe('findTeamMemberByPublicKey', () => {
  it('should find team member by exact public key match', () => {
    const config = createTestConfig()
    const member = findTeamMemberByPublicKey(config, 'alice-public-key-base64')

    expect(member).toMatchObject({
      name: 'Alice Developer',
      email: 'alice@example.com',
      github: 'alice',
      publicKey: 'alice-public-key-base64',
    })
  })

  it('should return undefined when public key does not exist', () => {
    const config = createTestConfig()
    const member = findTeamMemberByPublicKey(config, 'unknown-public-key')

    expect(member).toBeUndefined()
  })

  it('should return undefined when team section is missing', () => {
    const config = createTestConfig()
    delete config.team
    const member = findTeamMemberByPublicKey(config, 'alice-public-key-base64')

    expect(member).toBeUndefined()
  })

  it('should return undefined when team section is empty', () => {
    const config = createTestConfig()
    config.team = {}
    const member = findTeamMemberByPublicKey(config, 'alice-public-key-base64')

    expect(member).toBeUndefined()
  })

  it('should find different team members by their keys', () => {
    const config = createTestConfig()

    const alice = findTeamMemberByPublicKey(config, 'alice-public-key-base64')
    expect(alice).toMatchObject({ name: 'Alice Developer' })

    const bob = findTeamMemberByPublicKey(config, 'bob-public-key-base64')
    expect(bob).toMatchObject({ name: 'Bob Engineer' })

    const charlie = findTeamMemberByPublicKey(config, 'charlie-public-key-base64')
    expect(charlie).toMatchObject({ name: 'Charlie Admin' })
  })

  it('should handle team members with minimal fields', () => {
    const config = createTestConfig()
    // Bob only has name, email, and publicKey (no github)
    const bob = findTeamMemberByPublicKey(config, 'bob-public-key-base64')

    expect(bob).toMatchObject({
      name: 'Bob Engineer',
      email: 'bob@example.com',
      publicKey: 'bob-public-key-base64',
    })
    expect(bob?.github).toBeUndefined()
  })
})

describe('getGate', () => {
  it('should return gate configuration when it exists', () => {
    const config = createTestConfig()
    const gate = getGate(config, 'unit-tests')

    expect(gate).toMatchObject({
      name: 'Unit Tests',
      description: 'Core unit test suite',
      authorizedSigners: ['alice', 'bob'],
      fingerprint: {
        paths: ['src/**/*.ts', 'test/**/*.test.ts'],
        exclude: ['**/*.spec.ts'],
      },
      maxAge: '7d',
    })
  })

  it('should return undefined when gate does not exist', () => {
    const config = createTestConfig()
    const gate = getGate(config, 'nonexistent-gate')

    expect(gate).toBeUndefined()
  })

  it('should return undefined when gates section is missing', () => {
    const config = createTestConfig()
    delete config.gates
    const gate = getGate(config, 'unit-tests')

    expect(gate).toBeUndefined()
  })

  it('should return gate with fingerprint exclude field', () => {
    const config = createTestConfig()
    const gate = getGate(config, 'unit-tests')

    expect(gate?.fingerprint.exclude).toEqual(['**/*.spec.ts'])
  })

  it('should return gate without fingerprint exclude field when not present', () => {
    const config = createTestConfig()
    const gate = getGate(config, 'integration-tests')

    expect(gate?.fingerprint.exclude).toBeUndefined()
  })
})

describe('parseDuration', () => {
  it('should parse day durations', () => {
    expect(parseDuration('1d')).toBe(86400000) // 1 day in ms
    expect(parseDuration('7d')).toBe(604800000) // 7 days in ms
    expect(parseDuration('30d')).toBe(2592000000) // 30 days in ms
  })

  it('should parse hour durations', () => {
    expect(parseDuration('1h')).toBe(3600000) // 1 hour in ms
    expect(parseDuration('24h')).toBe(86400000) // 24 hours in ms
  })

  it('should parse minute durations', () => {
    expect(parseDuration('1m')).toBe(60000) // 1 minute in ms
    expect(parseDuration('30m')).toBe(1800000) // 30 minutes in ms
  })

  it('should parse second durations', () => {
    expect(parseDuration('1s')).toBe(1000) // 1 second in ms
    expect(parseDuration('30s')).toBe(30000) // 30 seconds in ms
  })

  it('should parse week durations', () => {
    expect(parseDuration('1w')).toBe(604800000) // 1 week in ms
    expect(parseDuration('2w')).toBe(1209600000) // 2 weeks in ms
  })

  it('should throw error for invalid duration strings', () => {
    expect(() => parseDuration('invalid')).toThrow('Invalid duration string: invalid')
    expect(() => parseDuration('')).toThrow('Invalid duration string: ')
    expect(() => parseDuration('xyz')).toThrow('Invalid duration string: xyz')
  })

  it('should throw error for negative durations', () => {
    expect(() => parseDuration('-1d')).toThrow('Invalid duration string: -1d')
  })
})

describe('authorization edge cases', () => {
  it('should handle empty authorizedSigners array', () => {
    const config = createTestConfig()
    config.gates ??= {}
    config.gates['no-signers'] = {
      name: 'No Signers',
      description: 'Gate with no authorized signers',
      authorizedSigners: [],
      fingerprint: { paths: ['**/*'] },
      maxAge: '7d',
    }

    expect(isAuthorizedSigner(config, 'no-signers', 'alice-public-key-base64')).toBe(false)
    expect(getAuthorizedSignersForGate(config, 'no-signers')).toEqual([])
  })

  it('should handle config with empty team object', () => {
    const config = createTestConfig()
    config.team = {}

    expect(isAuthorizedSigner(config, 'unit-tests', 'alice-public-key-base64')).toBe(false)
    expect(getAuthorizedSignersForGate(config, 'unit-tests')).toEqual([])
    expect(findTeamMemberByPublicKey(config, 'alice-public-key-base64')).toBeUndefined()
  })

  it('should handle config with empty gates object', () => {
    const config = createTestConfig()
    config.gates = {}

    expect(isAuthorizedSigner(config, 'unit-tests', 'alice-public-key-base64')).toBe(false)
    expect(getAuthorizedSignersForGate(config, 'unit-tests')).toEqual([])
    expect(getGate(config, 'unit-tests')).toBeUndefined()
  })

  it('should not confuse team members with similar names', () => {
    const config = createTestConfig()
    config.team ??= {}
    config.team.alice2 = {
      name: 'Alice Two',
      publicKey: 'alice2-public-key-base64',
    }

    const member = findTeamMemberByPublicKey(config, 'alice2-public-key-base64')
    expect(member).toMatchObject({ name: 'Alice Two' })

    const originalAlice = findTeamMemberByPublicKey(config, 'alice-public-key-base64')
    expect(originalAlice).toMatchObject({ name: 'Alice Developer' })
  })
})
