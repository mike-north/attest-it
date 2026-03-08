/**
 * Unit tests for attestation file I/O module.
 */

import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  readAttestations,
  readAttestationsSync,
  writeAttestations,
  writeAttestationsSync,
  findAttestation,
  upsertAttestation,
  removeAttestation,
  canonicalizeAttestations,
  createAttestation,
} from '../src/attestation.js'
import type { Attestation, AttestationsFile } from '../src/types.js'

// Test fixtures paths
const FIXTURES_DIR = path.join(__dirname, 'fixtures', 'attestations')
const VALID_FILE = path.join(FIXTURES_DIR, 'valid.json')
const INVALID_SCHEMA_FILE = path.join(FIXTURES_DIR, 'invalid-schema.json')
const INVALID_FINGERPRINT_FILE = path.join(FIXTURES_DIR, 'invalid-fingerprint.json')
const EMPTY_FILE = path.join(FIXTURES_DIR, 'empty.json')

// Temporary test directory
const TEST_DIR = path.join(os.tmpdir(), 'attest-it-test', Date.now().toString())

/**
 * Helper to create a test attestation.
 */
function createTestAttestation(overrides?: Partial<Attestation>): Attestation {
  return {
    suite: 'unit',
    fingerprint: 'sha256:1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
    attestedAt: '2024-01-15T10:30:00.000Z',
    attestedBy: 'testuser',
    command: 'npm test',
    exitCode: 0,
    ...overrides,
  }
}

/**
 * Helper to create a test attestations file.
 */
function createTestAttestationsFile(attestations: Attestation[] = []): AttestationsFile {
  return {
    schemaVersion: '1',
    attestations,
    signature: 'test-signature',
  }
}

describe('readAttestations (async)', () => {
  it('should read valid attestations file', async () => {
    const result = await readAttestations(VALID_FILE)
    expect(result).not.toBeNull()
    expect(result?.schemaVersion).toBe('1')
    expect(result?.attestations).toHaveLength(2)
    expect(result?.attestations[0]?.suite).toBe('unit')
    expect(result?.attestations[1]?.suite).toBe('integration')
  })

  it('should return null for non-existent file', async () => {
    const nonExistent = path.join(TEST_DIR, 'nonexistent.json')
    const result = await readAttestations(nonExistent)
    expect(result).toBeNull()
  })

  it('should throw on invalid JSON', async () => {
    const invalidFile = path.join(TEST_DIR, 'invalid.json')
    fs.mkdirSync(path.dirname(invalidFile), { recursive: true })
    fs.writeFileSync(invalidFile, 'not valid json', 'utf-8')

    await expect(readAttestations(invalidFile)).rejects.toThrow()
  })

  it('should throw on invalid schema version', async () => {
    await expect(readAttestations(INVALID_SCHEMA_FILE)).rejects.toThrow()
  })

  it('should throw on invalid fingerprint format', async () => {
    await expect(readAttestations(INVALID_FINGERPRINT_FILE)).rejects.toThrow()
  })

  it('should successfully read empty attestations array', async () => {
    const result = await readAttestations(EMPTY_FILE)
    expect(result).not.toBeNull()
    expect(result?.attestations).toEqual([])
  })
})

describe('readAttestationsSync', () => {
  it('should read valid attestations file', () => {
    const result = readAttestationsSync(VALID_FILE)
    expect(result).not.toBeNull()
    expect(result?.schemaVersion).toBe('1')
    expect(result?.attestations).toHaveLength(2)
  })

  it('should return null for non-existent file', () => {
    const nonExistent = path.join(TEST_DIR, 'nonexistent-sync.json')
    const result = readAttestationsSync(nonExistent)
    expect(result).toBeNull()
  })

  it('should throw on invalid JSON', () => {
    const invalidFile = path.join(TEST_DIR, 'invalid-sync.json')
    fs.mkdirSync(path.dirname(invalidFile), { recursive: true })
    fs.writeFileSync(invalidFile, 'not valid json', 'utf-8')

    expect(() => readAttestationsSync(invalidFile)).toThrow()
  })
})

