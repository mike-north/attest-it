/**
 * Root-gate trust anchoring over `.attest-it/policy.yaml`.
 *
 * The root gate makes the policy file itself a gated, sealed artifact. Its
 * authorized signers are established at `attest-it init` time and can only be
 * changed by a seal from an existing root signer. Verification loads the config,
 * verifies the config's own seal chain against the root gate FIRST, and only then
 * evaluates every other gate against the now-trusted config.
 *
 * Design notes:
 * - The root gate's identity lives in a dedicated top-level `rootGate` section,
 *   never in the user-editable `gates` map, so a PR cannot redefine which gate is
 *   root (see {@link ROOT_GATE_ID}).
 * - The root seal goes through the SAME primitives as any other gate seal
 *   ({@link createSeal} / {@link verifyGateSeal}). This module materializes the
 *   root gate into a reserved, non-persisted gate slot at verify time and defers
 *   entirely to {@link verifyGateSeal}, so there is one trust system to audit.
 * - The artifact the root gate covers is fixed to the policy file; it is never
 *   user-configurable, so a branch cannot repoint the root gate at empty content.
 *
 * @packageDocumentation
 */

import { relative, resolve } from 'node:path'
import { computeFingerprint, computeFingerprintSync } from '../fingerprint.js'
import type { AttestItConfig, GateConfig, RootGateConfig } from '../types.js'
import { createSeal } from '../seal/operations.js'
import { verifyGateSeal, type SealVerificationResult } from '../seal/verification.js'
import type { Seal, SealsFile } from '../seal/types.js'
import { ROOT_GATE_ID } from './migrations/policy-graph.js'

export { ROOT_GATE_ID }

/**
 * Repo-relative path of the policy file the root gate covers.
 *
 * The fingerprint algorithm hashes the file's normalized relative path together
 * with its content, so seal creation and verification must agree on this exact
 * path. It is derived from the resolved policy path relative to the base
 * directory via {@link computePolicyFingerprintSync}.
 * @internal
 */
const DEFAULT_POLICY_REL_PATH = '.attest-it/policy.yaml'

/**
 * Verification state of the root gate.
 *
 * Extends the ordinary gate {@link SealVerificationResult} states with
 * `NOT_ANCHORED`, which reports that the policy defines no `rootGate` at all
 * (a repository that has not yet run the bootstrap ceremony).
 * @public
 */
export type RootGateState = SealVerificationResult['state'] | 'NOT_ANCHORED'

/**
 * Result of verifying the root gate over the policy file.
 * @public
 */
export interface RootGateVerificationResult {
  /** Always {@link ROOT_GATE_ID}. */
  gateId: string
  /** Root-gate verification state. */
  state: RootGateState
  /** The root seal, if one exists. */
  seal?: Seal
  /** Human-readable, non-generic explanation of the state. */
  message: string
}

/**
 * Error thrown when the mandatory root-gate pre-step fails, before any other
 * gate is evaluated. Carries the underlying {@link RootGateVerificationResult}
 * so callers can render a precise, non-generic message.
 * @public
 */
export class RootGateVerificationError extends Error {
  constructor(public readonly result: RootGateVerificationResult) {
    super(result.message)
    this.name = 'RootGateVerificationError'
  }
}

/**
 * Materialize the root gate as an ordinary {@link GateConfig} so that the exact
 * same verification pipeline used for every other gate applies to it.
 *
 * @param rootGate - The root-gate section from the (trusted) config.
 * @param policyRelPath - Repo-relative path of the policy file.
 * @returns A synthetic gate covering the policy file.
 * @internal
 */
export function synthesizeRootGate(rootGate: RootGateConfig, policyRelPath: string): GateConfig {
  return {
    name: 'Root Gate',
    description: rootGate.description ?? 'Trust anchor over .attest-it/policy.yaml',
    authorizedSigners: rootGate.authorizedSigners,
    fingerprint: { paths: [policyRelPath] },
    maxAge: rootGate.maxAge,
  }
}

/**
 * Compute the repo-relative policy path used for root-gate fingerprinting.
 * @internal
 */
function toPolicyRelPath(baseDir: string, policyPath: string): string {
  const rel = relative(resolve(baseDir), resolve(policyPath))
  // Guard against a policy path outside baseDir (shouldn't happen in practice):
  // fall back to the canonical location so the fingerprint stays deterministic.
  if (rel.length === 0 || rel.startsWith('..')) {
    return DEFAULT_POLICY_REL_PATH
  }
  return rel.split('\\').join('/')
}

/**
 * Compute the fingerprint of the policy file that the root gate covers (sync).
 *
 * @param baseDir - Base directory (repository root).
 * @param policyPath - Absolute or relative path to the policy file.
 * @returns The `sha256:...` fingerprint of the policy file.
 * @public
 */
export function computePolicyFingerprintSync(baseDir: string, policyPath: string): string {
  const relPath = toPolicyRelPath(baseDir, policyPath)
  return computeFingerprintSync({ paths: [relPath], baseDir }).fingerprint
}

/**
 * Compute the fingerprint of the policy file that the root gate covers (async).
 *
 * @param baseDir - Base directory (repository root).
 * @param policyPath - Absolute or relative path to the policy file.
 * @returns The `sha256:...` fingerprint of the policy file.
 * @public
 */
export async function computePolicyFingerprint(
  baseDir: string,
  policyPath: string,
): Promise<string> {
  const relPath = toPolicyRelPath(baseDir, policyPath)
  const result = await computeFingerprint({ paths: [relPath], baseDir })
  return result.fingerprint
}

/**
 * Create a seal over the policy file for the root gate.
 *
 * Delegates to {@link createSeal} with the reserved {@link ROOT_GATE_ID}, so the
 * root seal is byte-for-byte the same shape as any other gate seal and is
 * verified by the same code path.
 *
 * @public
 */
