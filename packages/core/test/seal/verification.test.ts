/**
 * Tests for seal verification logic.
 */

import { describe, expect, it } from 'vitest'
import { verifyGateSeal, verifyAllSeals, type SealsFile, createSeal } from '../../src/seal/index.js'
import type { AttestItConfig } from '../../src/types.js'
import { generateKeyPair, sign } from '../../src/crypto/ed25519.js'
import type { Seal } from '../../src/seal/types.js'

/**
 * Test helper to create a minimal valid config with team and gates.
 */
function createTestConfig(): AttestItConfig {
  const { publicKey } = generateKeyPair()

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
        publicKey,
      },
      bob: {
        name: 'Bob Engineer',
        email: 'bob@example.com',
        publicKey: 'bob-public-key-base64',
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
    },
    suites: {
      unit: {
        gate: 'unit-tests',
        command: 'npm test',
      },
    },
  }
}

/**
 * Create an empty seals file.
 */
function createEmptySealsFile(): SealsFile {
  return {
    version: 1,
    seals: {},
  }
}

describe('verifyGateSeal - VALID state', () => {
  it('should return VALID when all checks pass', () => {
    const { publicKey, privateKey } = generateKeyPair()
    const config = createTestConfig()
    config.team ??= {}
    config.team.alice = {
      name: 'Alice Developer',
      publicKey,
    }

    const fingerprint = 'sha256:abc123'
    const seal = createSeal({
      gateId: 'unit-tests',
      fingerprint,
      sealedBy: 'alice',
      privateKey,
    })

    const seals: SealsFile = {
      version: 1,
      seals: {
        'unit-tests': seal,
      },
    }

    const result = verifyGateSeal(config, 'unit-tests', seals, fingerprint)

    expect(result.state).toBe('VALID')
    expect(result.seal).toEqual(seal)
    expect(result.message).toBeUndefined()
  })

  it('should return VALID for gate with recent seal within maxAge', () => {
    const { publicKey, privateKey } = generateKeyPair()
    const config = createTestConfig()
    config.team ??= {}
    config.team.alice = {
      name: 'Alice Developer',
      publicKey,
    }
    config.gates ??= {}
    config.gates['short-maxage'] = {
      name: 'Short MaxAge',
      description: 'Test gate with short maxAge',
      authorizedSigners: ['alice'],
      fingerprint: { paths: ['**/*'] },
      maxAge: '1h', // 1 hour
    }

    const fingerprint = 'sha256:abc123'
    const seal = createSeal({
      gateId: 'short-maxage',
      fingerprint,
      sealedBy: 'alice',
      privateKey,
    })

    const seals: SealsFile = {
      version: 1,
      seals: {
        'short-maxage': seal,
      },
    }

    const result = verifyGateSeal(config, 'short-maxage', seals, fingerprint)

    expect(result.state).toBe('VALID')
  })
})

describe('verifyGateSeal - MISSING state', () => {
  it('should return MISSING when no seal exists for gate', () => {
    const config = createTestConfig()
    const seals = createEmptySealsFile()

    const result = verifyGateSeal(config, 'unit-tests', seals, 'sha256:abc123')

    expect(result.state).toBe('MISSING')
    expect(result.seal).toBeUndefined()
    expect(result.message).toContain('No seal found')
  })

  it('should return MISSING when gate does not exist in config', () => {
    const config = createTestConfig()
    const seals = createEmptySealsFile()

    const result = verifyGateSeal(config, 'nonexistent-gate', seals, 'sha256:abc123')

    expect(result.state).toBe('MISSING')
    expect(result.message).toContain('not found in configuration')
  })

  it('should return MISSING for gates section with empty seals', () => {
    const config = createTestConfig()
    const seals: SealsFile = {
      version: 1,
      seals: {
        'integration-tests': createSeal({
          gateId: 'integration-tests',
          fingerprint: 'sha256:def456',
          sealedBy: 'alice',
          privateKey: generateKeyPair().privateKey,
        }),
      },
    }

    const result = verifyGateSeal(config, 'unit-tests', seals, 'sha256:abc123')

    expect(result.state).toBe('MISSING')
  })
})

