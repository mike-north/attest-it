/**
 * Tests for the sealed root gate over `.attest-it/policy.yaml` (issue #72).
 *
 * These cover the PRD R1 acceptance criteria at the core (library) layer, using
 * real Ed25519 keys and the same seal primitives production uses. Expected
 * behaviors are written by hand from the acceptance criteria, not derived from
 * program output.
 *
 * @see PRD R1 — "the config file is itself a gated, sealed artifact"
 * @see Issue #72 acceptance criteria
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { generateKeyPair, sign } from '../src/crypto/ed25519.js'
import { createSeal, verifyGateSeal } from '../src/seal/index.js'
import type { Seal, SealsFile } from '../src/seal/types.js'
import type { AttestItConfig, TeamMember } from '../src/types.js'
import {
  ROOT_GATE_ID,
  createRootSeal,
  createRootSealWithProvider,
  computePolicyFingerprintSync,
  verifyRootGate,
  isBlockingRootGateState,
} from '../src/config/root-gate.js'
import { parsePolicyContent, PolicyValidationError } from '../src/config/policy-schema.js'
import { policyMigrationGraph } from '../src/config/migrations/policy-graph.js'
import { VaultKeyProvider } from '../src/key-provider/vault-key-provider.js'
import { createSigningMockBackend, spkiPemToRawBase64 } from './helpers/mock-backends.js'

interface Signer {
  slug: string
  member: TeamMember
  privateKey: string
}

/** Create a named signer with a fresh Ed25519 keypair. */
function makeSigner(slug: string, name: string): Signer {
  const { publicKey, privateKey } = generateKeyPair()
  return { slug, member: { name, publicKey }, privateKey }
}

/**
 * Build a merged {@link AttestItConfig} with the given root signers, team, and
 * gates. This mirrors what `loadSplitConfig` produces after merge.
 */
function makeConfig(params: {
  rootSigners: string[]
  team: Record<string, TeamMember>
  gates?: AttestItConfig['gates']
}): AttestItConfig {
  return {
    version: 1,
    settings: {
      maxAgeDays: 30,
      publicKeyPath: '.attest-it/pubkey.pem',
      attestationsPath: '.attest-it/attestations.json',
      sealsPath: '.attest-it/seals.json',
    },
    rootGate: {
      authorizedSigners: params.rootSigners,
      maxAge: '365d',
    },
    team: params.team,
    ...(params.gates && { gates: params.gates }),
    suites: {},
  }
}

/** Write a policy.yaml with the given content to `<dir>/.attest-it/policy.yaml`. */
function writePolicy(dir: string, content: string): string {
  const attestDir = path.join(dir, '.attest-it')
  fs.mkdirSync(attestDir, { recursive: true })
  const policyPath = path.join(attestDir, 'policy.yaml')
  fs.writeFileSync(policyPath, content, 'utf8')
  return policyPath
}

function sealsWith(root: Seal, extra: Record<string, Seal> = {}): SealsFile {
  return { version: 1, seals: { [ROOT_GATE_ID]: root, ...extra } }
}

const ORIGINAL_POLICY = `version: 1
rootGate:
  authorizedSigners:
    - owner
team:
  owner:
    name: Repo Owner
    publicKey: AAAA
gates:
  unit:
    name: Unit
    description: Unit tests
    authorizedSigners:
      - owner
    fingerprint:
      paths:
        - src
    maxAge: 30d
`