export function createRootSeal(params: {
  /** Fingerprint of the policy file (from {@link computePolicyFingerprintSync}). */
  policyFingerprint: string
  /** Team member slug creating the root seal. */
  sealedBy: string
  /** PEM-encoded Ed25519 private key of the root signer. */
  privateKey: string
  /** Passphrase for the private key, if it is encrypted. */
  passphrase?: string
}): Seal {
  return createSeal({
    gateId: ROOT_GATE_ID,
    fingerprint: params.policyFingerprint,
    sealedBy: params.sealedBy,
    privateKey: params.privateKey,
    ...(params.passphrase !== undefined && { passphrase: params.passphrase }),
  })
}

/**
 * Produce a precise, non-generic message for a root-gate verification state.
 *
 * The adversarial acceptance criteria require that a failure NAME the untrusted
 * config change rather than emit a generic "signature failed". These messages
 * always identify the policy file and the trust-critical nature of the change.
 * @internal
 */
function describeRootState(state: RootGateState, base: string | undefined): string {
  switch (state) {
    case 'VALID':
      return 'Root gate is valid: .attest-it/policy.yaml is sealed by an authorized root signer.'
    case 'MISSING':
      return (
        'Untrusted policy: .attest-it/policy.yaml is not sealed by a root signer. ' +
        'The trust-critical policy (team & gate authorization) has no root seal. ' +
        'Have a root signer run `attest-it seal --root` to anchor it.'
      )
    case 'FINGERPRINT_MISMATCH':
      return (
        'Untrusted change to .attest-it/policy.yaml: the trust-critical policy ' +
        '(team &/or gate authorization) was modified, but the modification is not ' +
        'sealed by a root signer. The existing root seal covers a different policy ' +
        'fingerprint. Have a root signer re-run `attest-it seal --root` to authorize ' +
        'this change.'
      )
    case 'UNKNOWN_SIGNER':
      return (
        'Untrusted policy change: the root seal over .attest-it/policy.yaml was ' +
        'created by a signer that is not an authorized root signer. A branch cannot ' +
        'bootstrap a new root of trust for itself — changing the root signers requires ' +
        'a seal from an existing root signer.' +
        (base ? ` (${base})` : '')
      )
    case 'INVALID_SIGNATURE':
      return (
        'Untrusted policy: the root seal over .attest-it/policy.yaml has an invalid ' +
        'signature and does not authorize the current policy.' +
        (base ? ` (${base})` : '')
      )
    case 'STALE':
      return (
        'The root seal over .attest-it/policy.yaml is stale (exceeds the root gate maxAge). ' +
        'Have a root signer re-run `attest-it seal --root`.'
      )
    case 'NOT_ANCHORED':
      return (
        'Policy is not trust-anchored: .attest-it/policy.yaml defines no rootGate. ' +
        'Run the `attest-it init` bootstrap ceremony to establish a root signer.'
      )
    default: {
      // Exhaustiveness guard: every RootGateState is handled above.
      const _exhaustive: never = state
      return `Root gate verification failed${base ? ` (${base})` : ''}: ${String(_exhaustive)}`
    }
  }
}

/**
 * Verify the root gate's seal over the policy file — the mandatory pre-step.
 *
 * This reuses {@link verifyGateSeal} verbatim by injecting a synthesized root
 * gate under the reserved {@link ROOT_GATE_ID} into a shallow copy of the config.
 * The authorized signer set and team come from `config` (which callers source
 * from the *trusted* policy — the base branch for the Action, the local policy
 * for the CLI), so a self-added signer whose key is not in the trusted set is
 * rejected as `UNKNOWN_SIGNER`.
 *
 * @param params.config - Trusted config carrying `rootGate` and `team`.
 * @param params.policyFingerprint - Fingerprint of the policy file being verified.
 * @param params.seals - The seals file (root seal stored under {@link ROOT_GATE_ID}).
 * @returns The root-gate verification result. Never throws.
 * @public
 */
export function verifyRootGate(params: {
  config: AttestItConfig
  policyFingerprint: string
  seals: SealsFile
  /** Optional label describing the trusted policy source (e.g. "base branch"). */
  trustedSourceLabel?: string
}): RootGateVerificationResult {
  const { config, policyFingerprint, seals, trustedSourceLabel } = params

  if (!config.rootGate) {
    return {
      gateId: ROOT_GATE_ID,
      state: 'NOT_ANCHORED',
      message: describeRootState('NOT_ANCHORED', trustedSourceLabel),
    }
  }

  const syntheticGate = synthesizeRootGate(config.rootGate, DEFAULT_POLICY_REL_PATH)
  const configWithRoot: AttestItConfig = {
    ...config,
    gates: { ...config.gates, [ROOT_GATE_ID]: syntheticGate },
  }

  const result = verifyGateSeal(configWithRoot, ROOT_GATE_ID, seals, policyFingerprint)

  return {
    gateId: ROOT_GATE_ID,
    state: result.state,
    ...(result.seal && { seal: result.seal }),
    message: describeRootState(result.state, trustedSourceLabel),
  }
}

/**
 * Whether a root-gate state should block gate evaluation.
 *
 * Any state other than `VALID`, `STALE` (a warning, matching ordinary gate
 * semantics), and `NOT_ANCHORED` (a repository that predates the bootstrap
 * ceremony) is a hard failure: gate evaluation must not proceed against a policy
 * whose own root-gate seal did not verify.
 * @public
 */
export function isBlockingRootGateState(state: RootGateState): boolean {
  return state !== 'VALID' && state !== 'STALE' && state !== 'NOT_ANCHORED'
}
