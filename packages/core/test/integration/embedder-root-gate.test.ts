/**
 * Root-gate trust anchoring through the REAL embeddable surface (#131).
 *
 * These tests are a small consumer that imports the public `@attest-it/core`
 * surface (`verifyAll`/`verifyOne`, plus the root-gate primitives) exactly as an
 * embedder (e.g. a wrapping CLI for custom / non-GitHub CI) would, and drives it
 * against fixtures on disk. They are the programmatic analog of the CLI/Action
 * root-gate integration tests: an embedder must get the SAME trust-anchored
 * authorization the GitHub Action enforces (#110), not seal-only verification.
 *
 * Each test maps to an issue #131 acceptance criterion:
 *   - (a) adversarial: a working-tree policy that self-adds a root signer and
 *     self-seals is REJECTED (`untrusted-config`) when a trusted base config is
 *     supplied — the programmatic analog of #110's adversarial test.
 *   - fail-closed: a policy with a `rootGate` but NO trusted source supplied is
 *     REJECTED (`untrusted-config`), never a silent pass.
 *   - (b) positive: a policy legitimately re-sealed by a trusted root signer
 *     verifies (`ok: true`) and gates evaluate against the new config.
 *   - (c) backward-compatible: an un-anchored repo (no `rootGate`) still
 *     verifies (NOT_ANCHORED, non-blocking) with no trusted source.
 *
 * All four assertions FAIL against pre-fix code, which skipped the root gate in
 * the embeddable API entirely (evaluateConfigTrust was a no-op stub).
 *
 * @see Issue #131 acceptance criteria
 * @see Issue #110 — trust-anchored authorization ("an agent can't self-authorize")
 */

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { stringify as stringifyYaml } from 'yaml'
import { afterEach, describe, expect, it } from 'vitest'
import {
  verifyAll,
  verifyOne,
  generateEd25519KeyPair,
  createRootSeal,
  createSeal,
  computePolicyFingerprintSync,
  computeFingerprintSync,
  ROOT_GATE_ID,
  type AttestItConfig,
  type Seal,
  type SealsFile,
} from '../../src/index.js'
import { sign } from '../../src/crypto/ed25519.js'

/** Ed25519 key pair as returned by {@link generateEd25519KeyPair}. */
interface KeyPair {
  publicKey: string
  privateKey: string
}

/** A team member entry in policy YAML. */
interface TeamEntry {
  name: string
  publicKey: string
}

/** A scaffolded, on-disk attest-it project the embeddable API is pointed at. */
interface Fixture {
  baseDir: string
}

const GATE_ID = 'tools'
const GATE_PATHS = ['src/**']
const POLICY_REL = join('.attest-it', 'policy.yaml')
const SEALS_REL = join('.attest-it', 'seals.json')

const dirsToClean: string[] = []