describe('root gate — happy path (positive AC)', () => {
  let dir: string
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'attest-root-'))
  })
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('verifies VALID when the policy is sealed by an authorized root signer', () => {
    const owner = makeSigner('owner', 'Repo Owner')
    const policyPath = writePolicy(dir, ORIGINAL_POLICY)
    const fingerprint = computePolicyFingerprintSync(dir, policyPath)

    const rootSeal = createRootSeal({
      policyFingerprint: fingerprint,
      sealedBy: 'owner',
      privateKey: owner.privateKey,
    })

    const config = makeConfig({ rootSigners: ['owner'], team: { owner: owner.member } })
    const result = verifyRootGate({
      config,
      policyFingerprint: fingerprint,
      seals: sealsWith(rootSeal),
    })

    // AC positive: a config sealed by a genuine root signer verifies.
    expect(result.state).toBe('VALID')
    expect(isBlockingRootGateState(result.state)).toBe(false)
    expect(result.gateId).toBe(ROOT_GATE_ID)
  })

  it('after a root signer re-seals a changed policy, VALID again and gates evaluate against the NEW config', () => {
    const owner = makeSigner('owner', 'Repo Owner')
    const newDev = makeSigner('dev', 'New Dev')

    // Owner legitimately adds a new team member and authorizes them on a gate,
    // then RE-SEALS the root gate over the new policy content.
    const newPolicy = `${ORIGINAL_POLICY}    dev:
      name: New Dev
      publicKey: BBBB
`
    const policyPath = writePolicy(dir, newPolicy)
    const newFingerprint = computePolicyFingerprintSync(dir, policyPath)

    const rootSeal = createRootSeal({
      policyFingerprint: newFingerprint,
      sealedBy: 'owner',
      privateKey: owner.privateKey,
    })

    // The new (now-trusted) config includes the new team member + a gate they sign.
    const config = makeConfig({
      rootSigners: ['owner'],
      team: { owner: owner.member, dev: newDev.member },
      gates: {
        unit: {
          name: 'Unit',
          description: 'Unit tests',
          authorizedSigners: ['dev'],
          fingerprint: { paths: ['src'] },
          maxAge: '30d',
        },
      },
    })

    const rootResult = verifyRootGate({
      config,
      policyFingerprint: newFingerprint,
      seals: sealsWith(rootSeal),
    })
    expect(rootResult.state).toBe('VALID')

    // Subsequent gate evaluation uses the NEW config: the new dev can now seal
    // the 'unit' gate and it verifies.
    const gateSeal = createSeal({
      gateId: 'unit',
      fingerprint: 'sha256:abc',
      sealedBy: 'dev',
      privateKey: newDev.privateKey,
    })
    const gateResult = verifyGateSeal(
      config,
      'unit',
      { version: 1, seals: { unit: gateSeal } },
      'sha256:abc',
    )
    expect(gateResult.state).toBe('VALID')
  })
})

describe('root gate — adversarial AC 1: untrusted team/gate addition', () => {
  let dir: string
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'attest-root-'))
  })
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('FAILS and names the untrusted policy change when a branch adds a key to team and authorizes it, without a root re-seal', () => {
    const owner = makeSigner('owner', 'Repo Owner')
    const mallory = makeSigner('mallory', 'Mallory')

    // 1. Owner seals the ORIGINAL policy.
    const originalPath = writePolicy(dir, ORIGINAL_POLICY)
    const originalFingerprint = computePolicyFingerprintSync(dir, originalPath)
    const rootSeal = createRootSeal({
      policyFingerprint: originalFingerprint,
      sealedBy: 'owner',
      privateKey: owner.privateKey,
    })

    // 2. Attacker branch adds mallory to team + authorizes her on the gate, and
    // seals the gate ARTIFACT with mallory's key. It does NOT (cannot) re-seal
    // the root gate — mallory does not hold the owner's key.
    const tamperedPolicy = `${ORIGINAL_POLICY}    mallory:
      name: Mallory
      publicKey: ${mallory.member.publicKey}
`
    const tamperedPath = writePolicy(dir, tamperedPolicy)
    const tamperedFingerprint = computePolicyFingerprintSync(dir, tamperedPath)

    // The tampered, working-tree config (as the CLI would load it locally).
    const tamperedConfig = makeConfig({
      rootSigners: ['owner'],
      team: { owner: owner.member, mallory: mallory.member },
      gates: {
        unit: {
          name: 'Unit',
          description: 'Unit tests',
          authorizedSigners: ['owner', 'mallory'],
          fingerprint: { paths: ['src'] },
          maxAge: '30d',
        },
      },
    })
    const gateSeal = createSeal({
      gateId: 'unit',
      fingerprint: 'sha256:abc',
      sealedBy: 'mallory',
      privateKey: mallory.privateKey,
    })

    // 3. verify: the mandatory root pre-step fails because the policy content
    // changed but the root seal covers the original fingerprint.
    const result = verifyRootGate({
      config: tamperedConfig,
      policyFingerprint: tamperedFingerprint,
      seals: sealsWith(rootSeal, { unit: gateSeal }),
    })

    expect(result.state).toBe('FINGERPRINT_MISMATCH')
    expect(isBlockingRootGateState(result.state)).toBe(true)
    // The message NAMES the untrusted config change (not a generic failure).
    expect(result.message).toContain('.attest-it/policy.yaml')
    expect(result.message.toLowerCase()).toContain('not')
    expect(result.message.toLowerCase()).toContain('root signer')
  })
})