describe('writeAttestations (async)', () => {
  const testFile = path.join(TEST_DIR, 'write-test.json')

  beforeEach(() => {
    fs.mkdirSync(TEST_DIR, { recursive: true })
  })

  afterEach(() => {
    if (fs.existsSync(testFile)) {
      fs.unlinkSync(testFile)
    }
  })

  it('should write attestations file', async () => {
    const attestations = [createTestAttestation()]
    await writeAttestations(testFile, attestations, 'test-sig')

    expect(fs.existsSync(testFile)).toBe(true)
    const result = await readAttestations(testFile)
    expect(result?.attestations).toHaveLength(1)
    expect(result?.signature).toBe('test-sig')
  })

  it('should create parent directories if needed', async () => {
    const nestedFile = path.join(TEST_DIR, 'nested', 'deep', 'test.json')
    const attestations = [createTestAttestation()]
    await writeAttestations(nestedFile, attestations, 'test-sig')

    expect(fs.existsSync(nestedFile)).toBe(true)
    const result = await readAttestations(nestedFile)
    expect(result?.attestations).toHaveLength(1)
  })

  it('should validate attestations before writing', async () => {
    // Create an invalid attestation without using type assertions
    // This will fail validation because the fingerprint format is invalid
    const invalidAttestation: Attestation = {
      suite: 'test',
      fingerprint: 'invalid', // This should fail Zod validation
      attestedAt: '2024-01-15T10:30:00.000Z',
      attestedBy: 'user',
      command: 'test',
      exitCode: 0,
    }

    await expect(writeAttestations(testFile, [invalidAttestation], 'sig')).rejects.toThrow()
  })

  it('should reject non-zero exit codes', async () => {
    // Create an object with exitCode: 1, which should fail Zod validation
    // We can't create a valid Attestation with exitCode !== 0, so we bypass
    // TypeScript by passing it through unknown to test runtime validation
    const invalidData: unknown = {
      ...createTestAttestation(),
      exitCode: 1, // Invalid: must be 0
    }

    await expect(
      // Intentionally passing invalid data to test runtime validation
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument, @typescript-eslint/consistent-type-assertions
      writeAttestations(testFile, [invalidData] as any, 'sig'),
    ).rejects.toThrow()
  })
})

describe('writeAttestationsSync', () => {
  const testFile = path.join(TEST_DIR, 'write-sync-test.json')

  beforeEach(() => {
    fs.mkdirSync(TEST_DIR, { recursive: true })
  })

  afterEach(() => {
    if (fs.existsSync(testFile)) {
      fs.unlinkSync(testFile)
    }
  })

  it('should write attestations file', () => {
    const attestations = [createTestAttestation()]
    writeAttestationsSync(testFile, attestations, 'test-sig')

    expect(fs.existsSync(testFile)).toBe(true)
    const result = readAttestationsSync(testFile)
    expect(result?.attestations).toHaveLength(1)
  })

  it('should create parent directories if needed', () => {
    const nestedFile = path.join(TEST_DIR, 'nested', 'deep', 'sync-test.json')
    const attestations = [createTestAttestation()]
    writeAttestationsSync(nestedFile, attestations, 'test-sig')

    expect(fs.existsSync(nestedFile)).toBe(true)
  })
})

describe('findAttestation', () => {
  it('should find attestation by suite name', () => {
    const attestations = createTestAttestationsFile([
      createTestAttestation({ suite: 'unit' }),
      createTestAttestation({ suite: 'integration' }),
    ])

    const result = findAttestation(attestations, 'integration')
    expect(result).toBeDefined()
    expect(result?.suite).toBe('integration')
  })

  it('should return undefined if suite not found', () => {
    const attestations = createTestAttestationsFile([createTestAttestation({ suite: 'unit' })])

    const result = findAttestation(attestations, 'nonexistent')
    expect(result).toBeUndefined()
  })

  it('should return undefined for empty attestations', () => {
    const attestations = createTestAttestationsFile([])
    const result = findAttestation(attestations, 'unit')
    expect(result).toBeUndefined()
  })
})

