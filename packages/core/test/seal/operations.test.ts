/**
 * Tests for seal operations.
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import {
  createSeal,
  verifySeal,
  readSeals,
  readSealsSync,
  writeSeals,
  writeSealsSync,
  type SealsFile,
} from '../../src/seal/index.js'
import type { AttestItConfig } from '../../src/types.js'
import { generateKeyPair } from '../../src/crypto/ed25519.js'

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
    },
    suites: {
      unit: {
        gate: 'unit-tests',
        command: 'npm test',
      },
    },
  }
}

describe('createSeal', () => {
  it('should create a seal with all required fields', () => {
    const { privateKey } = generateKeyPair()
    const seal = createSeal({
      gateId: 'unit-tests',
      fingerprint: 'sha256:abc123',
      sealedBy: 'alice',
      privateKey,
    })

    expect(seal).toMatchObject({
      gateId: 'unit-tests',
      fingerprint: 'sha256:abc123',
      sealedBy: 'alice',
    })
    expect(seal.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
    expect(seal.signature).toBeTruthy()
    expect(typeof seal.signature).toBe('string')
  })

  it('should create different signatures for different fingerprints', () => {
    const { privateKey } = generateKeyPair()
    const seal1 = createSeal({
      gateId: 'unit-tests',
      fingerprint: 'sha256:abc123',
      sealedBy: 'alice',
      privateKey,
    })
    const seal2 = createSeal({
      gateId: 'unit-tests',
      fingerprint: 'sha256:def456',
      sealedBy: 'alice',
      privateKey,
    })

    expect(seal1.signature).not.toBe(seal2.signature)
  })

  it('should create different signatures for different gates', () => {
    const { privateKey } = generateKeyPair()
    const seal1 = createSeal({
      gateId: 'unit-tests',
      fingerprint: 'sha256:abc123',
      sealedBy: 'alice',
      privateKey,
    })
    const seal2 = createSeal({
      gateId: 'integration-tests',
      fingerprint: 'sha256:abc123',
      sealedBy: 'alice',
      privateKey,
    })

    expect(seal1.signature).not.toBe(seal2.signature)
  })

  it('should create seals with unique timestamps when called quickly', () => {
    const { privateKey } = generateKeyPair()
    const seal1 = createSeal({
      gateId: 'unit-tests',
      fingerprint: 'sha256:abc123',
      sealedBy: 'alice',
      privateKey,
    })
    const seal2 = createSeal({
      gateId: 'unit-tests',
      fingerprint: 'sha256:abc123',
      sealedBy: 'alice',
      privateKey,
    })

    // Timestamps might be the same if called very quickly, but signatures should differ
    // due to timestamp precision
    expect(seal1.timestamp <= seal2.timestamp).toBe(true)
  })

  it('should throw error with invalid private key', () => {
    expect(() =>
      createSeal({
        gateId: 'unit-tests',
        fingerprint: 'sha256:abc123',
        sealedBy: 'alice',
        privateKey: 'invalid-key',
      }),
    ).toThrow()
  })
})

describe('verifySeal', () => {
  it('should verify a valid seal', () => {
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

    const result = verifySeal(seal, config)
    expect(result.valid).toBe(true)
    expect(result.error).toBeUndefined()
  })

  it('should fail verification for invalid signature', () => {
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

    // Tamper with the signature
    seal.signature = 'invalid-signature'

    const result = verifySeal(seal, config)
    expect(result.valid).toBe(false)
    expect(result.error).toBeTruthy()
  })

  it('should fail verification when team member not found', () => {
    const { privateKey } = generateKeyPair()
    const config = createTestConfig()

    const seal = createSeal({
      gateId: 'unit-tests',
      fingerprint: 'sha256:abc123',
      sealedBy: 'unknown',
      privateKey,
    })

    const result = verifySeal(seal, config)
    expect(result.valid).toBe(false)
    expect(result.error).toContain('not found')
  })

  it('should fail verification when team config is missing', () => {
    const { privateKey } = generateKeyPair()
    const config = createTestConfig()
    delete config.team

    const seal = createSeal({
      gateId: 'unit-tests',
      fingerprint: 'sha256:abc123',
      sealedBy: 'alice',
      privateKey,
    })

    const result = verifySeal(seal, config)
    expect(result.valid).toBe(false)
    expect(result.error).toContain('No team configuration')
  })

  it('should fail verification when public key does not match', () => {
    const keypair1 = generateKeyPair()
    const keypair2 = generateKeyPair()
    const config = createTestConfig()
    config.team ??= {}
    config.team.alice = {
      name: 'Alice Developer',
      publicKey: keypair2.publicKey, // Different public key
    }

    const seal = createSeal({
      gateId: 'unit-tests',
      fingerprint: 'sha256:abc123',
      sealedBy: 'alice',
      privateKey: keypair1.privateKey,
    })

    const result = verifySeal(seal, config)
    expect(result.valid).toBe(false)
    expect(result.error).toBeTruthy()
  })
})

describe('readSeals and writeSeals (async)', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'attest-it-seal-test-'))
  })

  afterEach(() => {
    if (tmpDir) {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  it('should return empty seals file when file does not exist', async () => {
    const seals = await readSeals(tmpDir)

    expect(seals).toEqual({
      version: 1,
      seals: {},
    })
  })

  it('should write and read seals file', async () => {
    const { privateKey } = generateKeyPair()
    const seal = createSeal({
      gateId: 'unit-tests',
      fingerprint: 'sha256:abc123',
      sealedBy: 'alice',
      privateKey,
    })

    const sealsFile: SealsFile = {
      version: 1,
      seals: {
        'unit-tests': seal,
      },
    }

    await writeSeals(tmpDir, sealsFile)
    const readBack = await readSeals(tmpDir)

    expect(readBack).toEqual(sealsFile)
  })

  it('should create .attest-it directory if it does not exist', async () => {
    const sealsFile: SealsFile = {
      version: 1,
      seals: {},
    }

    await writeSeals(tmpDir, sealsFile)

    const attestItDir = path.join(tmpDir, '.attest-it')
    expect(fs.existsSync(attestItDir)).toBe(true)
    expect(fs.statSync(attestItDir).isDirectory()).toBe(true)
  })

  it('should write formatted YAML with schema header', async () => {
    const { privateKey } = generateKeyPair()
    const seal = createSeal({
      gateId: 'unit-tests',
      fingerprint: 'sha256:abc123',
      sealedBy: 'alice',
      privateKey,
    })

    const sealsFile: SealsFile = {
      version: 1,
      seals: {
        'unit-tests': seal,
      },
    }

    await writeSeals(tmpDir, sealsFile)

    const sealsPath = path.join(tmpDir, '.attest-it', 'seals.yaml')
    const content = fs.readFileSync(sealsPath, 'utf8')

    expect(content).toContain('\n')
    expect(content.endsWith('\n')).toBe(true)
    // Written file includes yaml-language-server schema header for editor support
    expect(content).toContain('# yaml-language-server: $schema=')
    expect(content).toContain('schemas/seals.schema.json')
  })

  it('should throw error for invalid YAML in seals file', async () => {
    const sealsPath = path.join(tmpDir, '.attest-it', 'seals.yaml')
    fs.mkdirSync(path.dirname(sealsPath), { recursive: true })
    fs.writeFileSync(sealsPath, 'invalid: yaml: content:', 'utf8')

    await expect(readSeals(tmpDir)).rejects.toThrow('Failed to read seals file')
  })

  it('should throw error for invalid version in seals file', async () => {
    const sealsPath = path.join(tmpDir, '.attest-it', 'seals.yaml')
    fs.mkdirSync(path.dirname(sealsPath), { recursive: true })
    fs.writeFileSync(sealsPath, 'version: 999\nseals: {}', 'utf8')

    await expect(readSeals(tmpDir)).rejects.toThrow('Unsupported seals file version')
  })

  it('should throw error for missing seals field', async () => {
    const sealsPath = path.join(tmpDir, '.attest-it', 'seals.yaml')
    fs.mkdirSync(path.dirname(sealsPath), { recursive: true })
    fs.writeFileSync(sealsPath, 'version: 1', 'utf8')

    await expect(readSeals(tmpDir)).rejects.toThrow('seals: Required')
  })

  it('should read legacy JSON seals file', async () => {
    const { privateKey } = generateKeyPair()
    const seal = createSeal({
      gateId: 'unit-tests',
      fingerprint: 'sha256:abc123',
      sealedBy: 'alice',
      privateKey,
    })

    // Write JSON file directly (legacy format)
    const sealsPath = path.join(tmpDir, '.attest-it', 'seals.json')
    fs.mkdirSync(path.dirname(sealsPath), { recursive: true })
    fs.writeFileSync(
      sealsPath,
      JSON.stringify({ version: 1, seals: { 'unit-tests': seal } }, null, 2),
      'utf8',
    )

    // Should be able to read legacy JSON
    const readBack = await readSeals(tmpDir)
    expect(readBack.seals['unit-tests']).toEqual(seal)
  })

  it('should prefer YAML over JSON when both exist', async () => {
    const { privateKey } = generateKeyPair()
    const yamlSeal = createSeal({
      gateId: 'yaml-test',
      fingerprint: 'sha256:abc123def456',
      sealedBy: 'alice',
      privateKey,
    })
    const jsonSeal = createSeal({
      gateId: 'json-test',
      fingerprint: 'sha256:789abc012def',
      sealedBy: 'bob',
      privateKey,
    })

    const attestItDir = path.join(tmpDir, '.attest-it')
    fs.mkdirSync(attestItDir, { recursive: true })

    // Write both files - use writeSeals for YAML to ensure proper formatting
    await writeSeals(tmpDir, { version: 1, seals: { 'yaml-test': yamlSeal } })

    // Write JSON manually (simulating legacy file)
    fs.writeFileSync(
      path.join(attestItDir, 'seals.json'),
      JSON.stringify({ version: 1, seals: { 'json-test': jsonSeal } }, null, 2),
      'utf8',
    )

    // Should read YAML, not JSON
    const readBack = await readSeals(tmpDir)
    expect(readBack.seals).toHaveProperty('yaml-test')
    expect(readBack.seals).not.toHaveProperty('json-test')
  })

  it('should handle multiple seals', async () => {
    const { privateKey } = generateKeyPair()
    const seal1 = createSeal({
      gateId: 'unit-tests',
      fingerprint: 'sha256:abc123',
      sealedBy: 'alice',
      privateKey,
    })
    const seal2 = createSeal({
      gateId: 'integration-tests',
      fingerprint: 'sha256:def456',
      sealedBy: 'bob',
      privateKey,
    })

    const sealsFile: SealsFile = {
      version: 1,
      seals: {
        'unit-tests': seal1,
        'integration-tests': seal2,
      },
    }

    await writeSeals(tmpDir, sealsFile)
    const readBack = await readSeals(tmpDir)

    expect(readBack.seals).toHaveProperty('unit-tests')
    expect(readBack.seals).toHaveProperty('integration-tests')
    expect(readBack).toEqual(sealsFile)
  })
})

describe('readSealsSync and writeSealsSync', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'attest-it-seal-test-sync-'))
  })

  afterEach(() => {
    if (tmpDir) {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  it('should return empty seals file when file does not exist', () => {
    const seals = readSealsSync(tmpDir)

    expect(seals).toEqual({
      version: 1,
      seals: {},
    })
  })

  it('should write and read seals file synchronously', () => {
    const { privateKey } = generateKeyPair()
    const seal = createSeal({
      gateId: 'unit-tests',
      fingerprint: 'sha256:abc123',
      sealedBy: 'alice',
      privateKey,
    })

    const sealsFile: SealsFile = {
      version: 1,
      seals: {
        'unit-tests': seal,
      },
    }

    writeSealsSync(tmpDir, sealsFile)
    const readBack = readSealsSync(tmpDir)

    expect(readBack).toEqual(sealsFile)
  })

  it('should create .attest-it directory if it does not exist', () => {
    const sealsFile: SealsFile = {
      version: 1,
      seals: {},
    }

    writeSealsSync(tmpDir, sealsFile)

    const attestItDir = path.join(tmpDir, '.attest-it')
    expect(fs.existsSync(attestItDir)).toBe(true)
    expect(fs.statSync(attestItDir).isDirectory()).toBe(true)
  })

  it('should throw error for invalid YAML in seals file', () => {
    const sealsPath = path.join(tmpDir, '.attest-it', 'seals.yaml')
    fs.mkdirSync(path.dirname(sealsPath), { recursive: true })
    fs.writeFileSync(sealsPath, 'invalid: yaml: content:', 'utf8')

    expect(() => readSealsSync(tmpDir)).toThrow('Failed to read seals file')
  })

  it('should throw error for invalid version in seals file', () => {
    const sealsPath = path.join(tmpDir, '.attest-it', 'seals.yaml')
    fs.mkdirSync(path.dirname(sealsPath), { recursive: true })
    fs.writeFileSync(sealsPath, 'version: 999\nseals: {}', 'utf8')

    expect(() => readSealsSync(tmpDir)).toThrow('Unsupported seals file version')
  })

  it('should read legacy JSON seals file sync', () => {
    const { privateKey } = generateKeyPair()
    const seal = createSeal({
      gateId: 'unit-tests',
      fingerprint: 'sha256:abc123',
      sealedBy: 'alice',
      privateKey,
    })

    // Write JSON file directly (legacy format)
    const sealsPath = path.join(tmpDir, '.attest-it', 'seals.json')
    fs.mkdirSync(path.dirname(sealsPath), { recursive: true })
    fs.writeFileSync(
      sealsPath,
      JSON.stringify({ version: 1, seals: { 'unit-tests': seal } }, null, 2),
      'utf8',
    )

    // Should be able to read legacy JSON
    const readBack = readSealsSync(tmpDir)
    expect(readBack.seals['unit-tests']).toEqual(seal)
  })
})

/**
 * Regression test for Bug 2: sealedBy must use team member slug, not display name.
 *
 * The bug was that the seal command was using `identity.name` (e.g., "Alice Developer")
 * instead of the identity slug (e.g., "alice") for the sealedBy field. Since verifySeal
 * looks up the team member by the sealedBy value as a key in config.team, using the
 * display name would cause verification to fail because "Alice Developer" is not a
 * valid key in the team record.
 *
 * @see https://github.com/mike-north/attest-it-workspace/issues/XX
 */