describe('root gate — adversarial AC 2: modifying an existing gate authorizedSigners', () => {
  let dir: string
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'attest-root-'))
  })
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('FAILS absent a valid root-signer seal over the config change', () => {
    const owner = makeSigner('owner', 'Repo Owner')

    const originalPath = writePolicy(dir, ORIGINAL_POLICY)
    const originalFingerprint = computePolicyFingerprintSync(dir, originalPath)
    const rootSeal = createRootSeal({
      policyFingerprint: originalFingerprint,
      sealedBy: 'owner',
      privateKey: owner.privateKey,
    })

    // Branch changes an existing gate's authorizedSigners (owner -> attacker),
    // without a root re-seal.
    const tampered = ORIGINAL_POLICY.replace(
      '      - owner\n    fingerprint',
      '      - attacker\n    fingerprint',
    )
    const tamperedPath = writePolicy(dir, tampered)
    const tamperedFingerprint = computePolicyFingerprintSync(dir, tamperedPath)
    expect(tamperedFingerprint).not.toBe(originalFingerprint)

    const config = makeConfig({ rootSigners: ['owner'], team: { owner: owner.member } })
    const result = verifyRootGate({
      config,
      policyFingerprint: tamperedFingerprint,
      seals: sealsWith(rootSeal),
    })

    expect(result.state).toBe('FINGERPRINT_MISMATCH')
    expect(isBlockingRootGateState(result.state)).toBe(true)
    expect(result.message).toContain('.attest-it/policy.yaml')
  })
})

describe('root gate — AC 5: a branch cannot bootstrap a new root of trust for itself', () => {
  let dir: string
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'attest-root-'))
  })
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('rejects a self-added root signer whose key is not in the trusted signer set (UNKNOWN_SIGNER)', () => {
    const owner = makeSigner('owner', 'Repo Owner')
    const mallory = makeSigner('mallory', 'Mallory')

    // Attacker rewrites the policy to add herself as a root signer AND self-seals
    // the new policy with her own key — a fingerprint-matching self-seal.
    const selfBootstrapPolicy = `version: 1
rootGate:
  authorizedSigners:
    - owner
    - mallory
team:
  owner:
    name: Repo Owner
    publicKey: AAAA
  mallory:
    name: Mallory
    publicKey: ${mallory.member.publicKey}
`
    const policyPath = writePolicy(dir, selfBootstrapPolicy)
    const fingerprint = computePolicyFingerprintSync(dir, policyPath)
    const malloryRootSeal = createRootSeal({
      policyFingerprint: fingerprint,
      sealedBy: 'mallory',
      privateKey: mallory.privateKey,
    })

    // Verification uses the TRUSTED (base branch) config: root signers = [owner],
    // team = { owner } only. Mallory is not a member of the trusted team.
    const trustedConfig = makeConfig({ rootSigners: ['owner'], team: { owner: owner.member } })
    const result = verifyRootGate({
      config: trustedConfig,
      policyFingerprint: fingerprint,
      seals: sealsWith(malloryRootSeal),
    })

    expect(result.state).toBe('UNKNOWN_SIGNER')
    expect(isBlockingRootGateState(result.state)).toBe(true)
  })

  it('rejects a self-added root signer who is a regular team member but not a trusted root signer', () => {
    const owner = makeSigner('owner', 'Repo Owner')
    const mallory = makeSigner('mallory', 'Mallory')

    const policyPath = writePolicy(dir, ORIGINAL_POLICY)
    const fingerprint = computePolicyFingerprintSync(dir, policyPath)
    const malloryRootSeal = createRootSeal({
      policyFingerprint: fingerprint,
      sealedBy: 'mallory',
      privateKey: mallory.privateKey,
    })

    // Trusted config: mallory IS in the team (regular member) but the root gate's
    // authorized signers are only [owner]. A non-root signer cannot anchor the policy.
    const trustedConfig = makeConfig({
      rootSigners: ['owner'],
      team: { owner: owner.member, mallory: mallory.member },
    })
    const result = verifyRootGate({
      config: trustedConfig,
      policyFingerprint: fingerprint,
      seals: sealsWith(malloryRootSeal),
    })

    expect(result.state).toBe('UNKNOWN_SIGNER')
    expect(isBlockingRootGateState(result.state)).toBe(true)
  })
})

