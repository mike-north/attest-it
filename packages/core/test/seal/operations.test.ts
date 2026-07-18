/**
 * Tests for seal operations.
 *
 * Storage is file-per-seal: one file per (gate, signer) under the seals
 * directory (default `.attest-it/seals/`). These tests assert the aggregate
 * read/write round-trip, one-time migration of the retired monolithic formats,
 * and directory-override handling.
 *
 * @see PRD R5 — "Seals stored one file per (artifact, seal) under a
 *   deterministic path ... so parallel PRs each adding disjoint tools never
 *   conflict."
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

  // A passphrase-encrypted private key (from CLI's `identity create
  // --passphrase-stdin`, issue #80) must be sign-able given the right
  // passphrase, and must fail clearly otherwise.
  describe('with a passphrase-encrypted private key', () => {
    it('should create a verifiable seal when the correct passphrase is supplied', () => {
      const { publicKey, privateKey } = generateKeyPair({ passphrase: 'seal-passphrase' })
      const config = createTestConfig()
      config.team ??= {}
      config.team.alice = { name: 'Alice', publicKey }

      const seal = createSeal({
        gateId: 'unit-tests',
        fingerprint: 'sha256:abc123',
        sealedBy: 'alice',
        privateKey,
        passphrase: 'seal-passphrase',
      })

      expect(verifySeal(seal, config)).toEqual({ valid: true })
    })

    it('should throw when no passphrase is supplied for an encrypted private key', () => {
      const { privateKey } = generateKeyPair({ passphrase: 'seal-passphrase' })

      expect(() =>
        createSeal({
          gateId: 'unit-tests',
          fingerprint: 'sha256:abc123',
          sealedBy: 'alice',
          privateKey,
        }),
      ).toThrow()
    })

    it('should throw when the wrong passphrase is supplied for an encrypted private key', () => {
      const { privateKey } = generateKeyPair({ passphrase: 'seal-passphrase' })

      expect(() =>
        createSeal({
          gateId: 'unit-tests',
          fingerprint: 'sha256:abc123',
          sealedBy: 'alice',
          privateKey,
          passphrase: 'wrong-passphrase',
        }),
      ).toThrow()
    })
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

/**
 * A stable seal factory so round-trip assertions compare concrete values.
 */
function makeSeal(gateId: string, sealedBy: string): SealsFile['seals'][string] {
  const { privateKey } = generateKeyPair()
  return createSeal({ gateId, fingerprint: 'sha256:abc123', sealedBy, privateKey })
}

/** Recursively list absolute paths of `.seal` files under `root`. */
function listSealFiles(root: string): string[] {
  if (!fs.existsSync(root)) return []
  const out: string[] = []
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name)
    if (entry.isDirectory()) {
      out.push(...listSealFiles(full))
    } else if (entry.isFile() && entry.name.endsWith('.seal')) {
      out.push(full)
    }
  }
  return out.sort()
}