afterEach(() => {
  for (const dir of dirsToClean.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

/**
 * Scaffold a project on disk with the given policy, operational config, and
 * seals, and return the base directory the embeddable API is pointed at.
 *
 * `emptySuites` writes `suites: {}` (the gate-only shape `init` scaffolds) to
 * prove that relaxing the suite precondition (issue #137) does not bypass
 * root-gate enforcement for gate-only configs.
 */
function scaffold(
  policy: Record<string, unknown>,
  seals: SealsFile,
  options: { emptySuites?: boolean } = {},
): Fixture {
  const baseDir = mkdtempSync(join(tmpdir(), 'attest-embedder-rootgate-'))
  dirsToClean.push(baseDir)
  mkdirSync(join(baseDir, '.attest-it'), { recursive: true })
  mkdirSync(join(baseDir, 'src', 'lib'), { recursive: true })
  writeFileSync(join(baseDir, 'src', 'lib', 'tool.ts'), 'export const tool = () => 42\n', 'utf8')

  const operational = {
    version: 1,
    suites: options.emptySuites ? {} : { build: { gate: GATE_ID } },
  }
  writeFileSync(join(baseDir, POLICY_REL), stringifyYaml(policy), 'utf8')
  writeFileSync(join(baseDir, '.attest-it', 'config.yaml'), stringifyYaml(operational), 'utf8')
  writeFileSync(join(baseDir, SEALS_REL), JSON.stringify(seals, null, 2), 'utf8')

  return { baseDir }
}

/** Build a policy object with a `rootGate` anchored to the given signers. */
function anchoredPolicy(
  team: Record<string, TeamEntry>,
  rootSigners: string[],
): Record<string, unknown> {
  return {
    version: 1,
    team,
    rootGate: { authorizedSigners: rootSigners, maxAge: '365d' },
    gates: {
      [GATE_ID]: {
        name: 'Tools',
        description: 'Forged tool scripts',
        authorizedSigners: ['alice'],
        fingerprint: { paths: GATE_PATHS },
        maxAge: '365d',
      },
    },
  }
}

/** Build an un-anchored policy (no `rootGate`) with the given gate signers. */
function unanchoredPolicy(
  team: Record<string, TeamEntry>,
  gateSigners: string[] = ['alice'],
): Record<string, unknown> {
  return {
    version: 1,
    team,
    gates: {
      [GATE_ID]: {
        name: 'Tools',
        description: 'Forged tool scripts',
        authorizedSigners: gateSigners,
        fingerprint: { paths: GATE_PATHS },
        maxAge: '365d',
      },
    },
  }
}

/**
 * The trusted, pre-loaded base-branch config an embedder would supply as the
 * root-of-trust anchor: only `alice` is a root signer and team member.
 */
function trustedBaseConfig(alice: KeyPair): AttestItConfig {
  return {
    version: 1,
    settings: {
      maxAgeDays: 365,
      publicKeyPath: '.attest-it/pubkey.pem',
      attestationsPath: '.attest-it/attestations.json',
      sealsPath: SEALS_REL,
    },
    rootGate: { authorizedSigners: ['alice'], maxAge: '365d' },
    team: { alice: { name: 'Alice Developer', publicKey: alice.publicKey } },
    suites: {},
  }
}

/** Seal the policy file at `baseDir` under the root gate with `signer`'s key. */
function rootSealOver(baseDir: string, signerSlug: string, signer: KeyPair) {
  return createRootSeal({
    policyFingerprint: computePolicyFingerprintSync(baseDir, join(baseDir, POLICY_REL)),
    sealedBy: signerSlug,
    privateKey: signer.privateKey,
  })
}

/** Seal the `tools` gate over `src/**` with `signer`'s key. */
function gateSealOver(baseDir: string, signerSlug: string, signer: KeyPair) {
  return createSeal({
    gateId: GATE_ID,
    fingerprint: computeFingerprintSync({ paths: GATE_PATHS, baseDir }).fingerprint,
    sealedBy: signerSlug,
    privateKey: signer.privateKey,
  })
}

/**
 * Seal the policy file at `baseDir` under the root gate with `signer`'s key,
 * but with a caller-controlled timestamp (unlike {@link rootSealOver}, which
 * always stamps "now"). Used to construct an already-stale root seal
 * deterministically.
 */
function rootSealOverWithTimestamp(
  baseDir: string,
  signerSlug: string,
  signer: KeyPair,
  timestamp: string,
): Seal {
  const fingerprint = computePolicyFingerprintSync(baseDir, join(baseDir, POLICY_REL))
  const canonical = `${ROOT_GATE_ID}:${fingerprint}:${timestamp}`
  return {
    gateId: ROOT_GATE_ID,
    fingerprint,
    timestamp,
    sealedBy: signerSlug,
    signature: sign(canonical, signer.privateKey),
  }
}

describe('embeddable API root-gate enforcement (#131)', () => {
  it('(a) REJECTS a working-tree policy that self-adds a root signer and self-seals when a trusted base config is supplied', async () => {
    const alice = generateEd25519KeyPair()
    const mallory = generateEd25519KeyPair()

    // Working tree: mallory has added herself to the team AND to the root
    // signers, then self-sealed the tampered policy with her own key.
    const policy = anchoredPolicy(
      {
        alice: { name: 'Alice Developer', publicKey: alice.publicKey },
        mallory: { name: 'Mallory', publicKey: mallory.publicKey },
      },
      ['alice', 'mallory'],
    )
    const { baseDir } = scaffold(policy, { version: 1, seals: {} })

    // Self-seal the tampered policy under the root gate, and keep a genuine,
    // valid gate seal by alice so that pre-fix code (which skips the root gate)
    // would report the gate VALID — isolating the root-gate check as the only
    // thing that rejects this tampered config.
    const seals: SealsFile = {
      version: 1,
      seals: {
        [ROOT_GATE_ID]: rootSealOver(baseDir, 'mallory', mallory),
        [GATE_ID]: gateSealOver(baseDir, 'alice', alice),
      },
    }
    writeFileSync(join(baseDir, SEALS_REL), JSON.stringify(seals, null, 2), 'utf8')

    const trustedConfig = trustedBaseConfig(alice)

    // verifyAll: top-level untrusted-config failure that names the change.
    const all = await verifyAll({}, { baseDir, trustedConfig })
    expect(all.ok).toBe(false)
    if (all.ok) return
    expect(all.failureClass).toBe('untrusted-config')
    expect(all.message).toContain('.attest-it/policy.yaml')
    expect(all.message.toLowerCase()).toContain('root signer')

    // verifyOne: same rejection, since the pre-step runs before gate evaluation.
    const one = await verifyOne('src/lib/tool.ts', { baseDir, trustedConfig })
    expect(one.ok).toBe(false)
    if (one.ok) return
    expect(one.failureClass).toBe('untrusted-config')
    expect(one.path).toBe('src/lib/tool.ts')
  })

  // Regression for #156: enforceRootGate previously converted a blocking
  // RootGateVerificationResult into an ApiFailure without threading
  // underlyingState/underlyingConditions, so an embedder with a compound
  // root-gate failure (e.g. simultaneously UNKNOWN_SIGNER and STALE) only ever
  // saw the primary message — the aggregated detail was silently dropped.
  it('(a-conditions) surfaces underlyingState AND underlyingConditions when the root gate fails both UNKNOWN_SIGNER and STALE simultaneously', async () => {
    const alice = generateEd25519KeyPair()
    const mallory = generateEd25519KeyPair()

    const policy = anchoredPolicy(
      {
        alice: { name: 'Alice Developer', publicKey: alice.publicKey },
        mallory: { name: 'Mallory', publicKey: mallory.publicKey },
      },
      ['alice', 'mallory'],
    )
    const { baseDir } = scaffold(policy, { version: 1, seals: {} })

    // Root seal sealed by mallory (not a trusted-config root signer) with a
    // 5-day-old timestamp.
    const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString()
    const seals: SealsFile = {
      version: 1,
      seals: {
        [ROOT_GATE_ID]: rootSealOverWithTimestamp(baseDir, 'mallory', mallory, fiveDaysAgo),
        [GATE_ID]: gateSealOver(baseDir, 'alice', alice),
      },
    }
    writeFileSync(join(baseDir, SEALS_REL), JSON.stringify(seals, null, 2), 'utf8')

    // Trusted config: only alice is a root signer, AND its root-gate maxAge is
    // short (1d) so the 5-day-old root seal is ALSO stale — independent of the
    // signer rejection.
    const trustedConfig: AttestItConfig = {
      ...trustedBaseConfig(alice),
      rootGate: { authorizedSigners: ['alice'], maxAge: '1d' },
    }

    const all = await verifyAll({}, { baseDir, trustedConfig })
    expect(all.ok).toBe(false)
    if (all.ok) return
    expect(all.failureClass).toBe('untrusted-config')
    // Backward-compat: primary underlyingState unchanged.
    expect(all.underlyingState).toBe('UNKNOWN_SIGNER')
    // New: both conditions surfaced.
    expect(all.underlyingConditions).toBeDefined()
    const states = all.underlyingConditions?.map((c) => c.state) ?? []
    expect(states).toContain('UNKNOWN_SIGNER')
    expect(states).toContain('STALE')
  })

  it('(a2) REJECTS a working-tree that DELETES rootGate and self-authorizes a gate, when a trusted anchored base config is supplied', async () => {
    // Trust-bypass regression (#131 adversarial review): an attacker cannot
    // escape enforcement by simply removing `rootGate` from their branch's
    // policy. The enforcement decision is gated on the TRUSTED anchor, not on the
    // untrusted working-tree config, so a deleted rootGate → no matching root
    // seal over the tampered policy → MISSING → untrusted-config.
    const alice = generateEd25519KeyPair()
    const mallory = generateEd25519KeyPair()

    // Working tree: NO rootGate at all, and mallory has added herself to the team
    // and authorized herself on the `tools` gate, then self-sealed that gate.
    const policy = unanchoredPolicy(
      {
        alice: { name: 'Alice Developer', publicKey: alice.publicKey },
        mallory: { name: 'Mallory', publicKey: mallory.publicKey },
      },
      ['alice', 'mallory'],
    )
    const { baseDir } = scaffold(policy, { version: 1, seals: {} })

    // A genuine, valid gate seal by mallory (self-authorized). No root seal
    // exists — the attacker removed the root gate entirely. Pre-fix code skipped
    // the root gate whenever the WORKING-TREE policy had none, so it would report
    // this gate VALID (ok:true) — the exact bypass.
    const seals: SealsFile = {
      version: 1,
      seals: { [GATE_ID]: gateSealOver(baseDir, 'mallory', mallory) },
    }
    writeFileSync(join(baseDir, SEALS_REL), JSON.stringify(seals, null, 2), 'utf8')

    // The trusted base is still anchored to alice: its rootGate decides that
    // enforcement MUST run, regardless of the working tree deleting its own.
    const trustedConfig = trustedBaseConfig(alice)

    const all = await verifyAll({}, { baseDir, trustedConfig })
    expect(all.ok).toBe(false)
    if (all.ok) return
    expect(all.failureClass).toBe('untrusted-config')
    expect(all.message).toContain('.attest-it/policy.yaml')

    const one = await verifyOne('src/lib/tool.ts', { baseDir, trustedConfig })
    expect(one.ok).toBe(false)
    if (one.ok) return
    expect(one.failureClass).toBe('untrusted-config')
  })

  it('fails closed: a policy with a rootGate but NO trusted source supplied is rejected (never a silent pass)', async () => {
    const alice = generateEd25519KeyPair()
    const policy = anchoredPolicy(
      { alice: { name: 'Alice Developer', publicKey: alice.publicKey } },
      ['alice'],
    )
    const { baseDir } = scaffold(policy, { version: 1, seals: {} })
    const seals: SealsFile = {
      version: 1,
      seals: {
        [ROOT_GATE_ID]: rootSealOver(baseDir, 'alice', alice),
        [GATE_ID]: gateSealOver(baseDir, 'alice', alice),
      },
    }
    writeFileSync(join(baseDir, SEALS_REL), JSON.stringify(seals, null, 2), 'utf8')

    // No trustedConfig / trustedPolicyPath: enforcement cannot proceed, so the
    // API must fail closed rather than trust the working-tree anchor.
    const result = await verifyAll({}, { baseDir })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.failureClass).toBe('untrusted-config')
    expect(result.message.toLowerCase()).toContain('trusted policy source')
  })

  it('(b) VERIFIES a policy legitimately re-sealed by a trusted root signer, and gates evaluate against the new config', async () => {
    const alice = generateEd25519KeyPair()
    const dev = generateEd25519KeyPair()

    // alice (a trusted root signer) legitimately added `dev` to the team and
    // re-sealed the new policy under the root gate with her own key.
    const policy = anchoredPolicy(
      {
        alice: { name: 'Alice Developer', publicKey: alice.publicKey },
        dev: { name: 'Dev', publicKey: dev.publicKey },
      },
      ['alice'],
    )
    const { baseDir } = scaffold(policy, { version: 1, seals: {} })
    const seals: SealsFile = {
      version: 1,
      seals: {
        [ROOT_GATE_ID]: rootSealOver(baseDir, 'alice', alice),
        [GATE_ID]: gateSealOver(baseDir, 'alice', alice),
      },
    }
    writeFileSync(join(baseDir, SEALS_REL), JSON.stringify(seals, null, 2), 'utf8')

    const trustedConfig = trustedBaseConfig(alice)
    const result = await verifyAll({}, { baseDir, trustedConfig })

    // The root pre-step passed, so gate evaluation proceeded against the new
    // (trusted) working-tree config and the gate is validly sealed.
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.results).toHaveLength(1)
    const gate = result.results[0]
    expect(gate?.ok).toBe(true)
    if (!gate?.ok) return
    expect(gate.gateId).toBe(GATE_ID)
    expect(gate.sealedBy).toBe('alice')
  })

  it('(b) also accepts a trusted source supplied as a filesystem policy path', async () => {
    const alice = generateEd25519KeyPair()
    const policy = anchoredPolicy(
      { alice: { name: 'Alice Developer', publicKey: alice.publicKey } },
      ['alice'],
    )
    const { baseDir } = scaffold(policy, { version: 1, seals: {} })
    const seals: SealsFile = {
      version: 1,
      seals: {
        [ROOT_GATE_ID]: rootSealOver(baseDir, 'alice', alice),
        [GATE_ID]: gateSealOver(baseDir, 'alice', alice),
      },
    }
    writeFileSync(join(baseDir, SEALS_REL), JSON.stringify(seals, null, 2), 'utf8')

    // The trusted policy file is the same on-disk policy (a stand-in for a
    // base-branch checkout whose root signers still list only alice).
    const result = await verifyAll({}, { baseDir, trustedPolicyPath: join(baseDir, POLICY_REL) })
    expect(result.ok).toBe(true)
  })

  it('(c) verifies an un-anchored repo (no rootGate) with no trusted source (backward compatible)', async () => {
    const alice = generateEd25519KeyPair()
    const policy = unanchoredPolicy({
      alice: { name: 'Alice Developer', publicKey: alice.publicKey },
    })
    const { baseDir } = scaffold(policy, { version: 1, seals: {} })
    const seals: SealsFile = {
      version: 1,
      seals: { [GATE_ID]: gateSealOver(baseDir, 'alice', alice) },
    }
    writeFileSync(join(baseDir, SEALS_REL), JSON.stringify(seals, null, 2), 'utf8')

    // No rootGate → no trust anchor to check → verifies unchanged, and never
    // reports untrusted-config.
    const result = await verifyAll({}, { baseDir })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.results[0]?.ok).toBe(true)
  })

  /**
   * Interaction guard between #137 (suites optional) and #131/#139 (root-gate
   * enforcement): a gate-only config (`suites: {}`) can still be root-anchored,
   * and relaxing the suite precondition must NOT let such a config skip the
   * root-gate pre-step. A tampered, self-sealed gate-only policy must still be
   * REJECTED, and a legitimately-anchored gate-only policy must still verify.
   */
  it('(#137) still ENFORCES the root gate for a gate-only (empty-suites) config: tampered anchor is rejected', async () => {
    const alice = generateEd25519KeyPair()
    const mallory = generateEd25519KeyPair()

    // Working tree: mallory self-added to team + root signers, self-sealed —
    // exactly the (a) attack, but on a config with NO suites at all.
    const policy = anchoredPolicy(
      {
        alice: { name: 'Alice Developer', publicKey: alice.publicKey },
        mallory: { name: 'Mallory', publicKey: mallory.publicKey },
      },
      ['alice', 'mallory'],
    )
    const { baseDir } = scaffold(policy, { version: 1, seals: {} }, { emptySuites: true })
    const seals: SealsFile = {
      version: 1,
      seals: {
        [ROOT_GATE_ID]: rootSealOver(baseDir, 'mallory', mallory),
        [GATE_ID]: gateSealOver(baseDir, 'alice', alice),
      },
    }
    writeFileSync(join(baseDir, SEALS_REL), JSON.stringify(seals, null, 2), 'utf8')

    const trustedConfig = trustedBaseConfig(alice)

    const all = await verifyAll({}, { baseDir, trustedConfig })
    expect(all.ok).toBe(false)
    if (all.ok) return
    expect(all.failureClass).toBe('untrusted-config')

    const one = await verifyOne('src/lib/tool.ts', { baseDir, trustedConfig })
    expect(one.ok).toBe(false)
    if (one.ok) return
    expect(one.failureClass).toBe('untrusted-config')
  })

  it('(#137) VERIFIES a legitimately-anchored gate-only (empty-suites) config against the trusted root', async () => {
    const alice = generateEd25519KeyPair()
    const policy = anchoredPolicy(
      { alice: { name: 'Alice Developer', publicKey: alice.publicKey } },
      ['alice'],
    )
    const { baseDir } = scaffold(policy, { version: 1, seals: {} }, { emptySuites: true })
    const seals: SealsFile = {
      version: 1,
      seals: {
        [ROOT_GATE_ID]: rootSealOver(baseDir, 'alice', alice),
        [GATE_ID]: gateSealOver(baseDir, 'alice', alice),
      },
    }
    writeFileSync(join(baseDir, SEALS_REL), JSON.stringify(seals, null, 2), 'utf8')

    const trustedConfig = trustedBaseConfig(alice)
    const result = await verifyAll({}, { baseDir, trustedConfig })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.results[0]?.ok).toBe(true)
  })
})