describe('upsertAttestation', () => {
  it('should add new attestation', () => {
    const existing = [createTestAttestation({ suite: 'unit' })]
    const newAttestation = createTestAttestation({ suite: 'integration' })

    const result = upsertAttestation(existing, newAttestation)

    expect(result).toHaveLength(2)
    expect(result[1]?.suite).toBe('integration')
    // Verify immutability
    expect(existing).toHaveLength(1)
  })

  it('should update existing attestation', () => {
    const existing = [
      createTestAttestation({
        suite: 'unit',
        fingerprint: 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
      }),
    ]
    const updated = createTestAttestation({
      suite: 'unit',
      fingerprint: 'sha256:1111111111111111111111111111111111111111111111111111111111111111',
    })

    const result = upsertAttestation(existing, updated)

    expect(result).toHaveLength(1)
    expect(result[0]?.fingerprint).toBe(
      'sha256:1111111111111111111111111111111111111111111111111111111111111111',
    )
    // Verify immutability
    expect(existing[0]?.fingerprint).toBe(
      'sha256:0000000000000000000000000000000000000000000000000000000000000000',
    )
  })

  it('should validate new attestation', () => {
    const existing: Attestation[] = []
    // Create an invalid attestation without using type assertions
    // This will fail validation because the fingerprint format is invalid
    const invalid: Attestation = {
      suite: 'test',
      fingerprint: 'invalid', // This should fail Zod validation
      attestedAt: '2024-01-15T10:30:00.000Z',
      attestedBy: 'user',
      command: 'test',
      exitCode: 0,
    }

    expect(() => upsertAttestation(existing, invalid)).toThrow()
  })
})

describe('removeAttestation', () => {
  it('should remove attestation by suite', () => {
    const existing = [
      createTestAttestation({ suite: 'unit' }),
      createTestAttestation({ suite: 'integration' }),
      createTestAttestation({ suite: 'e2e' }),
    ]

    const result = removeAttestation(existing, 'integration')

    expect(result).toHaveLength(2)
    expect(result.find((a) => a.suite === 'integration')).toBeUndefined()
    expect(result[0]?.suite).toBe('unit')
    expect(result[1]?.suite).toBe('e2e')
    // Verify immutability
    expect(existing).toHaveLength(3)
  })

  it('should return unchanged array if suite not found', () => {
    const existing = [createTestAttestation({ suite: 'unit' })]

    const result = removeAttestation(existing, 'nonexistent')

    expect(result).toHaveLength(1)
    expect(result[0]?.suite).toBe('unit')
  })

  it('should handle empty array', () => {
    const result = removeAttestation([], 'unit')
    expect(result).toEqual([])
  })
})