describe('verifyGateSeal - STALE state', () => {
  it('should return STALE when seal exceeds maxAge', () => {
    const { publicKey, privateKey } = generateKeyPair()
    const config = createTestConfig()
    config.team ??= {}
    config.team.alice = {
      name: 'Alice Developer',
      publicKey,
    }

    const fingerprint = 'sha256:abc123'
    // Set timestamp to 8 days ago (maxAge is 7d)
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString()

    // Create a seal with old timestamp by signing the old canonical string
    const gateId = 'unit-tests'
    const canonicalString = `${gateId}:${fingerprint}:${eightDaysAgo}`
    const signature = sign(canonicalString, privateKey)

    const seal: Seal = {
      gateId,
      fingerprint,
      timestamp: eightDaysAgo,
      sealedBy: 'alice',
      signature,
    }

    const seals: SealsFile = {
      version: 1,
      seals: {
        'unit-tests': seal,
      },
    }

    const result = verifyGateSeal(config, 'unit-tests', seals, fingerprint)

    expect(result.state).toBe('STALE')
    expect(result.seal).toEqual(seal)
    expect(result.message).toContain('exceeds maxAge')
  })

  it('should return STALE when seal is significantly older than maxAge', () => {
    const { publicKey, privateKey } = generateKeyPair()
    const config = createTestConfig()
    config.team ??= {}
    config.team.alice = {
      name: 'Alice Developer',
      publicKey,
    }

    const fingerprint = 'sha256:abc123'
    // Set timestamp to 30 days ago (maxAge is 7d)
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()

    const gateId = 'unit-tests'
    const canonicalString = `${gateId}:${fingerprint}:${thirtyDaysAgo}`
    const signature = sign(canonicalString, privateKey)

    const seal: Seal = {
      gateId,
      fingerprint,
      timestamp: thirtyDaysAgo,
      sealedBy: 'alice',
      signature,
    }

    const seals: SealsFile = {
      version: 1,
      seals: {
        'unit-tests': seal,
      },
    }

    const result = verifyGateSeal(config, 'unit-tests', seals, fingerprint)

    expect(result.state).toBe('STALE')
    expect(result.message).toContain('30 days old')
  })

  it('should return STALE for hour-based maxAge', () => {
    const { publicKey, privateKey } = generateKeyPair()
    const config = createTestConfig()
    config.team ??= {}
    config.team.alice = {
      name: 'Alice Developer',
      publicKey,
    }
    config.gates ??= {}
    config.gates['hourly-gate'] = {
      name: 'Hourly Gate',
      description: 'Gate with hour-based maxAge',
      authorizedSigners: ['alice'],
      fingerprint: { paths: ['**/*'] },
      maxAge: '2h',
    }

    const fingerprint = 'sha256:abc123'
    // Set timestamp to 3 hours ago (maxAge is 2h)
    const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString()

    const gateId = 'hourly-gate'
    const canonicalString = `${gateId}:${fingerprint}:${threeHoursAgo}`
    const signature = sign(canonicalString, privateKey)

    const seal: Seal = {
      gateId,
      fingerprint,
      timestamp: threeHoursAgo,
      sealedBy: 'alice',
      signature,
    }

    const seals: SealsFile = {
      version: 1,
      seals: {
        'hourly-gate': seal,
      },
    }

    const result = verifyGateSeal(config, 'hourly-gate', seals, fingerprint)

    expect(result.state).toBe('STALE')
  })
})

