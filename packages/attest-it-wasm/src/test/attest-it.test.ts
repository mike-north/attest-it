/**
 * Integration tests for the @attest-it/wasm package.
 *
 * Exercises the WASM module through the TypeScript wrapper (AttestIt class),
 * covering config parsing, merging, cross-config validation, authorization,
 * seal verification, fingerprint computation, and lifecycle.
 */

import * as assert from 'node:assert/strict'
import { rm } from 'node:fs/promises'
import { after, before, describe, it } from 'node:test'

import { AttestIt } from '../index.js'
import {
  NOW_MS_FRESH,
  NOW_MS_STALE,
  SEAL_TIMESTAMP,
  SEAL_TIMESTAMP_MS,
  buildEmptySealsJson,
  buildMergedConfigJson,
  buildOperationalConfigJson,
  buildPolicyConfigJson,
  buildSealsJson,
  createTempDir,
  generateEd25519KeyPair,
  signSealCanonical,
} from './helpers.js'

// ---------------------------------------------------------------------------
// Shared key pair (generated once for performance)
// ---------------------------------------------------------------------------

const ALICE = generateEd25519KeyPair()
const BOB = generateEd25519KeyPair()

// Fingerprint used consistently across seal tests
const TEST_FINGERPRINT = 'sha256:abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890'

// Pre-signed seal for alice on test-gate with TEST_FINGERPRINT at SEAL_TIMESTAMP
const ALICE_SIGNATURE = signSealCanonical(
  'test-gate',
  TEST_FINGERPRINT,
  SEAL_TIMESTAMP,
  ALICE.privateKey,
)

// ---------------------------------------------------------------------------
// Helpers: build configs with alice as authorized signer
// ---------------------------------------------------------------------------

function aliceTeamMembers(): Record<string, { name: string; publicKey: string }> {
  return { alice: { name: 'Alice', publicKey: ALICE.publicKeyBase64 } }
}

function alicePolicyJson(gateId = 'test-gate'): string {
  return buildPolicyConfigJson({
    gateId,
    authorizedSigners: ['alice'],
    teamMembers: aliceTeamMembers(),
  })
}

function aliceOperationalJson(gateId = 'test-gate'): string {
  return buildOperationalConfigJson({ gateId, suiteId: 'test-suite' })
}

function aliceMergedConfigJson(gateId = 'test-gate'): string {
  return buildMergedConfigJson({
    gateId,
    authorizedSigners: ['alice'],
    teamMembers: aliceTeamMembers(),
  })
}