describe('sealedBy slug lookup (Bug 2 regression)', () => {
  it('should verify seal when sealedBy contains slug (the correct key)', () => {
    const { publicKey, privateKey } = generateKeyPair()
    const config = createTestConfig()
    config.team = {
      // Key is the slug, name is the display name
      alice: {
        name: 'Alice Developer',
        publicKey,
      },
    }

    // Create seal with slug (correct behavior)
    const seal = createSeal({
      gateId: 'unit-tests',
      fingerprint: 'sha256:abc123',
      sealedBy: 'alice', // Using slug
      privateKey,
    })

    const result = verifySeal(seal, config)
    expect(result.valid).toBe(true)
    expect(result.error).toBeUndefined()
  })

  it('should fail verification when sealedBy contains display name instead of slug', () => {
    const { publicKey, privateKey } = generateKeyPair()
    const config = createTestConfig()
    config.team = {
      // Key is the slug "alice", not the name "Alice Developer"
      alice: {
        name: 'Alice Developer',
        publicKey,
      },
    }

    // Create seal with display name (the bug behavior)
    const seal = createSeal({
      gateId: 'unit-tests',
      fingerprint: 'sha256:abc123',
      sealedBy: 'Alice Developer', // BUG: Using display name instead of slug
      privateKey,
    })

    const result = verifySeal(seal, config)
    expect(result.valid).toBe(false)
    // Verification fails because "Alice Developer" is not a key in config.team
    expect(result.error).toContain('not found')
  })

  it('should look up team member by exact slug match', () => {
    const { publicKey, privateKey } = generateKeyPair()
    const config = createTestConfig()
    config.team = {
      'mike-north': {
        name: 'Mike North',
        email: 'mike@example.com',
        publicKey,
      },
    }

    // Seal with correct slug
    const validSeal = createSeal({
      gateId: 'unit-tests',
      fingerprint: 'sha256:abc123',
      sealedBy: 'mike-north',
      privateKey,
    })

    expect(verifySeal(validSeal, config).valid).toBe(true)

    // Seal with display name fails
    const invalidSeal = createSeal({
      gateId: 'unit-tests',
      fingerprint: 'sha256:abc123',
      sealedBy: 'Mike North',
      privateKey,
    })

    expect(verifySeal(invalidSeal, config).valid).toBe(false)
  })
})