describe('verifyGateSeal - FINGERPRINT_MISMATCH state', () => {
  it('should return FINGERPRINT_MISMATCH when fingerprints do not match', () => {
    const { publicKey, privateKey } = generateKeyPair()
    const config = createTestConfig()
    config.team ??= {}
    config.team.alice = {
      name: 'Alice Developer',
      publicKey,
    }

    const sealFingerprint = 'sha256:abc123'
    const currentFingerprint = 'sha256:def456'

    const seal = createSeal({
      gateId: 'unit-tests',
      fingerprint: sealFingerprint,
      sealedBy: 'alice',
      privateKey,
    })

    const seals: SealsFile = {
      version: 1,
      seals: {
        'unit-tests': seal,
      },
    }

    const result = verifyGateSeal(config, 'unit-tests', seals, currentFingerprint)

    expect(result.state).toBe('FINGERPRINT_MISMATCH')
    expect(result.seal).toEqual(seal)
    expect(result.message).toContain('Fingerprint changed')
  })

  it('should return FINGERPRINT_MISMATCH for slightly different fingerprints', () => {
    const { publicKey, privateKey } = generateKeyPair()
    const config = createTestConfig()
    config.team ??= {}
    config.team.alice = {
      name: 'Alice Developer',
      publicKey,
    }

    const seal = createSeal({
      gateId: 'unit-tests',
      fingerprint: 'sha256:abc123',
      sealedBy: 'alice',
      privateKey,
    })

    const seals: SealsFile = {
      version: 1,
      seals: {
        'unit-tests': seal,
      },
    }

    // Even one character difference should cause mismatch
    const result = verifyGateSeal(config, 'unit-tests', seals, 'sha256:abc124')

    expect(result.state).toBe('FINGERPRINT_MISMATCH')
  })
})

describe('verifyGateSeal - INVALID_SIGNATURE state', () => {
  it('should return INVALID_SIGNATURE when signature is tampered', () => {
    const { publicKey, privateKey } = generateKeyPair()
    const config = createTestConfig()
    config.team ??= {}
    config.team.alice = {
      name: 'Alice Developer',
      publicKey,
    }

    const fingerprint = 'sha256:abc123'
    const seal = createSeal({
      gateId: 'unit-tests',
      fingerprint,
      sealedBy: 'alice',
      privateKey,
    })

    // Tamper with the signature
    seal.signature = 'tampered-signature-value'

    const seals: SealsFile = {
      version: 1,
      seals: {
        'unit-tests': seal,
      },
    }

    const result = verifyGateSeal(config, 'unit-tests', seals, fingerprint)

    expect(result.state).toBe('INVALID_SIGNATURE')
    expect(result.seal).toEqual(seal)
    expect(result.message).toBeTruthy()
  })

  it('should return INVALID_SIGNATURE when seal signed with wrong key', () => {
    const aliceKeypair = generateKeyPair()
    const bobKeypair = generateKeyPair()

    const config = createTestConfig()
    config.team ??= {}
    config.team.alice = {
      name: 'Alice Developer',
      publicKey: aliceKeypair.publicKey,
    }

    const fingerprint = 'sha256:abc123'
    // Seal is signed with Bob's key but claims to be Alice
    const seal = createSeal({
      gateId: 'unit-tests',
      fingerprint,
      sealedBy: 'alice',
      privateKey: bobKeypair.privateKey,
    })

    const seals: SealsFile = {
      version: 1,
      seals: {
        'unit-tests': seal,
      },
    }

    const result = verifyGateSeal(config, 'unit-tests', seals, fingerprint)

    expect(result.state).toBe('INVALID_SIGNATURE')
  })
})