describe('readSeals and writeSeals (async, file-per-seal)', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'attest-it-seal-test-'))
  })

  afterEach(() => {
    if (tmpDir) {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  it('returns an empty (v2) aggregate when no seals exist', async () => {
    const seals = await readSeals(tmpDir)
    expect(seals).toEqual({ version: 2, seals: {} })
  })

  it('writes and reads back a seal through the aggregate', async () => {
    const seal = makeSeal('unit-tests', 'alice')
    const sealsFile: SealsFile = { version: 2, seals: { 'unit-tests': seal } }

    await writeSeals(tmpDir, sealsFile)
    const readBack = await readSeals(tmpDir)

    expect(readBack).toEqual(sealsFile)
  })

  it('creates the seals directory on write', async () => {
    await writeSeals(tmpDir, { version: 2, seals: { g: makeSeal('g', 'alice') } })
    const sealsDir = path.join(tmpDir, '.attest-it', 'seals')
    expect(fs.existsSync(sealsDir)).toBe(true)
    expect(fs.statSync(sealsDir).isDirectory()).toBe(true)
  })

  it('stores one file per (gate, signer) — disjoint gates touch disjoint files', async () => {
    const sealsFile: SealsFile = {
      version: 2,
      seals: {
        'unit-tests': makeSeal('unit-tests', 'alice'),
        'integration-tests': makeSeal('integration-tests', 'bob'),
      },
    }
    await writeSeals(tmpDir, sealsFile)

    const root = path.join(tmpDir, '.attest-it', 'seals')
    const files = listSealFiles(root)
    // Exactly two files, in two separate gate directories.
    expect(files).toHaveLength(2)
    const dirs = new Set(files.map((f) => path.dirname(f)))
    expect(dirs.size).toBe(2)

    expect(await readSeals(tmpDir)).toEqual(sealsFile)
  })

  it('writes each per-seal file with the schema header', async () => {
    await writeSeals(tmpDir, {
      version: 2,
      seals: { 'unit-tests': makeSeal('unit-tests', 'alice') },
    })
    const root = path.join(tmpDir, '.attest-it', 'seals')
    const files = listSealFiles(root)
    expect(files).toHaveLength(1)
    const content = fs.readFileSync(files[0] ?? '', 'utf8')
    expect(content).toContain('# yaml-language-server: $schema=')
    expect(content.endsWith('\n')).toBe(true)
  })

  it('handles multiple seals across gates', async () => {
    const sealsFile: SealsFile = {
      version: 2,
      seals: {
        'unit-tests': makeSeal('unit-tests', 'alice'),
        'integration-tests': makeSeal('integration-tests', 'bob'),
      },
    }
    await writeSeals(tmpDir, sealsFile)
    const readBack = await readSeals(tmpDir)
    expect(readBack.seals).toHaveProperty('unit-tests')
    expect(readBack.seals).toHaveProperty('integration-tests')
    expect(readBack).toEqual(sealsFile)
  })

  it('removes a gate file when the aggregate no longer contains it (prune)', async () => {
    await writeSeals(tmpDir, {
      version: 2,
      seals: { a: makeSeal('a', 'alice'), b: makeSeal('b', 'bob') },
    })
    const kept = await readSeals(tmpDir)
    delete kept.seals.b
    await writeSeals(tmpDir, kept)

    const readBack = await readSeals(tmpDir)
    expect(Object.keys(readBack.seals)).toEqual(['a'])
  })
})

describe('readSealsSync and writeSealsSync (file-per-seal)', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'attest-it-seal-test-sync-'))
  })

  afterEach(() => {
    if (tmpDir) {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  it('returns an empty (v2) aggregate when no seals exist', () => {
    expect(readSealsSync(tmpDir)).toEqual({ version: 2, seals: {} })
  })

  it('writes and reads back a seal synchronously', () => {
    const sealsFile: SealsFile = {
      version: 2,
      seals: { 'unit-tests': makeSeal('unit-tests', 'alice') },
    }
    writeSealsSync(tmpDir, sealsFile)
    expect(readSealsSync(tmpDir)).toEqual(sealsFile)
  })

  it('creates the seals directory on write', () => {
    writeSealsSync(tmpDir, { version: 2, seals: {} })
    // An empty aggregate creates no files; a real seal creates the directory.
    writeSealsSync(tmpDir, { version: 2, seals: { g: makeSeal('g', 'alice') } })
    const sealsDir = path.join(tmpDir, '.attest-it', 'seals')
    expect(fs.existsSync(sealsDir)).toBe(true)
  })
})

describe('one-time migration of retired monolithic formats', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'attest-it-seal-migrate-'))
  })

  afterEach(() => {
    if (tmpDir) {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  function writeMonolith(name: 'seals.json' | 'seals.yaml', body: string): string {
    const p = path.join(tmpDir, '.attest-it', name)
    fs.mkdirSync(path.dirname(p), { recursive: true })
    fs.writeFileSync(p, body, 'utf8')
    return p
  }

  it('migrates a legacy monolithic seals.json to file-per-seal and deletes it (PM AC)', async () => {
    const seal = makeSeal('unit-tests', 'alice')
    const monolith = writeMonolith(
      'seals.json',
      JSON.stringify({ version: 1, seals: { 'unit-tests': seal } }, null, 2),
    )

    // One operation (a read) migrates the repo.
    const readBack = await readSeals(tmpDir, '.attest-it/seals.json')

    expect(readBack.version).toBe(2)
    expect(readBack.seals['unit-tests']).toEqual(seal)
    // The monolith is gone and a per-seal file now exists.
    expect(fs.existsSync(monolith)).toBe(false)
    const root = path.join(tmpDir, '.attest-it', 'seals')
    expect(listSealFiles(root)).toHaveLength(1)
  })

  it('migrates a legacy monolithic seals.yaml to file-per-seal and deletes it', () => {
    const seal = makeSeal('unit-tests', 'alice')
    // Simulate the historical YAML monolith (with schema header).
    const monolith = writeMonolith(
      'seals.yaml',
      `# yaml-language-server: $schema=x\nversion: 1\nseals:\n  unit-tests:\n    gateId: ${seal.gateId}\n    fingerprint: ${seal.fingerprint}\n    timestamp: "${seal.timestamp}"\n    sealedBy: ${seal.sealedBy}\n    signature: ${seal.signature}\n`,
    )

    const readBack = readSealsSync(tmpDir, '.attest-it/seals/')

    expect(readBack.version).toBe(2)
    expect(readBack.seals['unit-tests']).toEqual(seal)
    expect(fs.existsSync(monolith)).toBe(false)
  })

  it('preserves equivalent seal semantics after migration (round-trip verify)', async () => {
    const { publicKey, privateKey } = generateKeyPair()
    const config = createTestConfig()
    config.team = { alice: { name: 'Alice', publicKey } }
    const seal = createSeal({
      gateId: 'unit-tests',
      fingerprint: 'sha256:abc123',
      sealedBy: 'alice',
      privateKey,
    })
    writeMonolith('seals.json', JSON.stringify({ version: 1, seals: { 'unit-tests': seal } }))

    const readBack = await readSeals(tmpDir, '.attest-it/seals.json')
    const migratedSeal = readBack.seals['unit-tests']
    expect(migratedSeal).toBeDefined()
    // The migrated seal still verifies identically.
    expect(migratedSeal && verifySeal(migratedSeal, config)).toEqual({ valid: true })
  })

  it('throws on an unsupported monolith version', async () => {
    writeMonolith('seals.json', JSON.stringify({ version: 999, seals: {} }))
    await expect(readSeals(tmpDir, '.attest-it/seals.json')).rejects.toThrow(
      'Unsupported seals file version',
    )
  })

  it('throws on an invalid monolith document', () => {
    writeMonolith('seals.yaml', 'invalid: yaml: content:')
    expect(() => readSealsSync(tmpDir, '.attest-it/seals/')).toThrow('Failed to read seals file')
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
 * The `sealsPath` setting now denotes the seals storage DIRECTORY, but existing,
 * root-gate-sealed policies still carry the legacy monolithic file value
 * (`.attest-it/seals.json`). Both must resolve to the same per-seal directory so
 * the policy file (and its root seal) never needs rewriting.
 */
describe('sealsPath directory override', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'attest-it-sealspath-test-'))
  })

  afterEach(() => {
    if (tmpDir) {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  it('writes and reads under an explicit directory override', async () => {
    const sealsFile: SealsFile = {
      version: 2,
      seals: { 'unit-tests': makeSeal('unit-tests', 'alice') },
    }
    const customDir = 'custom/seal-store/'
    await writeSeals(tmpDir, sealsFile, customDir)

    expect(fs.existsSync(path.join(tmpDir, 'custom', 'seal-store'))).toBe(true)
    // Default location untouched.
    expect(fs.existsSync(path.join(tmpDir, '.attest-it', 'seals'))).toBe(false)

    expect(await readSeals(tmpDir, customDir)).toEqual(sealsFile)
  })

  it('normalizes a legacy `.json` sealsPath to its sibling directory', () => {
    const sealsFile: SealsFile = { version: 2, seals: { g: makeSeal('g', 'alice') } }
    // Writing with the legacy file-shaped setting lands in `.attest-it/seals/`.
    writeSealsSync(tmpDir, sealsFile, '.attest-it/seals.json')
    expect(fs.existsSync(path.join(tmpDir, '.attest-it', 'seals'))).toBe(true)
    // Reading with the directory-shaped setting sees the same seals.
    expect(readSealsSync(tmpDir, '.attest-it/seals/')).toEqual(sealsFile)
  })

  it('returns an empty aggregate when the override directory does not exist', async () => {
    expect(await readSeals(tmpDir, 'nonexistent/seals/')).toEqual({ version: 2, seals: {} })
  })
})

describe('seal operations edge cases', () => {
  it('should handle empty seals object', () => {
    const sealsFile: SealsFile = { version: 2, seals: {} }
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

      await writeSeals(tmpDir, { version: 2, seals: { 'unit-tests': originalSeal } })
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

describe('empty seals aliasing (regression)', () => {
  // Regression: readSeals(Sync) once returned a shared module-level empty
  // constant. Callers mutate the result (`seals.seals[gate] = ...`), so the
  // constant became polluted across independent reads within one process.
  // Each read must return a fresh, independent object.
  it('readSealsSync returns an independent object for an empty store', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'attest-empty-sync-'))
    try {
      const first = readSealsSync(tmpDir)
      first.seals.injected = {
        gateId: 'injected',
        fingerprint: 'sha256:deadbeef',
        timestamp: '2024-01-01T00:00:00.000Z',
        sealedBy: 'nobody',
        signature: 'x',
      }
      const second = readSealsSync(tmpDir)
      expect(Object.keys(second.seals)).toHaveLength(0)
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  it('readSeals returns an independent object for an empty store', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'attest-empty-async-'))
    try {
      const first = await readSeals(tmpDir)
      first.seals.injected = {
        gateId: 'injected',
        fingerprint: 'sha256:deadbeef',
        timestamp: '2024-01-01T00:00:00.000Z',
        sealedBy: 'nobody',
        signature: 'x',
      }
      const second = await readSeals(tmpDir)
      expect(Object.keys(second.seals)).toHaveLength(0)
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    }
  })
})