describe('canonicalizeAttestations', () => {
  it('should produce deterministic output', () => {
    const attestations = [createTestAttestation()]

    const result1 = canonicalizeAttestations(attestations)
    const result2 = canonicalizeAttestations(attestations)

    expect(result1).toBe(result2)
  })

  it('should have no whitespace between tokens', () => {
    const attestations = [createTestAttestation({ command: 'test' })] // Use single-word command
    const result = canonicalizeAttestations(attestations)

    // Check that there's no whitespace between JSON tokens
    // String values can contain spaces, but JSON structure should not
    expect(result).not.toMatch(/\s(?=([^"]*"[^"]*")*[^"]*$)/) // No whitespace outside strings
    expect(result).not.toMatch(/,\s/) // No whitespace after commas
    expect(result).not.toMatch(/:\s/) // No whitespace after colons
    expect(result).not.toMatch(/\{\s/) // No whitespace after {
    expect(result).not.toMatch(/\s\}/) // No whitespace before }
    expect(result).not.toMatch(/\[\s/) // No whitespace after [
    expect(result).not.toMatch(/\s\]/) // No whitespace before ]
  })

  it('should sort keys lexicographically', () => {
    const attestations = [createTestAttestation()]
    const result = canonicalizeAttestations(attestations)

    // After canonicalization, keys should be in this order:
    // attestedAt, attestedBy, command, exitCode, fingerprint, suite
    expect(result).toMatch(
      /"attestedAt".*"attestedBy".*"command".*"exitCode".*"fingerprint".*"suite"/,
    )
  })

  it('should produce identical output for differently ordered input', () => {
    // Create attestations with same data but different property order
    const attestation1: Attestation = {
      suite: 'unit',
      fingerprint: 'sha256:1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
      attestedAt: '2024-01-15T10:30:00.000Z',
      attestedBy: 'testuser',
      command: 'npm test',
      exitCode: 0,
    }

    const attestation2: Attestation = {
      exitCode: 0,
      command: 'npm test',
      attestedBy: 'testuser',
      attestedAt: '2024-01-15T10:30:00.000Z',
      fingerprint: 'sha256:1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
      suite: 'unit',
    }

    const result1 = canonicalizeAttestations([attestation1])
    const result2 = canonicalizeAttestations([attestation2])

    expect(result1).toBe(result2)
  })

  it('should handle empty array', () => {
    const result = canonicalizeAttestations([])
    expect(result).toBe('[]')
  })

  it('should handle multiple attestations', () => {
    const attestations = [
      createTestAttestation({ suite: 'unit' }),
      createTestAttestation({ suite: 'integration' }),
    ]

    const result = canonicalizeAttestations(attestations)
    expect(result).toContain('"suite":"unit"')
    expect(result).toContain('"suite":"integration"')
  })
})

describe('createAttestation', () => {
  it('should create attestation with defaults', () => {
    const result = createAttestation({
      suite: 'unit',
      fingerprint: 'sha256:1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
      command: 'npm test',
    })

    expect(result.suite).toBe('unit')
    expect(result.fingerprint).toBe(
      'sha256:1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
    )
    expect(result.command).toBe('npm test')
    expect(result.exitCode).toBe(0)
    expect(result.attestedBy).toBe(os.userInfo().username)
    expect(result.attestedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
  })

  it('should use provided attestedBy', () => {
    const result = createAttestation({
      suite: 'unit',
      fingerprint: 'sha256:1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
      command: 'npm test',
      attestedBy: 'custom-user',
    })

    expect(result.attestedBy).toBe('custom-user')
  })

  it('should reject invalid fingerprint format', () => {
    expect(() =>
      createAttestation({
        suite: 'unit',
        fingerprint: 'invalid',
        command: 'npm test',
      }),
    ).toThrow()
  })

  it('should reject empty suite name', () => {
    expect(() =>
      createAttestation({
        suite: '',
        fingerprint: 'sha256:1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        command: 'npm test',
      }),
    ).toThrow()
  })

  it('should reject empty command', () => {
    expect(() =>
      createAttestation({
        suite: 'unit',
        fingerprint: 'sha256:1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        command: '',
      }),
    ).toThrow()
  })
})

describe('Integration tests', () => {
  const testFile = path.join(TEST_DIR, 'integration-test.json')

  beforeEach(() => {
    fs.mkdirSync(TEST_DIR, { recursive: true })
  })

  afterEach(() => {
    if (fs.existsSync(testFile)) {
      fs.unlinkSync(testFile)
    }
  })

  it('should handle full workflow: create, write, read, update', async () => {
    // Create initial attestation
    const attestation1 = createAttestation({
      suite: 'unit',
      fingerprint: 'sha256:1111111111111111111111111111111111111111111111111111111111111111',
      command: 'npm test',
      attestedBy: 'user1',
    })

    // Write to file
    await writeAttestations(testFile, [attestation1], 'sig1')

    // Read back
    const read1 = await readAttestations(testFile)
    expect(read1?.attestations).toHaveLength(1)
    expect(read1?.attestations[0]?.suite).toBe('unit')

    // Update with new attestation
    const attestation2 = createAttestation({
      suite: 'integration',
      fingerprint: 'sha256:2222222222222222222222222222222222222222222222222222222222222222',
      command: 'npm run test:integration',
      attestedBy: 'user1',
    })

    const updated = upsertAttestation(read1?.attestations ?? [], attestation2)
    await writeAttestations(testFile, updated, 'sig2')

    // Read back updated file
    const read2 = await readAttestations(testFile)
    expect(read2?.attestations).toHaveLength(2)
    expect(read2?.signature).toBe('sig2')

    // Find specific attestation
    if (!read2) throw new Error('Expected read2 to be defined')
    const found = findAttestation(read2, 'integration')
    expect(found?.suite).toBe('integration')

    // Remove attestation
    const removed = removeAttestation(read2.attestations, 'unit')
    await writeAttestations(testFile, removed, 'sig3')

    // Read back after removal
    const read3 = await readAttestations(testFile)
    expect(read3?.attestations).toHaveLength(1)
    expect(read3?.attestations[0]?.suite).toBe('integration')
  })
})