describe('verifyGateSeal - UNKNOWN_SIGNER state', () => {
  it('should return UNKNOWN_SIGNER when sealedBy is not in team', () => {
    const { privateKey } = generateKeyPair()
    const config = createTestConfig()

    const fingerprint = 'sha256:abc123'
    const seal = createSeal({
      gateId: 'unit-tests',
      fingerprint,
      sealedBy: 'unknown-person',
      privateKey,
    })

    const seals: SealsFile = {
      version: 1,
      seals: {
        'unit-tests': seal,
      },
    }

    const result = verifyGateSeal(config, 'unit-tests', seals, fingerprint)

    expect(result.state).toBe('UNKNOWN_SIGNER')
    expect(result.message).toContain('not found in team')
  })

  it('should return UNKNOWN_SIGNER when team config is missing', () => {
    const { privateKey } = generateKeyPair()
    const config = createTestConfig()
    delete config.team

    const fingerprint = 'sha256:abc123'
    const seal = createSeal({
      gateId: 'unit-tests',
      fingerprint,
      sealedBy: 'alice',
      privateKey,
    })

    const seals: SealsFile = {
      version: 1,
      seals: {
        'unit-tests': seal,
      },
    }

    const result = verifyGateSeal(config, 'unit-tests', seals, fingerprint)

    expect(result.state).toBe('UNKNOWN_SIGNER')
    expect(result.message).toContain('No team configuration')
  })

  it('should return UNKNOWN_SIGNER when signer is not authorized for gate', () => {
    const { publicKey, privateKey } = generateKeyPair()
    const config = createTestConfig()
    config.team ??= {}
    config.team.charlie = {
      name: 'Charlie Admin',
      publicKey,
    }

    // Charlie is not in authorizedSigners for unit-tests
    const fingerprint = 'sha256:abc123'
    const seal = createSeal({
      gateId: 'unit-tests',
      fingerprint,
      sealedBy: 'charlie',
      privateKey,
    })

    const seals: SealsFile = {
      version: 1,
      seals: {
        'unit-tests': seal,
      },
    }

    const result = verifyGateSeal(config, 'unit-tests', seals, fingerprint)

    expect(result.state).toBe('UNKNOWN_SIGNER')
    expect(result.message).toContain('not authorized for gate')
  })

  it('should return UNKNOWN_SIGNER for team member with wrong gate', () => {
    const { publicKey, privateKey } = generateKeyPair()
    const config = createTestConfig()
    config.team ??= {}
    config.team.bob = {
      name: 'Bob Engineer',
      publicKey,
    }

    // Bob is authorized for unit-tests but not integration-tests
    const fingerprint = 'sha256:abc123'
    const seal = createSeal({
      gateId: 'integration-tests',
      fingerprint,
      sealedBy: 'bob',
      privateKey,
    })

    const seals: SealsFile = {
      version: 1,
      seals: {
        'integration-tests': seal,
      },
    }

    const result = verifyGateSeal(config, 'integration-tests', seals, fingerprint)

    expect(result.state).toBe('UNKNOWN_SIGNER')
  })
})