describe('root gate — MISSING / NOT_ANCHORED states', () => {
  it('reports NOT_ANCHORED (non-blocking) when the policy defines no rootGate', () => {
    const owner = makeSigner('owner', 'Repo Owner')
    const config: AttestItConfig = {
      version: 1,
      settings: {
        maxAgeDays: 30,
        publicKeyPath: '.attest-it/pubkey.pem',
        attestationsPath: '.attest-it/attestations.json',
        sealsPath: '.attest-it/seals.json',
      },
      team: { owner: owner.member },
      suites: {},
    }
    const result = verifyRootGate({
      config,
      policyFingerprint: 'sha256:whatever',
      seals: { version: 1, seals: {} },
    })
    expect(result.state).toBe('NOT_ANCHORED')
    // Backward compatibility: an un-bootstrapped repo does not hard-fail.
    expect(isBlockingRootGateState(result.state)).toBe(false)
  })

  it('reports MISSING (blocking) when a rootGate exists but no root seal is present', () => {
    const owner = makeSigner('owner', 'Repo Owner')
    const config = makeConfig({ rootSigners: ['owner'], team: { owner: owner.member } })
    const result = verifyRootGate({
      config,
      policyFingerprint: 'sha256:whatever',
      seals: { version: 1, seals: {} },
    })
    expect(result.state).toBe('MISSING')
    expect(isBlockingRootGateState(result.state)).toBe(true)
  })
})

// Regression: the root gate delegates entirely to verifyGateSeal, so the same
// FINGERPRINT_MISMATCH + STALE aggregation bug (#156) applies to it — e.g. a
// root seal that is both fingerprint-invalidated and expired.
describe('root gate — conditions aggregation (#156)', () => {
  it('propagates both FINGERPRINT_MISMATCH and STALE conditions when the root seal fails both simultaneously', () => {
    const owner = makeSigner('owner', 'Repo Owner')
    const config = makeConfig({ rootSigners: ['owner'], team: { owner: owner.member } })
    // Root gate's own maxAge is short so a 2-day-old seal is stale.
    config.rootGate = { authorizedSigners: ['owner'], maxAge: '1d' }

    const sealedFingerprint = 'sha256:sealed-policy'
    const currentFingerprint = 'sha256:current-policy' // deliberately different
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString()
    const canonicalString = `${ROOT_GATE_ID}:${sealedFingerprint}:${twoDaysAgo}`
    const rootSeal: Seal = {
      gateId: ROOT_GATE_ID,
      fingerprint: sealedFingerprint,
      timestamp: twoDaysAgo,
      sealedBy: 'owner',
      // createRootSeal always stamps "now"; sign directly to control the
      // timestamp so the seal can be constructed as already-stale.
      signature: sign(canonicalString, owner.privateKey),
    }

    const result = verifyRootGate({
      config,
      policyFingerprint: currentFingerprint,
      seals: sealsWith(rootSeal),
    })

    // Backward-compat: primary state unchanged.
    expect(result.state).toBe('FINGERPRINT_MISMATCH')
    // New: both independently-failing conditions are surfaced, root-gate-flavored.
    expect(result.conditions).toHaveLength(2)
    expect(result.conditions?.[0]?.state).toBe('FINGERPRINT_MISMATCH')
    expect(result.conditions?.[0]?.message).toContain('Untrusted change to .attest-it/policy.yaml')
    expect(result.conditions?.[1]?.state).toBe('STALE')
    expect(result.conditions?.[1]?.message).toContain(
      'root seal over .attest-it/policy.yaml is stale',
    )
  })

  it('omits `conditions` when only the root seal fingerprint mismatches (single condition)', () => {
    const owner = makeSigner('owner', 'Repo Owner')
    const rootSeal = createRootSeal({
      policyFingerprint: 'sha256:sealed-policy',
      sealedBy: 'owner',
      privateKey: owner.privateKey,
    })

    const config = makeConfig({ rootSigners: ['owner'], team: { owner: owner.member } })
    const result = verifyRootGate({
      config,
      policyFingerprint: 'sha256:a-totally-different-fingerprint',
      seals: sealsWith(rootSeal),
    })

    expect(result.state).toBe('FINGERPRINT_MISMATCH')
    expect(result.conditions).toBeUndefined()
  })
})