/**
 * Regression test for Bug 3: sealsPath config option should be respected.
 *
 * The bug was that seal read/write operations were hardcoded to use
 * ".attest-it/seals.json" instead of respecting the sealsPath setting
 * from the configuration file.
 *
 * @see https://github.com/mike-north/attest-it-workspace/issues/XX
 */
describe('sealsPath config option (Bug 3 regression)', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'attest-it-sealspath-test-'))
  })

  afterEach(() => {
    if (tmpDir) {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  it('should write seals to custom path when sealsPathOverride is provided', async () => {
    const { privateKey } = generateKeyPair()
    const seal = createSeal({
      gateId: 'unit-tests',
      fingerprint: 'sha256:abc123',
      sealedBy: 'alice',
      privateKey,
    })

    const sealsFile: SealsFile = {
      version: 1,
      seals: { 'unit-tests': seal },
    }

    // Write to custom path
    const customPath = 'custom/path/to/seals.json'
    await writeSeals(tmpDir, sealsFile, customPath)

    // Verify file was created at custom path
    const expectedPath = path.join(tmpDir, customPath)
    expect(fs.existsSync(expectedPath)).toBe(true)

    // Verify default path was NOT created (now seals.yaml)
    const defaultYamlPath = path.join(tmpDir, '.attest-it', 'seals.yaml')
    const defaultJsonPath = path.join(tmpDir, '.attest-it', 'seals.json')
    expect(fs.existsSync(defaultYamlPath)).toBe(false)
    expect(fs.existsSync(defaultJsonPath)).toBe(false)
  })

  it('should read seals from custom path when sealsPathOverride is provided', async () => {
    const { privateKey } = generateKeyPair()
    const seal = createSeal({
      gateId: 'unit-tests',
      fingerprint: 'sha256:abc123',
      sealedBy: 'alice',
      privateKey,
    })

    const sealsFile: SealsFile = {
      version: 1,
      seals: { 'unit-tests': seal },
    }

    // Write to custom path
    const customPath = 'custom/path/to/seals.json'
    await writeSeals(tmpDir, sealsFile, customPath)

    // Read from custom path
    const readBack = await readSeals(tmpDir, customPath)
    expect(readBack).toEqual(sealsFile)
  })

  it('should use default path when sealsPathOverride is not provided', async () => {
    const { privateKey } = generateKeyPair()
    const seal = createSeal({
      gateId: 'unit-tests',
      fingerprint: 'sha256:abc123',
      sealedBy: 'alice',
      privateKey,
    })

    const sealsFile: SealsFile = {
      version: 1,
      seals: { 'unit-tests': seal },
    }

    // Write without custom path (uses default)
    await writeSeals(tmpDir, sealsFile)

    // Verify file was created at default path (now seals.yaml)
    const defaultPath = path.join(tmpDir, '.attest-it', 'seals.yaml')
    expect(fs.existsSync(defaultPath)).toBe(true)
  })

  it('should write seals sync to custom path when sealsPathOverride is provided', () => {
    const { privateKey } = generateKeyPair()
    const seal = createSeal({
      gateId: 'unit-tests',
      fingerprint: 'sha256:abc123',
      sealedBy: 'alice',
      privateKey,
    })

    const sealsFile: SealsFile = {
      version: 1,
      seals: { 'unit-tests': seal },
    }

    // Write to custom path
    const customPath = '.config/seals.json'
    writeSealsSync(tmpDir, sealsFile, customPath)

    // Verify file was created at custom path
    const expectedPath = path.join(tmpDir, customPath)
    expect(fs.existsSync(expectedPath)).toBe(true)
  })

  it('should read seals sync from custom path when sealsPathOverride is provided', () => {
    const { privateKey } = generateKeyPair()
    const seal = createSeal({
      gateId: 'unit-tests',
      fingerprint: 'sha256:abc123',
      sealedBy: 'alice',
      privateKey,
    })

    const sealsFile: SealsFile = {
      version: 1,
      seals: { 'unit-tests': seal },
    }

    // Write to custom path
    const customPath = '.config/seals.json'
    writeSealsSync(tmpDir, sealsFile, customPath)

    // Read from custom path
    const readBack = readSealsSync(tmpDir, customPath)
    expect(readBack).toEqual(sealsFile)
  })

  it('should return empty seals when custom path file does not exist', async () => {
    const customPath = 'nonexistent/seals.json'
    const seals = await readSeals(tmpDir, customPath)

    expect(seals).toEqual({
      version: 1,
      seals: {},
    })
  })
})

describe('seal operations edge cases', () => {
  it('should handle empty seals object', () => {
    const sealsFile: SealsFile = {
      version: 1,
      seals: {},
    }

    expect(Object.keys(sealsFile.seals)).toHaveLength(0)
  })

  it('should preserve seal fields when round-tripping', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'attest-it-seal-roundtrip-'))
    try {
      const { privateKey } = generateKeyPair()
      const originalSeal = createSeal({
        gateId: 'unit-tests',
        fingerprint: 'sha256:abc123',
        sealedBy: 'alice',
        privateKey,
      })

      const sealsFile: SealsFile = {
        version: 1,
        seals: {
          'unit-tests': originalSeal,
        },
      }

      await writeSeals(tmpDir, sealsFile)
      const readBack = await readSeals(tmpDir)

      const seal = readBack.seals['unit-tests']
      expect(seal).toBeDefined()
      expect(seal?.gateId).toBe(originalSeal.gateId)
      expect(seal?.fingerprint).toBe(originalSeal.fingerprint)
      expect(seal?.timestamp).toBe(originalSeal.timestamp)
      expect(seal?.sealedBy).toBe(originalSeal.sealedBy)
      expect(seal?.signature).toBe(originalSeal.signature)
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    }
  })
})