describe('verifyAllSeals', () => {
  it('should verify all gates in config', () => {
    const aliceKeypair = generateKeyPair()
    const config = createTestConfig()
    config.team ??= {}
    config.team.alice = {
      name: 'Alice Developer',
      publicKey: aliceKeypair.publicKey,
    }

    const unitFingerprint = 'sha256:abc123'
    const integrationFingerprint = 'sha256:def456'

    const unitSeal = createSeal({
      gateId: 'unit-tests',
      fingerprint: unitFingerprint,
      sealedBy: 'alice',
      privateKey: aliceKeypair.privateKey,
    })

    const integrationSeal = createSeal({
      gateId: 'integration-tests',
      fingerprint: integrationFingerprint,
      sealedBy: 'alice',
      privateKey: aliceKeypair.privateKey,
    })

    const seals: SealsFile = {
      version: 1,
      seals: {
        'unit-tests': unitSeal,
        'integration-tests': integrationSeal,
      },
    }

    const fingerprints = {
      'unit-tests': unitFingerprint,
      'integration-tests': integrationFingerprint,
    }

    const results = verifyAllSeals(config, seals, fingerprints)

    expect(results).toHaveLength(2)
    expect(results.find((r) => r.gateId === 'unit-tests')?.state).toBe('VALID')
    expect(results.find((r) => r.gateId === 'integration-tests')?.state).toBe('VALID')
  })

  it('should return empty array when gates config is missing', () => {
    const config = createTestConfig()
    delete config.gates

    const results = verifyAllSeals(config, createEmptySealsFile(), {})

    expect(results).toEqual([])
  })

  it('should return MISSING for gates without computed fingerprints', () => {
    const config = createTestConfig()
    const seals = createEmptySealsFile()

    const results = verifyAllSeals(config, seals, {})

    expect(results).toHaveLength(2)
    results.forEach((result) => {
      expect(result.state).toBe('MISSING')
      expect(result.message).toContain('No fingerprint computed')
    })
  })

  it('should return mixed verification states', () => {
    const aliceKeypair = generateKeyPair()
    const config = createTestConfig()
    config.team ??= {}
    config.team.alice = {
      name: 'Alice Developer',
      publicKey: aliceKeypair.publicKey,
    }

    const unitFingerprint = 'sha256:abc123'
    const integrationFingerprint = 'sha256:def456'

    // Unit tests seal is valid
    const unitSeal = createSeal({
      gateId: 'unit-tests',
      fingerprint: unitFingerprint,
      sealedBy: 'alice',
      privateKey: aliceKeypair.privateKey,
    })

    // Integration tests seal has fingerprint mismatch
    const integrationSeal = createSeal({
      gateId: 'integration-tests',
      fingerprint: 'sha256:old-fingerprint',
      sealedBy: 'alice',
      privateKey: aliceKeypair.privateKey,
    })

    const seals: SealsFile = {
      version: 1,
      seals: {
        'unit-tests': unitSeal,
        'integration-tests': integrationSeal,
      },
    }

    const fingerprints = {
      'unit-tests': unitFingerprint,
      'integration-tests': integrationFingerprint,
    }

    const results = verifyAllSeals(config, seals, fingerprints)

    expect(results).toHaveLength(2)
    expect(results.find((r) => r.gateId === 'unit-tests')?.state).toBe('VALID')
    expect(results.find((r) => r.gateId === 'integration-tests')?.state).toBe(
      'FINGERPRINT_MISMATCH',
    )
  })

  it('should handle gates with missing seals', () => {
    const config = createTestConfig()
    const seals = createEmptySealsFile()

    const fingerprints = {
      'unit-tests': 'sha256:abc123',
      'integration-tests': 'sha256:def456',
    }

    const results = verifyAllSeals(config, seals, fingerprints)

    expect(results).toHaveLength(2)
    results.forEach((result) => {
      expect(result.state).toBe('MISSING')
      expect(result.message).toContain('No seal found')
    })
  })
})

describe('verification edge cases', () => {
  it('should handle gate with invalid maxAge gracefully', () => {
    const { publicKey, privateKey } = generateKeyPair()
    const config = createTestConfig()
    config.team ??= {}
    config.team.alice = {
      name: 'Alice Developer',
      publicKey,
    }
    config.gates ??= {}
    config.gates['bad-maxage'] = {
      name: 'Bad MaxAge',
      description: 'Gate with invalid maxAge',
      authorizedSigners: ['alice'],
      fingerprint: { paths: ['**/*'] },
      maxAge: 'invalid-duration',
    }

    const fingerprint = 'sha256:abc123'
    const seal = createSeal({
      gateId: 'bad-maxage',
      fingerprint,
      sealedBy: 'alice',
      privateKey,
    })

    const seals: SealsFile = {
      version: 1,
      seals: {
        'bad-maxage': seal,
      },
    }

    const result = verifyGateSeal(config, 'bad-maxage', seals, fingerprint)

    // Should return STALE (fail closed) when maxAge cannot be parsed
    // This prevents bypassing staleness checks with invalid maxAge values
    expect(result.state).toBe('STALE')
    expect(result.message).toContain('invalid maxAge format')
  })

  it('should verify seal just under maxAge boundary', () => {
    const { publicKey, privateKey } = generateKeyPair()
    const config = createTestConfig()
    config.team ??= {}
    config.team.alice = {
      name: 'Alice Developer',
      publicKey,
    }

    const fingerprint = 'sha256:abc123'
    // Set timestamp to 6.9 days ago (just under 7d maxAge)
    const almostSevenDaysAgo = new Date(Date.now() - 6.9 * 24 * 60 * 60 * 1000).toISOString()

    const gateId = 'unit-tests'
    const canonicalString = `${gateId}:${fingerprint}:${almostSevenDaysAgo}`
    const signature = sign(canonicalString, privateKey)

    const seal: Seal = {
      gateId,
      fingerprint,
      timestamp: almostSevenDaysAgo,
      sealedBy: 'alice',
      signature,
    }

    const seals: SealsFile = {
      version: 1,
      seals: {
        'unit-tests': seal,
      },
    }

    const result = verifyGateSeal(config, 'unit-tests', seals, fingerprint)

    // Just under the boundary, should still be valid
    expect(result.state).toBe('VALID')
  })
})