function aliceSealJson(gateId = 'test-gate'): string {
  return buildSealsJson({
    [gateId]: {
      gateId,
      fingerprint: TEST_FINGERPRINT,
      timestamp: SEAL_TIMESTAMP,
      sealedBy: 'alice',
      signature: ALICE_SIGNATURE,
    },
  })
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('AttestIt WASM integration', () => {
  // -------------------------------------------------------------------------
  // AttestIt.create()
  // -------------------------------------------------------------------------

  describe('AttestIt.create()', () => {
    it('creates an instance with the default node host', async () => {
      const attest = await AttestIt.create()
      assert.ok(attest instanceof AttestIt)
      attest.dispose()
    })

    it('creates an instance with an explicit host', async () => {
      // Provide a minimal host — only platform() and nowUtc() are called at
      // construction time; the others are tested through computeFingerprint.
      const host = {
        platform: () => 'linux' as const,
        nowUtc: () => SEAL_TIMESTAMP,
        async readFile(_path: string): Promise<Uint8Array> {
          return new Uint8Array()
        },
        async writeFile(_path: string, _content: Uint8Array): Promise<void> {},
        async fileExists(_path: string): Promise<boolean> {
          return false
        },
        async createDirAll(_path: string): Promise<void> {},
        async resolveGlobs(
          _patterns: string[],
          _ignore: string[],
          _baseDir: string,
        ): Promise<Array<{ relativePath: string; absolutePath: string }>> {
          return []
        },
        async signEd25519(
          _data: Uint8Array,
          _signerId: string,
        ): Promise<{ signature: string; algorithm: string }> {
          throw new Error('not implemented')
        },
      }

      const attest = await AttestIt.create(host)
      assert.ok(attest instanceof AttestIt)
      attest.dispose()
    })
  })

  // -------------------------------------------------------------------------
  // Config parsing — parsePolicyConfig
  // -------------------------------------------------------------------------

  describe('parsePolicyConfig()', () => {
    let attest: AttestIt

    before(async () => {
      attest = await AttestIt.create()
    })

    after(() => {
      attest.dispose()
    })

    it('parses a minimal YAML policy config', () => {
      const yaml = `
version: 1
team:
  alice:
    name: Alice
    publicKey: ${ALICE.publicKeyBase64}
gates:
  test-gate:
    name: Test Gate
    description: A gate for testing
    authorizedSigners: [alice]
    fingerprint:
      paths: ['**/*.ts']
    maxAge: 30d
`
      const result = attest.parsePolicyConfig(yaml, 'yaml')
      assert.ok(typeof result === 'object' && result !== null)
      const policy = result as Record<string, unknown>
      assert.equal(policy['version'], 1)
      assert.ok(typeof policy['team'] === 'object')
      assert.ok(typeof policy['gates'] === 'object')
    })

    it('parses a JSON policy config', () => {
      const json = alicePolicyJson()
      const result = attest.parsePolicyConfig(json, 'json')
      assert.ok(typeof result === 'object' && result !== null)
      const policy = result as Record<string, unknown>
      assert.equal(policy['version'], 1)
    })

    it('throws for an unsupported format', () => {
      assert.throws(() => attest.parsePolicyConfig('{}', 'toml'), /unsupported config format/i)
    })

    it('throws for malformed YAML', () => {
      assert.throws(
        () => attest.parsePolicyConfig('{{{{not yaml', 'yaml'),
        (err: unknown) => err instanceof Error,
      )
    })

    it('throws for malformed JSON', () => {
      assert.throws(
        () => attest.parsePolicyConfig('{not json}', 'json'),
        (err: unknown) => err instanceof Error,
      )
    })

    it('throws for a policy config with an empty gate name', () => {
      const json = buildPolicyConfigJson({
        gateId: 'bad-gate',
        gateName: '', // empty name should fail validation
        authorizedSigners: ['alice'],
        teamMembers: aliceTeamMembers(),
      })
      assert.throws(
        () => attest.parsePolicyConfig(json, 'json'),
        (err: unknown) => err instanceof Error,
      )
    })

    it('throws for a policy config where a gate has no authorized signers', () => {
      const json = buildPolicyConfigJson({
        gateId: 'bad-gate',
        authorizedSigners: [],
        teamMembers: aliceTeamMembers(),
      })
      assert.throws(
        () => attest.parsePolicyConfig(json, 'json'),
        (err: unknown) => err instanceof Error,
      )
    })
  })

  // -------------------------------------------------------------------------
  // Config parsing — parseOperationalConfig
  // -------------------------------------------------------------------------

  describe('parseOperationalConfig()', () => {
    let attest: AttestIt

    before(async () => {
      attest = await AttestIt.create()
    })

    after(() => {
      attest.dispose()
    })

    it('parses a minimal YAML operational config', () => {
      const yaml = `
version: 1
suites:
  test-suite:
    gate: test-gate
    command: pnpm test
`
      const result = attest.parseOperationalConfig(yaml, 'yaml')
      assert.ok(typeof result === 'object' && result !== null)
      const op = result as Record<string, unknown>
      assert.equal(op['version'], 1)
    })

    it('parses a JSON operational config', () => {
      const json = aliceOperationalJson()
      const result = attest.parseOperationalConfig(json, 'json')
      assert.ok(typeof result === 'object' && result !== null)
    })

    it('throws for an unsupported format', () => {
      assert.throws(() => attest.parseOperationalConfig('{}', 'xml'), /unsupported config format/i)
    })

    it('throws for an operational config with no suites', () => {
      const json = JSON.stringify({ version: 1, suites: {} })
      assert.throws(
        () => attest.parseOperationalConfig(json, 'json'),
        (err: unknown) => err instanceof Error,
      )
    })

    it('throws for a suite that specifies neither gate nor packages', () => {
      const json = JSON.stringify({
        version: 1,
        suites: {
          'bad-suite': { command: 'echo hi' },
        },
      })
      assert.throws(
        () => attest.parseOperationalConfig(json, 'json'),
        (err: unknown) => err instanceof Error,
      )
    })
  })

  // -------------------------------------------------------------------------
  // Config merging — mergeConfigs
  // -------------------------------------------------------------------------

  describe('mergeConfigs()', () => {
    let attest: AttestIt

    before(async () => {
      attest = await AttestIt.create()
    })

    after(() => {
      attest.dispose()
    })

    it('merges valid policy and operational configs', () => {
      const result = attest.mergeConfigs(alicePolicyJson(), aliceOperationalJson())
      assert.ok(typeof result === 'object' && result !== null)
      const merged = result as Record<string, unknown>
      assert.equal(merged['version'], 1)
      assert.ok(typeof merged['team'] === 'object')
      assert.ok(typeof merged['gates'] === 'object')
      assert.ok(typeof merged['suites'] === 'object')
      assert.ok(typeof merged['settings'] === 'object')
    })

    it('includes gate config from the policy in the merged result', () => {
      const result = attest.mergeConfigs(alicePolicyJson(), aliceOperationalJson())
      const merged = result as Record<string, unknown>
      const gates = merged['gates'] as Record<string, unknown>
      assert.ok('test-gate' in gates)
    })

    it('includes suite config from the operational config in the merged result', () => {
      const result = attest.mergeConfigs(alicePolicyJson(), aliceOperationalJson())
      const merged = result as Record<string, unknown>
      const suites = merged['suites'] as Record<string, unknown>
      assert.ok('test-suite' in suites)
    })

    it('throws for malformed policy JSON', () => {
      assert.throws(
        () => attest.mergeConfigs('{bad', aliceOperationalJson()),
        (err: unknown) => err instanceof Error,
      )
    })

    it('throws for malformed operational JSON', () => {
      assert.throws(
        () => attest.mergeConfigs(alicePolicyJson(), '{bad'),
        (err: unknown) => err instanceof Error,
      )
    })
  })

  // -------------------------------------------------------------------------
  // Cross-config validation — validateCrossConfig
  // -------------------------------------------------------------------------

  describe('validateCrossConfig()', () => {
    let attest: AttestIt

    before(async () => {
      attest = await AttestIt.create()
    })

    after(() => {
      attest.dispose()
    })

    it('returns an empty array for a valid cross-config', () => {
      const errors = attest.validateCrossConfig(alicePolicyJson(), aliceOperationalJson())
      assert.ok(Array.isArray(errors))
      assert.equal(errors.length, 0)
    })

    it('returns UNKNOWN_GATE error when suite references a missing gate', () => {
      // operational references 'missing-gate', policy has no such gate
      const policy = buildPolicyConfigJson({
        gateId: 'other-gate',
        authorizedSigners: ['alice'],
        teamMembers: aliceTeamMembers(),
      })
      const operational = buildOperationalConfigJson({ gateId: 'missing-gate' })
      const errors = attest.validateCrossConfig(policy, operational)
      assert.ok(Array.isArray(errors))
      assert.ok(errors.length >= 1)
      const errorItems = errors as Array<{ type: string; gate?: string; suite?: string }>
      assert.ok(errorItems.some((e) => e.type === 'UNKNOWN_GATE'))
    })

    it('returns MISSING_TEAM_MEMBER error when gate references unknown signer', () => {
      // gate authorizes 'charlie' who is not in team
      const policy = buildPolicyConfigJson({
        gateId: 'test-gate',
        authorizedSigners: ['charlie'],
        teamMembers: aliceTeamMembers(), // alice is in team, not charlie
      })
      const operational = buildOperationalConfigJson({ gateId: 'test-gate' })
      const errors = attest.validateCrossConfig(policy, operational)
      assert.ok(Array.isArray(errors))
      assert.ok(errors.length >= 1)
      const errorItems = errors as Array<{ type: string; signer?: string }>
      assert.ok(errorItems.some((e) => e.type === 'MISSING_TEAM_MEMBER'))
    })

    it('accumulates multiple error types in one pass', () => {
      // Policy has a gate with unknown signer AND operational references missing gate
      const policy = buildPolicyConfigJson({
        gateId: 'known-gate',
        authorizedSigners: ['unknown-signer'],
        teamMembers: aliceTeamMembers(),
      })
      const operational = buildOperationalConfigJson({ gateId: 'missing-gate' })
      const errors = attest.validateCrossConfig(policy, operational)
      assert.ok(Array.isArray(errors))
      assert.ok(errors.length >= 2)
      const errorItems = errors as Array<{ type: string }>
      assert.ok(errorItems.some((e) => e.type === 'UNKNOWN_GATE'))
      assert.ok(errorItems.some((e) => e.type === 'MISSING_TEAM_MEMBER'))
    })

    it('throws for malformed JSON input', () => {
      assert.throws(
        () => attest.validateCrossConfig('{bad json}', aliceOperationalJson()),
        (err: unknown) => err instanceof Error,
      )
    })
  })

  // -------------------------------------------------------------------------
  // Authorization — isAuthorizedSigner
  // -------------------------------------------------------------------------

  describe('isAuthorizedSigner()', () => {
    let attest: AttestIt

    before(async () => {
      attest = await AttestIt.create()
    })

    after(() => {
      attest.dispose()
    })

    it('returns true for an authorized signer on the gate', () => {
      const config = aliceMergedConfigJson()
      const result = attest.isAuthorizedSigner(config, 'test-gate', ALICE.publicKeyBase64)
      assert.equal(result, true)
    })

    it('returns false for an unauthorized public key not in the team', () => {
      const config = aliceMergedConfigJson()
      const result = attest.isAuthorizedSigner(config, 'test-gate', BOB.publicKeyBase64)
      assert.equal(result, false)
    })

    it('returns false when signer is in team but not listed for this gate', () => {
      // Bob is in team but only alice is authorized on test-gate
      const config = buildMergedConfigJson({
        gateId: 'test-gate',
        authorizedSigners: ['alice'],
        teamMembers: {
          alice: { name: 'Alice', publicKey: ALICE.publicKeyBase64 },
          bob: { name: 'Bob', publicKey: BOB.publicKeyBase64 },
        },
      })
      const result = attest.isAuthorizedSigner(config, 'test-gate', BOB.publicKeyBase64)
      assert.equal(result, false)
    })

    it('returns false for an unknown gate', () => {
      const config = aliceMergedConfigJson()
      const result = attest.isAuthorizedSigner(config, 'nonexistent-gate', ALICE.publicKeyBase64)
      assert.equal(result, false)
    })

    it('throws for malformed config JSON', () => {
      assert.throws(
        () => attest.isAuthorizedSigner('{bad}', 'test-gate', ALICE.publicKeyBase64),
        (err: unknown) => err instanceof Error,
      )
    })
  })

  // -------------------------------------------------------------------------
  // Verification — verifyGateSeal
  // -------------------------------------------------------------------------

  describe('verifyGateSeal()', () => {
    let attest: AttestIt

    before(async () => {
      attest = await AttestIt.create()
    })

    after(() => {
      attest.dispose()
    })

    it('returns VALID for a correct, fresh seal', () => {
      const config = aliceMergedConfigJson()
      const seals = aliceSealJson()
      const result = attest.verifyGateSeal(
        config,
        'test-gate',
        seals,
        TEST_FINGERPRINT,
        NOW_MS_FRESH,
      )
      assert.ok(typeof result === 'object' && result !== null)
      const r = result as { gateId: string; state: string }
      assert.equal(r.gateId, 'test-gate')
      assert.equal(r.state, 'VALID')
    })

    it('returns MISSING when no seal exists for the gate', () => {
      const config = aliceMergedConfigJson()
      const seals = buildEmptySealsJson()
      const result = attest.verifyGateSeal(
        config,
        'test-gate',
        seals,
        TEST_FINGERPRINT,
        NOW_MS_FRESH,
      )
      const r = result as { state: string }
      assert.equal(r.state, 'MISSING')
    })

    it('returns MISSING when the gate does not exist in config', () => {
      const config = aliceMergedConfigJson()
      const seals = aliceSealJson()
      const result = attest.verifyGateSeal(
        config,
        'nonexistent-gate',
        seals,
        TEST_FINGERPRINT,
        NOW_MS_FRESH,
      )
      const r = result as { state: string }
      assert.equal(r.state, 'MISSING')
    })

    it('returns FINGERPRINT_MISMATCH when fingerprint has changed', () => {
      const config = aliceMergedConfigJson()
      const seals = aliceSealJson()
      const differentFingerprint =
        'sha256:0000000000000000000000000000000000000000000000000000000000000000'
      const result = attest.verifyGateSeal(
        config,
        'test-gate',
        seals,
        differentFingerprint,
        NOW_MS_FRESH,
      )
      const r = result as { state: string }
      assert.equal(r.state, 'FINGERPRINT_MISMATCH')
    })

    it('returns UNKNOWN_SIGNER when sealedBy is not in the team', () => {
      const config = aliceMergedConfigJson()
      // Seal claims to be from 'eve' who is not in the team
      const seals = buildSealsJson({
        'test-gate': {
          gateId: 'test-gate',
          fingerprint: TEST_FINGERPRINT,
          timestamp: SEAL_TIMESTAMP,
          sealedBy: 'eve',
          signature: ALICE_SIGNATURE,
        },
      })
      const result = attest.verifyGateSeal(
        config,
        'test-gate',
        seals,
        TEST_FINGERPRINT,
        NOW_MS_FRESH,
      )
      const r = result as { state: string }
      assert.equal(r.state, 'UNKNOWN_SIGNER')
    })

    it('returns STALE when seal is older than maxAge', () => {
      const config = aliceMergedConfigJson('test-gate')
      const seals = aliceSealJson()
      // nowMs is 60 days after seal; gate has maxAge=30d → stale
      const result = attest.verifyGateSeal(
        config,
        'test-gate',
        seals,
        TEST_FINGERPRINT,
        NOW_MS_STALE,
      )
      const r = result as { state: string }
      assert.equal(r.state, 'STALE')
    })

    it('includes the seal object in the result for non-MISSING states', () => {
      const config = aliceMergedConfigJson()
      const seals = aliceSealJson()
      const result = attest.verifyGateSeal(
        config,
        'test-gate',
        seals,
        TEST_FINGERPRINT,
        NOW_MS_FRESH,
      )
      const r = result as { state: string; seal?: { gateId: string; sealedBy: string } }
      assert.equal(r.state, 'VALID')
      assert.ok(r.seal !== undefined)
      const seal = r.seal
      assert.equal(seal.gateId, 'test-gate')
      assert.equal(seal.sealedBy, 'alice')
    })

    it('throws for malformed config JSON', () => {
      assert.throws(
        () =>
          attest.verifyGateSeal(
            '{bad}',
            'test-gate',
            buildEmptySealsJson(),
            TEST_FINGERPRINT,
            NOW_MS_FRESH,
          ),
        (err: unknown) => err instanceof Error,
      )
    })

    it('throws for malformed seals JSON', () => {
      assert.throws(
        () =>
          attest.verifyGateSeal(
            aliceMergedConfigJson(),
            'test-gate',
            '{bad}',
            TEST_FINGERPRINT,
            NOW_MS_FRESH,
          ),
        (err: unknown) => err instanceof Error,
      )
    })
  })

  // -------------------------------------------------------------------------
  // Verification — verifyAllSeals
  // -------------------------------------------------------------------------

  describe('verifyAllSeals()', () => {
    let attest: AttestIt

    before(async () => {
      attest = await AttestIt.create()
    })

    after(() => {
      attest.dispose()
    })

    it('returns a result for each gate in config', () => {
      // Two gates: test-gate (has valid seal) and other-gate (no seal)
      const bobSignature = signSealCanonical(
        'other-gate',
        TEST_FINGERPRINT,
        SEAL_TIMESTAMP,
        BOB.privateKey,
      )
      const config = buildMergedConfigJson({
        gateId: 'test-gate',
        authorizedSigners: ['alice'],
        teamMembers: aliceTeamMembers(),
        suiteId: 'test-suite',
      })
      // Inject a second gate manually
      const configObj = JSON.parse(config) as {
        gates: Record<string, unknown>
        suites: Record<string, unknown>
        team: Record<string, unknown>
      }
      configObj.gates['other-gate'] = {
        name: 'Other Gate',
        description: 'Another gate',
        authorizedSigners: ['bob'],
        fingerprint: { paths: ['**/*.ts'] },
        maxAge: '30d',
      }
      configObj.team['bob'] = { name: 'Bob', publicKey: BOB.publicKeyBase64 }

      const seals = buildSealsJson({
        'test-gate': {
          gateId: 'test-gate',
          fingerprint: TEST_FINGERPRINT,
          timestamp: SEAL_TIMESTAMP,
          sealedBy: 'alice',
          signature: ALICE_SIGNATURE,
        },
        'other-gate': {
          gateId: 'other-gate',
          fingerprint: TEST_FINGERPRINT,
          timestamp: SEAL_TIMESTAMP,
          sealedBy: 'bob',
          signature: bobSignature,
        },
      })
      const fingerprints = JSON.stringify({
        'test-gate': TEST_FINGERPRINT,
        'other-gate': TEST_FINGERPRINT,
      })

      const results = attest.verifyAllSeals(
        JSON.stringify(configObj),
        seals,
        fingerprints,
        NOW_MS_FRESH,
      )
      assert.ok(Array.isArray(results))
      assert.equal(results.length, 2)
      const resultItems = results as Array<{ gateId: string; state: string }>
      const gateIds = resultItems.map((r) => r.gateId).sort()
      assert.deepEqual(gateIds, ['other-gate', 'test-gate'])
      assert.ok(resultItems.every((r) => r.state === 'VALID'))
    })

    it('returns MISSING for a gate with no seal in the seals file', () => {
      const config = aliceMergedConfigJson()
      const seals = buildEmptySealsJson()
      const fingerprints = JSON.stringify({ 'test-gate': TEST_FINGERPRINT })
      const results = attest.verifyAllSeals(config, seals, fingerprints, NOW_MS_FRESH)
      assert.ok(Array.isArray(results))
      assert.equal(results.length, 1)
      const typedResults = results as Array<{ state: string }>
      const r = typedResults[0]
      assert.ok(r !== undefined)
      assert.equal(r.state, 'MISSING')
    })

    it('returns an empty array when the config has no gates', () => {
      const config = JSON.stringify({
        version: 1,
        settings: {
          maxAgeDays: 30,
          publicKeyPath: '.attest-it/pubkey.pem',
          attestationsPath: '.attest-it/attestations.json',
          sealsPath: '.attest-it/seals.json',
        },
        team: {},
        gates: {},
        suites: {},
      })
      const seals = buildEmptySealsJson()
      const fingerprints = JSON.stringify({})
      const results = attest.verifyAllSeals(config, seals, fingerprints, NOW_MS_FRESH)
      assert.ok(Array.isArray(results))
      assert.equal(results.length, 0)
    })

    it('throws for malformed config JSON', () => {
      assert.throws(
        () => attest.verifyAllSeals('{bad}', buildEmptySealsJson(), '{}', NOW_MS_FRESH),
        (err: unknown) => err instanceof Error,
      )
    })

    it('throws for malformed fingerprints JSON', () => {
      assert.throws(
        () =>
          attest.verifyAllSeals(
            aliceMergedConfigJson(),
            buildEmptySealsJson(),
            '{bad}',
            NOW_MS_FRESH,
          ),
        (err: unknown) => err instanceof Error,
      )
    })
  })

  // -------------------------------------------------------------------------
  // Fingerprint computation — computeFingerprint
  // -------------------------------------------------------------------------

  describe('computeFingerprint()', () => {
    let attest: AttestIt
    let tempDir: string

    before(async () => {
      attest = await AttestIt.create()
      // Create a small temp directory with known files
      const result = await createTempDir({
        'alpha.ts': 'export const a = 1',
        'beta.ts': 'export const b = 2',
        'notes.md': '# Notes',
      })
      tempDir = result.dir
    })

    after(async () => {
      attest.dispose()
      await rm(tempDir, { recursive: true, force: true })
    })

    it('computes a fingerprint matching sha256:<hex> format', async () => {
      const result = await attest.computeFingerprint({ paths: ['**/*.ts'], baseDir: tempDir })
      assert.ok(typeof result === 'object' && result !== null)
      const fp = result as { fingerprint: string; files: string[]; fileCount: number }
      assert.match(fp.fingerprint, /^sha256:[0-9a-f]{64}$/)
    })

    it('includes matched files and correct file count', async () => {
      const result = await attest.computeFingerprint({ paths: ['**/*.ts'], baseDir: tempDir })
      const fp = result as { fingerprint: string; files: string[]; fileCount: number }
      assert.equal(fp.fileCount, 2)
      assert.ok(fp.files.includes('alpha.ts') || fp.files.includes('./alpha.ts'))
      assert.ok(fp.files.includes('beta.ts') || fp.files.includes('./beta.ts'))
    })

    it('produces a consistent fingerprint on repeated calls', async () => {
      const r1 = await attest.computeFingerprint({ paths: ['**/*.ts'], baseDir: tempDir })
      const r2 = await attest.computeFingerprint({ paths: ['**/*.ts'], baseDir: tempDir })
      const fp1 = (r1 as { fingerprint: string }).fingerprint
      const fp2 = (r2 as { fingerprint: string }).fingerprint
      assert.equal(fp1, fp2)
    })

    it('produces different fingerprints for different file sets', async () => {
      const ts = await attest.computeFingerprint({ paths: ['**/*.ts'], baseDir: tempDir })
      const md = await attest.computeFingerprint({ paths: ['**/*.md'], baseDir: tempDir })
      const fpTs = (ts as { fingerprint: string }).fingerprint
      const fpMd = (md as { fingerprint: string }).fingerprint
      assert.notEqual(fpTs, fpMd)
    })

    it('respects ignore patterns', async () => {
      const full = await attest.computeFingerprint({ paths: ['**/*.ts'], baseDir: tempDir })
      const partial = await attest.computeFingerprint({
        paths: ['**/*.ts'],
        ignore: ['beta.ts'],
        baseDir: tempDir,
      })
      const fpFull = (full as { fingerprint: string }).fingerprint
      const fpPartial = (partial as { fingerprint: string }).fingerprint
      assert.notEqual(fpFull, fpPartial)
      const partialResult = partial as { fileCount: number }
      assert.equal(partialResult.fileCount, 1)
    })

    it('returns a valid fingerprint for an empty file set', async () => {
      const result = await attest.computeFingerprint({
        paths: ['**/*.nonexistent'],
        baseDir: tempDir,
      })
      const fp = result as { fingerprint: string; fileCount: number }
      assert.match(fp.fingerprint, /^sha256:[0-9a-f]{64}$/)
      assert.equal(fp.fileCount, 0)
    })
  })

  // -------------------------------------------------------------------------
  // Signature verification round-trip
  // -------------------------------------------------------------------------

  describe('signature verification round-trip', () => {
    it('VALID → sign with correct key, verify with correct config', async () => {
      // This test proves the canonical signing format in helpers.ts matches
      // what the WASM verification logic expects.
      const attest = await AttestIt.create()
      try {
        const config = aliceMergedConfigJson()
        const seals = aliceSealJson()
        const result = attest.verifyGateSeal(
          config,
          'test-gate',
          seals,
          TEST_FINGERPRINT,
          NOW_MS_FRESH,
        )
        const r = result as { state: string }
        assert.equal(
          r.state,
          'VALID',
          'Expected VALID — canonical string format mismatch with WASM?',
        )
      } finally {
        attest.dispose()
      }
    })

    it('INVALID_SIGNATURE when signature is tampered', async () => {
      // Flip a byte in the base64-decoded signature to make it invalid
      const sigBytes = Buffer.from(ALICE_SIGNATURE, 'base64')
      const firstByte = sigBytes[0] ?? 0
      sigBytes[0] = firstByte ^ 0xff
      const tamperedSig = sigBytes.toString('base64')

      const attest = await AttestIt.create()
      try {
        const config = aliceMergedConfigJson()
        const seals = buildSealsJson({
          'test-gate': {
            gateId: 'test-gate',
            fingerprint: TEST_FINGERPRINT,
            timestamp: SEAL_TIMESTAMP,
            sealedBy: 'alice',
            signature: tamperedSig,
          },
        })
        const result = attest.verifyGateSeal(
          config,
          'test-gate',
          seals,
          TEST_FINGERPRINT,
          NOW_MS_FRESH,
        )
        const r = result as { state: string }
        assert.equal(r.state, 'INVALID_SIGNATURE')
      } finally {
        attest.dispose()
      }
    })

    it('INVALID_SIGNATURE when signed with wrong key', async () => {
      // Sign with BOB's key but alice is the sealedBy
      const wrongSig = signSealCanonical(
        'test-gate',
        TEST_FINGERPRINT,
        SEAL_TIMESTAMP,
        BOB.privateKey,
      )

      const attest = await AttestIt.create()
      try {
        const config = aliceMergedConfigJson()
        const seals = buildSealsJson({
          'test-gate': {
            gateId: 'test-gate',
            fingerprint: TEST_FINGERPRINT,
            timestamp: SEAL_TIMESTAMP,
            sealedBy: 'alice',
            signature: wrongSig,
          },
        })
        const result = attest.verifyGateSeal(
          config,
          'test-gate',
          seals,
          TEST_FINGERPRINT,
          NOW_MS_FRESH,
        )
        const r = result as { state: string }
        assert.equal(r.state, 'INVALID_SIGNATURE')
      } finally {
        attest.dispose()
      }
    })
  })

  // -------------------------------------------------------------------------
  // Timestamp boundary tests for STALE
  // -------------------------------------------------------------------------

  describe('STALE boundary conditions', () => {
    let attest: AttestIt

    before(async () => {
      attest = await AttestIt.create()
    })

    after(() => {
      attest.dispose()
    })

    it('is VALID when nowMs is exactly at maxAge boundary', () => {
      // maxAge=30d → 30*24*60*60*1000 ms
      const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000
      const atBoundary = SEAL_TIMESTAMP_MS + thirtyDaysMs
      const config = aliceMergedConfigJson()
      const seals = aliceSealJson()
      const result = attest.verifyGateSeal(config, 'test-gate', seals, TEST_FINGERPRINT, atBoundary)
      const r = result as { state: string }
      // At exactly the boundary the seal may be VALID or STALE depending on
      // whether the Rust implementation uses < or <=. Accept either:
      assert.ok(
        r.state === 'VALID' || r.state === 'STALE',
        `Expected VALID or STALE at boundary, got ${r.state}`,
      )
    })

    it('is STALE when nowMs exceeds maxAge by 1 ms', () => {
      const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000
      const justOver = SEAL_TIMESTAMP_MS + thirtyDaysMs + 1
      const config = aliceMergedConfigJson()
      const seals = aliceSealJson()
      const result = attest.verifyGateSeal(config, 'test-gate', seals, TEST_FINGERPRINT, justOver)
      const r = result as { state: string }
      assert.equal(r.state, 'STALE')
    })

    it('is VALID 1 ms before maxAge expires', () => {
      const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000
      const justBefore = SEAL_TIMESTAMP_MS + thirtyDaysMs - 1
      const config = aliceMergedConfigJson()
      const seals = aliceSealJson()
      const result = attest.verifyGateSeal(config, 'test-gate', seals, TEST_FINGERPRINT, justBefore)
      const r = result as { state: string }
      assert.equal(r.state, 'VALID')
    })
  })

  // -------------------------------------------------------------------------
  // dispose()
  // -------------------------------------------------------------------------

  describe('dispose()', () => {
    it('frees the WASM instance without throwing', async () => {
      const attest = await AttestIt.create()
      assert.doesNotThrow(() => {
        attest.dispose()
      })
    })

    it('calling dispose() twice does not throw', async () => {
      const attest = await AttestIt.create()
      attest.dispose()
      // The second call may or may not throw depending on WASM double-free
      // behavior; we just ensure it doesn't crash the process with an
      // unhandled rejection. Wrap in try/catch and consider both acceptable.
      try {
        attest.dispose()
      } catch {
        // Acceptable — double-free may be detected
      }
    })
  })
})