describe('policy schema — reserved root-gate slug and rootGate parsing', () => {
  it('parses a policy with a rootGate section', () => {
    const policy = parsePolicyContent(ORIGINAL_POLICY, 'yaml')
    expect(policy.rootGate?.authorizedSigners).toEqual(['owner'])
    // maxAge defaults to 365d when unspecified (schema default).
    expect(policy.rootGate?.maxAge).toBe('365d')
  })

  it('rejects a rootGate with an empty authorizedSigners array', () => {
    const bad = `version: 1
rootGate:
  authorizedSigners: []
team: {}
`
    expect(() => parsePolicyContent(bad, 'yaml')).toThrow(PolicyValidationError)
  })

  it('rejects an ordinary gate that reuses the reserved __root__ slug (refined-schema load path)', () => {
    const bad = `version: 1
team:
  owner:
    name: Owner
    publicKey: AAAA
gates:
  __root__:
    name: Fake Root
    description: Attempt to redefine the root gate
    authorizedSigners:
      - owner
    fingerprint:
      paths:
        - src
    maxAge: 30d
`
    expect(() => parsePolicyContent(bad, 'yaml')).toThrow(/reserved gate id/)
  })

  it('rejects the reserved __root__ slug via the migration-graph validation path too (defense-in-depth)', () => {
    // The reserved-slug guard lives on the gates record KEY in the object schema
    // that is registered in the migrex migration graph — not only on the refined
    // load-path schema — so a future validation routed through the graph cannot
    // silently drop the reservation.
    const raw = {
      version: 1,
      team: { owner: { name: 'Owner', publicKey: 'AAAA' } },
      gates: {
        __root__: {
          name: 'Fake Root',
          description: 'Attempt to redefine the root gate',
          authorizedSigners: ['owner'],
          fingerprint: { paths: ['src'] },
          maxAge: '30d',
        },
      },
    }

    const versions = policyMigrationGraph.getVersions()
    const latest = versions[versions.length - 1]
    if (latest === undefined) throw new Error('policy migration graph has no versions')
    const versioned = policyMigrationGraph.getSchema(latest)
    if (!versioned) throw new Error(`no schema registered for version ${latest}`)

    const result = versioned.schema(raw)
    expect(result.success).toBe(false)

    // A well-formed policy with an ordinary gate slug still validates through the graph.
    const ok = versioned.schema({
      version: 1,
      team: { owner: { name: 'Owner', publicKey: 'AAAA' } },
      gates: {
        unit: {
          name: 'Unit',
          description: 'Unit tests',
          authorizedSigners: ['owner'],
          fingerprint: { paths: ['src'] },
          maxAge: '30d',
        },
      },
    })
    expect(ok.success).toBe(true)
  })
})

// Integration between #110's root gate and delegated signing (#76): a root
// signer whose key lives in a VaultKeeper SigningBackend must be able to anchor
// the policy without the raw key ever being materialized, and the resulting root
// seal must verify through the same verifyRootGate path as a PEM-signed one.
describe('root gate — delegated signing (SigningBackend)', () => {
  const POLICY_FINGERPRINT = 'sha256:' + 'a'.repeat(64)

  /** A root signer whose Ed25519 key is held in a delegated signing backend. */
  async function makeDelegatedRootSigner(slug: string, name: string) {
    const signing = createSigningMockBackend()
    const provider = new VaultKeyProvider({ backend: signing.backend, displayName: 'Signing' })
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'attest-it-root-delegated-'))
    try {
      const gen = await provider.generateKeyPair({ publicKeyPath: path.join(tmpDir, 'pub.pem') })
      const { publicKeyPem } = await signing.getPublicKeyFn(gen.privateKeyRef)
      const publicKey = spkiPemToRawBase64(publicKeyPem)
      return {
        slug,
        member: { name, publicKey } satisfies TeamMember,
        provider,
        keyRef: gen.privateKeyRef,
      }
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    }
  }

  it('anchors the root gate with a delegated key and verifies VALID', async () => {
    const owner = await makeDelegatedRootSigner('owner', 'Owner')
    const config = makeConfig({ rootSigners: ['owner'], team: { owner: owner.member } })

    const rootSeal = await createRootSealWithProvider({
      policyFingerprint: POLICY_FINGERPRINT,
      sealedBy: owner.slug,
      keyProvider: owner.provider,
      keyRef: owner.keyRef,
    })

    const result = verifyRootGate({
      config,
      policyFingerprint: POLICY_FINGERPRINT,
      seals: sealsWith(rootSeal),
    })
    expect(result.state).toBe('VALID')
    expect(isBlockingRootGateState(result.state)).toBe(false)
  })

  it('rejects a delegated root seal against a different policy fingerprint', async () => {
    const owner = await makeDelegatedRootSigner('owner', 'Owner')
    const config = makeConfig({ rootSigners: ['owner'], team: { owner: owner.member } })

    const rootSeal = await createRootSealWithProvider({
      policyFingerprint: POLICY_FINGERPRINT,
      sealedBy: owner.slug,
      keyProvider: owner.provider,
      keyRef: owner.keyRef,
    })

    const tampered = 'sha256:' + 'b'.repeat(64)
    const result = verifyRootGate({
      config,
      policyFingerprint: tampered,
      seals: sealsWith(rootSeal),
    })
    expect(result.state).toBe('FINGERPRINT_MISMATCH')
    expect(isBlockingRootGateState(result.state)).toBe(true)
  })
})