describe('verifyGateSeal - optional maxAge (indefinite gate, #69)', () => {
  it('never reports STALE for a gate with NO maxAge, regardless of seal age', () => {
    const { publicKey, privateKey } = generateKeyPair()
    const config = createTestConfig()
    config.team ??= {}
    config.team.alice = { name: 'Alice Developer', publicKey }
    config.gates ??= {}
    // A gate with maxAge omitted entirely (indefinite — never expires).
    config.gates.indefinite = {
      name: 'Indefinite',
      description: 'Sealed forever until content changes',
      authorizedSigners: ['alice'],
      fingerprint: { paths: ['**/*'] },
      // no maxAge
    }

    const fingerprint = 'sha256:abc123'
    // A seal from 1000 days ago — ancient by any duration standard.
    const ancient = new Date(Date.now() - 1000 * 24 * 60 * 60 * 1000).toISOString()
    const canonicalString = `indefinite:${fingerprint}:${ancient}`
    const seal: Seal = {
      gateId: 'indefinite',
      fingerprint,
      timestamp: ancient,
      sealedBy: 'alice',
      signature: sign(canonicalString, privateKey),
    }
    const seals: SealsFile = { version: 1, seals: { indefinite: seal } }

    const result = verifyGateSeal(config, 'indefinite', seals, fingerprint)
    expect(result.state).toBe('VALID')
    expect(result.state).not.toBe('STALE')
  })

  it('CONTRAST: the same ancient seal IS stale once the gate declares a maxAge', () => {
    const { publicKey, privateKey } = generateKeyPair()
    const config = createTestConfig()
    config.team ??= {}
    config.team.alice = { name: 'Alice Developer', publicKey }
    config.gates ??= {}
    config.gates.bounded = {
      name: 'Bounded',
      description: 'Expires after 30 days',
      authorizedSigners: ['alice'],
      fingerprint: { paths: ['**/*'] },
      maxAge: '30d',
    }

    const fingerprint = 'sha256:abc123'
    const ancient = new Date(Date.now() - 1000 * 24 * 60 * 60 * 1000).toISOString()
    const seal: Seal = {
      gateId: 'bounded',
      fingerprint,
      timestamp: ancient,
      sealedBy: 'alice',
      signature: sign(`bounded:${fingerprint}:${ancient}`, privateKey),
    }
    const seals: SealsFile = { version: 1, seals: { bounded: seal } }

    const result = verifyGateSeal(config, 'bounded', seals, fingerprint)
    expect(result.state).toBe('STALE')
  })
})

// Regression: a seal that is simultaneously FINGERPRINT_MISMATCH and STALE only
// ever reported FINGERPRINT_MISMATCH before `conditions` aggregation existed
// (#156) — discovered for real when 4 of this repo's own manual-attestation
// gates were simultaneously fingerprint-invalidated AND 172 days old against a
// 90-day maxAge, but only the fingerprint mismatch surfaced.
describe('verifyGateSeal - conditions aggregation (#156)', () => {
  it('reports FINGERPRINT_MISMATCH as the primary state but includes STALE in conditions when both fail', () => {
    const { publicKey, privateKey } = generateKeyPair()
    const config = createTestConfig()
    config.team ??= {}
    config.team.alice = { name: 'Alice Developer', publicKey }

    const sealFingerprint = 'sha256:sealed-content'
    const currentFingerprint = 'sha256:current-content'
    // 8 days ago; unit-tests gate has maxAge '7d'.
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString()
    const gateId = 'unit-tests'
    const seal: Seal = {
      gateId,
      fingerprint: sealFingerprint,
      timestamp: eightDaysAgo,
      sealedBy: 'alice',
      signature: sign(`${gateId}:${sealFingerprint}:${eightDaysAgo}`, privateKey),
    }
    const seals: SealsFile = { version: 1, seals: { [gateId]: seal } }

    const result = verifyGateSeal(config, gateId, seals, currentFingerprint)

    // Backward-compat: primary state/message unchanged from pre-aggregation behavior.
    expect(result.state).toBe('FINGERPRINT_MISMATCH')
    expect(result.message).toBe('Fingerprint changed since seal was created')

    // New: both independently-failing conditions are surfaced.
    expect(result.conditions).toHaveLength(2)
    expect(result.conditions?.[0]).toEqual({
      state: 'FINGERPRINT_MISMATCH',
      message: 'Fingerprint changed since seal was created',
    })
    expect(result.conditions?.[1]?.state).toBe('STALE')
    expect(result.conditions?.[1]?.message).toContain('exceeds maxAge')
  })

  it('omits `conditions` when only a single condition fails (no new noise in the common case)', () => {
    const { publicKey, privateKey } = generateKeyPair()
    const config = createTestConfig()
    config.team ??= {}
    config.team.alice = { name: 'Alice Developer', publicKey }

    const sealFingerprint = 'sha256:sealed-content'
    const currentFingerprint = 'sha256:current-content'
    const gateId = 'unit-tests'
    // Fresh timestamp — only the fingerprint check fails, staleness does not.
    const seal = createSeal({
      gateId,
      fingerprint: sealFingerprint,
      sealedBy: 'alice',
      privateKey,
    })
    const seals: SealsFile = { version: 1, seals: { [gateId]: seal } }

    const result = verifyGateSeal(config, gateId, seals, currentFingerprint)

    expect(result.state).toBe('FINGERPRINT_MISMATCH')
    expect(result.conditions).toBeUndefined()
  })

  it('never attaches `conditions` to a MISSING result (exclusive, produced before a seal exists to evaluate)', () => {
    const config = createTestConfig()
    const seals = createEmptySealsFile()

    const result = verifyGateSeal(config, 'unit-tests', seals, 'sha256:whatever')

    expect(result.state).toBe('MISSING')
    expect(result.conditions).toBeUndefined()
  })

  it('reports only UNKNOWN_SIGNER, never alongside INVALID_SIGNATURE, when the signer is unauthorized (signature check never runs)', () => {
    const { publicKey: charliePublicKey } = generateKeyPair()
    const { privateKey: wrongPrivateKey } = generateKeyPair()
    const config = createTestConfig()
    config.team ??= {}
    // Charlie is a known team member, but NOT in unit-tests' authorizedSigners.
    config.team.charlie = { name: 'Charlie Admin', publicKey: charliePublicKey }

    const fingerprint = 'sha256:abc123'
    const gateId = 'unit-tests'
    // Signed with an unrelated key, so signature validation — if it ever ran —
    // would ALSO fail. It must never run: signer resolution fails first.
    const seal = createSeal({
      gateId,
      fingerprint,
      sealedBy: 'charlie',
      privateKey: wrongPrivateKey,
    })
    const seals: SealsFile = { version: 1, seals: { [gateId]: seal } }

    const result = verifyGateSeal(config, gateId, seals, fingerprint)

    expect(result.state).toBe('UNKNOWN_SIGNER')
    expect(result.conditions).toBeUndefined()
  })
})
