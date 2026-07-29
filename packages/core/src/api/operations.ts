/**
 * The embeddable, path-keyed attest-it API operations.
 *
 * These six operations are the stable surface an embedder (e.g. Toolsmith)
 * codes against. They compose the lower-level, gate-keyed core primitives
 * (fingerprinting, config loading, seal creation, seal verification) into a
 * cohesive, taxonomy-tagged contract; they do not reimplement that logic.
 *
 * Every operation is non-interactive: it never prompts, pages, or assumes a
 * TTY. The single permitted human interaction is the key backend's own unlock,
 * reached only from {@link seal}.
 *
 * @packageDocumentation
 */

import { stat } from 'node:fs/promises'
import * as path from 'node:path'
import type { AttestItConfig, GateConfig } from '../types.js'
import {
  loadSplitConfig,
  findPolicyPath,
  computePolicyFingerprint,
  verifyRootGate,
  isBlockingRootGateState,
} from '../config/index.js'
import { computeFingerprint, computeFingerprintsPerFile, listPackageFiles } from '../fingerprint.js'
import { loadLocalConfigSync } from '../identity/index.js'
import {
  createSealWithProvider,
  readSeals,
  writeSeals,
  writeSealFile,
  listStoredSeals,
  resolveSealsRoot,
  verifyGateSeal,
  verifyPatternArtifactSeal,
  type Seal,
  type SealsFile,
  type SealVerificationResult,
} from '../seal/index.js'
import {
  evaluateConfigTrust,
  fail,
  isApiFailure,
  isPatternGate,
  keyProviderForIdentity,
  keyRefForIdentity,
  normalizeRelativePath,
  resolveGatesForPath,
  stateToFailureClass,
} from './internal.js'
import {
  API_SCHEMA_VERSION,
  type ApiFailure,
  type ApiOptions,
  type ArtifactVerification,
  type FingerprintResultOk,
  type GateDescriptor,
  type ListGatesResult,
  type SealParams,
  type SealResult,
  type StatusResult,
  type VerifyAllParams,
  type VerifyAllResult,
  type VerifyOptions,
} from './types.js'

/**
 * Load the split configuration, translating any config-loading error into an
 * {@link ApiFailure} tagged `malformed` (an unparseable or unresolvable config
 * is a malformed on-disk state, distinct from `untrusted-config`, which is
 * reserved for the trust-anchoring check).
 */
async function loadConfigOrFail(baseDir: string): Promise<AttestItConfig | ApiFailure> {
  try {
    return await loadSplitConfig({ baseDir })
  } catch (error) {
    return fail('malformed', error instanceof Error ? error.message : String(error))
  }
}

/**
 * Resolve the caller-supplied **trusted** policy source into an
 * {@link AttestItConfig}, or an {@link ApiFailure} if none was supplied or it
 * could not be loaded.
 *
 * The trusted config supplies the authorized root signers and team the
 * working-tree policy's own root seal is checked against — the in-process analog
 * of the Action's base branch. Precedence: an explicit {@link VerifyOptions.trustedConfig}
 * wins; otherwise a {@link VerifyOptions.trustedPolicyPath} is loaded from disk.
 * When neither is supplied we fail closed with `untrusted-config` rather than
 * trusting the working-tree anchor.
 */
async function resolveTrustedConfig(
  baseDir: string,
  options: VerifyOptions,
): Promise<AttestItConfig | ApiFailure> {
  if (options.trustedConfig) {
    return options.trustedConfig
  }
  if (options.trustedPolicyPath !== undefined) {
    try {
      return await loadSplitConfig({
        baseDir,
        policySource: { type: 'filesystem', path: options.trustedPolicyPath },
      })
    } catch (error) {
      return fail(
        'malformed',
        `Failed to load trusted policy from '${options.trustedPolicyPath}': ` +
          (error instanceof Error ? error.message : String(error)),
      )
    }
  }
  return fail(
    'untrusted-config',
    'Policy defines a rootGate but no trusted policy source was supplied. ' +
      'Pass `trustedConfig` (a pre-loaded base-branch config) or `trustedPolicyPath` ' +
      "(a path to the trusted policy file) so the working-tree policy's root seal can be " +
      'verified against a trusted anchor. Refusing to trust the working-tree anchor.',
  )
}

/**
 * The MANDATORY root-gate pre-step for the embeddable verify operations.
 *
 * Mirrors the CLI `verify` and GitHub Action pre-step: BEFORE any gate is
 * evaluated, verify the working-tree policy's own root seal against a
 * caller-supplied **trusted** policy source. Returns `null` when gate evaluation
 * may proceed, or an {@link ApiFailure} (`untrusted-config`, or `malformed` for
 * an unreadable seal/policy state) that the caller must surface as the verdict.
 *
 * The enforcement decision is gated on the **trusted** anchor, never on the
 * untrusted working-tree config. If we short-circuited on the working tree's own
 * `rootGate`, an attacker could simply **delete** `rootGate` from their branch's
 * `policy.yaml`, self-authorize a gate, and skip enforcement entirely — a trust
 * bypass. So we resolve the trusted source first and let *its* `rootGate` decide
 * whether the pre-step runs, regardless of what the working tree still declares.
 *
 * Fail-closed semantics:
 * - No trusted source supplied **and** the working-tree policy has no `rootGate`
 *   → a genuinely un-anchored repo (predates the bootstrap ceremony); there is
 *   nothing to verify, so evaluation proceeds unchanged (backward compatible),
 *   exactly as the CLI/Action treat an un-anchored repo (`NOT_ANCHORED`,
 *   non-blocking). This is the ONLY skip path when no trusted source is given.
 * - No trusted source supplied **but** the working-tree policy declares a
 *   `rootGate` → we cannot verify that claim against a trusted root →
 *   `untrusted-config` (never a silent pass).
 * - Trusted source supplied and its policy defines a `rootGate` → verify the
 *   working-tree policy's root seal against the trusted anchor REGARDLESS of
 *   whether the working tree still declares a `rootGate`. A working tree that
 *   deleted `rootGate` (or changed the policy) has no matching root seal →
 *   `MISSING`/`FINGERPRINT_MISMATCH`; a self-added signer → `UNKNOWN_SIGNER` —
 *   all `untrusted-config`, carrying the precise root-gate message.
 * - Trusted source supplied but its policy has no `rootGate` → the trusted
 *   anchor itself is not anchored; there is nothing to protect, so evaluation
 *   proceeds (mirrors the Action skipping the pre-step when the base branch has
 *   no `rootGate`).
 * - The working-tree root seal verifies (`VALID`/`STALE`) → proceed; gates then
 *   evaluate against the now-trusted working-tree config.
 */
async function enforceRootGate(
  config: AttestItConfig,
  baseDir: string,
  options: VerifyOptions,
): Promise<ApiFailure | null> {
  const trustedSourceSupplied =
    options.trustedConfig !== undefined || options.trustedPolicyPath !== undefined

  // The ONLY skip path: no trusted source AND a working tree that never claimed
  // to be anchored. Everything else must resolve the trusted anchor first — the
  // untrusted working-tree config never gets to decide whether enforcement runs.
  if (!trustedSourceSupplied && !config.rootGate) {
    return null
  }

  // Resolve the trusted anchor. With no trusted source this returns the
  // fail-closed `untrusted-config` failure (the working tree declares a
  // `rootGate` we cannot verify).
  const trusted = await resolveTrustedConfig(baseDir, options)
  if (isApiFailure(trusted)) {
    return trusted
  }

  // The TRUSTED anchor decides enforcement. If it defines no `rootGate`, it is
  // not itself anchored — nothing to protect — so evaluation proceeds.
  if (!trusted.rootGate) {
    return null
  }

  // The root seal and the policy fingerprint come from the WORKING TREE; the
  // authorized root signers come from the TRUSTED config — so a self-added
  // signer, an unsealed policy change, or a deleted `rootGate` (no matching root
  // seal) is rejected here, before any gate is trusted.
  let seals: SealsFile
  try {
    seals = await readSeals(baseDir, config.settings.sealsPath)
  } catch (error) {
    return fail('malformed', error instanceof Error ? error.message : String(error))
  }

  const policyPath = findPolicyPath(baseDir)
  if (policyPath === null) {
    return fail(
      'malformed',
      'Policy file not found for root-gate verification (expected .attest-it/policy.yaml)',
    )
  }

  let policyFingerprint: string
  try {
    policyFingerprint = await computePolicyFingerprint(baseDir, policyPath)
  } catch (error) {
    return fail('malformed', error instanceof Error ? error.message : String(error))
  }

  const rootResult = verifyRootGate({
    config: trusted,
    policyFingerprint,
    seals,
    trustedSourceLabel: options.trustedPolicyPath
      ? `root signers from ${options.trustedPolicyPath}`
      : 'root signers from the supplied trusted config',
  })

  if (isBlockingRootGateState(rootResult.state)) {
    // A blocking root-gate state is never VALID/STALE/NOT_ANCHORED (see
    // isBlockingRootGateState), so it is always a genuine VerificationState —
    // safe to feed to stateToFailureClass and to underlyingState/-Conditions,
    // mirroring how verdictToArtifactVerification threads the same detail
    // through for ordinary gate failures.
    const underlyingState = rootResult.state
    return fail('untrusted-config', rootResult.message, {
      gateId: rootResult.gateId,
      underlyingState,
      // Only populate when more than one condition failed simultaneously —
      // mirrors the core's own "omit when single" rule.
      ...(rootResult.conditions &&
        rootResult.conditions.length > 1 && {
          underlyingConditions: rootResult.conditions.map((c) => ({
            state: c.state,
            failureClass: stateToFailureClass(c.state),
            message: c.message,
          })),
        }),
    })
  }

  // VALID, STALE (a warning, not a failure), or NOT_ANCHORED (the trusted source
  // itself is not anchored — nothing to protect): gate evaluation may proceed.
  return null
}

/**
 * Resolve a path to exactly one governing gate, or an {@link ApiFailure}.
 *
 * Zero governing gates and multiple governing gates are both `malformed`: the
 * request cannot be unambiguously satisfied against the current policy. Both
 * fail closed at the caller.
 */
async function resolveSingleGateOrFail(
  config: AttestItConfig,
  artifactPath: string,
  baseDir: string,
): Promise<string | ApiFailure> {
  const gates = await resolveGatesForPath(config, artifactPath, baseDir)
  const [only, ...rest] = gates
  if (only === undefined) {
    return fail('malformed', `No gate governs path: ${artifactPath}`, { path: artifactPath })
  }
  if (rest.length > 0) {
    return fail(
      'malformed',
      `Path is governed by multiple gates (${gates.join(', ')}); operate on a specific gate`,
      { path: artifactPath },
    )
  }
  return only
}

/**
 * Verify a single gate and shape the result as an {@link ArtifactVerification}.
 *
 * Reads seals, computes the gate's current fingerprint, runs the core seal
 * verification, and maps its state to the taxonomy. `artifactPath`, when
 * provided, is echoed onto the result for path-keyed callers.
 */
async function verifyGate(
  config: AttestItConfig,
  gateId: string,
  baseDir: string,
  artifactPath?: string,
): Promise<ArtifactVerification> {
  // eslint-disable-next-line security/detect-object-injection
  const gate = config.gates?.[gateId]
  if (!gate) {
    return fail('malformed', `Gate '${gateId}' not found in configuration`, {
      gateId,
      ...(artifactPath !== undefined && { path: artifactPath }),
    })
  }

  let fingerprint: string
  try {
    const result = await computeFingerprint({
      paths: gate.fingerprint.paths,
      ...(gate.fingerprint.exclude && { exclude: gate.fingerprint.exclude }),
      baseDir,
    })
    fingerprint = result.fingerprint
  } catch (error) {
    return fail('malformed', error instanceof Error ? error.message : String(error), {
      gateId,
      ...(artifactPath !== undefined && { path: artifactPath }),
    })
  }

  let seals: SealsFile
  try {
    seals = await readSeals(baseDir, config.settings.sealsPath)
  } catch (error) {
    return fail('malformed', error instanceof Error ? error.message : String(error), {
      gateId,
      ...(artifactPath !== undefined && { path: artifactPath }),
    })
  }
  const verdict = verifyGateSeal(config, gateId, seals, fingerprint)
  return verdictToArtifactVerification(verdict, gateId, fingerprint, artifactPath)
}

/**
 * Shape a core {@link SealVerificationResult} into a path-keyed
 * {@link ArtifactVerification}, echoing `artifactPath` (as `path`) when present.
 */
function verdictToArtifactVerification(
  verdict: SealVerificationResult,
  gateId: string,
  fingerprint: string,
  artifactPath?: string,
): ArtifactVerification {
  const pathValue = artifactPath ?? verdict.artifactPath
  if (verdict.state === 'VALID') {
    return {
      schemaVersion: API_SCHEMA_VERSION,
      ok: true,
      gateId,
      fingerprint,
      sealedBy: verdict.seal?.sealedBy ?? '',
      sealedAt: verdict.seal?.timestamp ?? '',
      ...(pathValue !== undefined && { path: pathValue }),
    }
  }
  return fail(stateToFailureClass(verdict.state), verdict.message ?? verdict.state, {
    gateId,
    underlyingState: verdict.state,
    ...(pathValue !== undefined && { path: pathValue }),
    // Only populate when more than one condition failed simultaneously — mirrors
    // the core's own "omit when single" rule for SealVerificationResult.conditions.
    ...(verdict.conditions &&
      verdict.conditions.length > 1 && {
        underlyingConditions: verdict.conditions.map((c) => ({
          state: c.state,
          failureClass: stateToFailureClass(c.state),
          message: c.message,
        })),
      }),
  })
}

/**
 * The latest per-file seal for each matched file of a pattern gate, keyed by
 * artifact path. When several signers sealed the same file, the most recent wins
 * (ties broken by signer slug) — the same deterministic collapse the aggregate
 * storage uses for multiple signers.
 */
async function readPatternSealsByArtifact(
  config: AttestItConfig,
  gateId: string,
  baseDir: string,
): Promise<Map<string, Seal>> {
  const root = resolveSealsRoot(baseDir, config.settings.sealsPath)
  const byArtifact = new Map<string, Seal>()
  for (const { seal } of await listStoredSeals(root)) {
    if (seal.gateId !== gateId || seal.artifactPath === undefined) continue
    const current = byArtifact.get(seal.artifactPath)
    if (
      !current ||
      seal.timestamp > current.timestamp ||
      (seal.timestamp === current.timestamp && seal.sealedBy > current.sealedBy)
    ) {
      byArtifact.set(seal.artifactPath, seal)
    }
  }
  return byArtifact
}

/**
 * Verify a pattern gate: one independent {@link ArtifactVerification} per matched
 * file, sorted lexicographically by path (deterministic for `status --json`).
 *
 * When `filterPath` is given, only that file's result is returned (path-keyed
 * verification of a single file within a pattern gate).
 */
async function verifyPatternGate(
  config: AttestItConfig,
  gateId: string,
  gate: GateConfig,
  baseDir: string,
  filterPath?: string,
): Promise<ArtifactVerification[]> {
  let perFile
  try {
    perFile = await computeFingerprintsPerFile({
      paths: gate.fingerprint.paths,
      ...(gate.fingerprint.exclude && { exclude: gate.fingerprint.exclude }),
      baseDir,
    })
  } catch (error) {
    return [
      fail('malformed', error instanceof Error ? error.message : String(error), {
        gateId,
        ...(filterPath !== undefined && { path: filterPath }),
      }),
    ]
  }

  let sealsByArtifact: Map<string, Seal>
  try {
    sealsByArtifact = await readPatternSealsByArtifact(config, gateId, baseDir)
  } catch (error) {
    return [
      fail('malformed', error instanceof Error ? error.message : String(error), {
        gateId,
        ...(filterPath !== undefined && { path: filterPath }),
      }),
    ]
  }

  const results: ArtifactVerification[] = []
  for (const { path: filePath, fingerprint } of perFile) {
    if (filterPath !== undefined && filePath !== filterPath) continue
    const verdict = verifyPatternArtifactSeal(
      config,
      gateId,
      filePath,
      sealsByArtifact.get(filePath),
      fingerprint,
      gate.maxAge,
    )
    results.push(verdictToArtifactVerification(verdict, gateId, fingerprint, filePath))
  }
  return results
}

/**
 * Enumerate the gates defined in the current configuration.
 *
 * NOTE (coupling): this enumerates the statically-configured gates. Pattern
 * gates (computed gate sets) will extend enumeration; callers must not assume
 * the returned list is the complete, final set of enforceable gates forever.
 *
 * @param options - {@link ApiOptions}
 * @returns The gate descriptors, or an {@link ApiFailure} if config load fails.
 * @public
 */
export async function listGates(options: ApiOptions = {}): Promise<ListGatesResult | ApiFailure> {
  const baseDir = options.baseDir ?? process.cwd()
  const config = await loadConfigOrFail(baseDir)
  if (isApiFailure(config)) {
    return config
  }
  const loaded = config

  const gates: GateDescriptor[] = Object.entries(loaded.gates ?? {}).map(([gateId, gate]) => ({
    gateId,
    name: gate.name,
    description: gate.description,
    ...(gate.kind !== undefined && { kind: gate.kind }),
    authorizedSigners: [...gate.authorizedSigners],
    paths: [...gate.fingerprint.paths],
    exclude: [...(gate.fingerprint.exclude ?? [])],
    ...(gate.maxAge !== undefined && { maxAge: gate.maxAge }),
  }))

  return { schemaVersion: API_SCHEMA_VERSION, ok: true, gates }
}

/**
 * Report the verification status of every gate, or of the gates governing the
 * given artifact paths.
 *
 * @param paths - Artifact paths to report on. When omitted or empty, every
 *   configured gate is reported (gate-keyed). When provided, each path is
 *   resolved to its governing gate (path-keyed).
 * @param options - {@link ApiOptions}
 * @returns Per-target {@link ArtifactVerification} outcomes, or a top-level
 *   {@link ApiFailure} if config load or trust evaluation fails.
 * @public
 */
export async function status(
  paths?: string[],
  options: ApiOptions = {},
): Promise<StatusResult | ApiFailure> {
  const baseDir = options.baseDir ?? process.cwd()
  const config = await loadConfigOrFail(baseDir)
  if (isApiFailure(config)) {
    return config
  }
  const loaded = config

  const trust = evaluateConfigTrust(loaded, baseDir)
  if (!trust.trusted) {
    return fail('untrusted-config', trust.reason ?? 'Configuration is not trust-anchored')
  }

  const results: ArtifactVerification[] = []

  if (paths && paths.length > 0) {
    for (const artifactPath of paths) {
      const gateId = await resolveSingleGateOrFail(loaded, artifactPath, baseDir)
      if (typeof gateId !== 'string') {
        results.push(gateId)
        continue
      }
      results.push(await verifyPathInGate(loaded, gateId, baseDir, artifactPath))
    }
  } else {
    for (const gateId of Object.keys(loaded.gates ?? {})) {
      // eslint-disable-next-line security/detect-object-injection
      const gate = loaded.gates?.[gateId]
      if (gate && isPatternGate(gate)) {
        results.push(...(await verifyPatternGate(loaded, gateId, gate, baseDir)))
      } else {
        results.push(await verifyGate(loaded, gateId, baseDir))
      }
    }
  }

  return { schemaVersion: API_SCHEMA_VERSION, ok: true, results }
}

/**
 * Verify one artifact path against its governing gate, dispatching to the
 * pattern-gate per-file path when the gate is a pattern gate (so only that file's
 * seal is evaluated), or the whole-gate path otherwise.
 */
async function verifyPathInGate(
  config: AttestItConfig,
  gateId: string,
  baseDir: string,
  artifactPath: string,
): Promise<ArtifactVerification> {
  // eslint-disable-next-line security/detect-object-injection
  const gate = config.gates?.[gateId]
  if (gate && isPatternGate(gate)) {
    const target = normalizeRelativePath(artifactPath, baseDir)
    const [only] = await verifyPatternGate(config, gateId, gate, baseDir, target)
    return (
      only ??
      fail('malformed', `Path '${artifactPath}' is not matched by pattern gate '${gateId}'`, {
        gateId,
        path: artifactPath,
      })
    )
  }
  return verifyGate(config, gateId, baseDir, artifactPath)
}

/**
 * Compute the current fingerprint of the gate that governs the given path.
 *
 * Fingerprints are gate-scoped (they cover all of a gate's files), so this
 * returns the fingerprint that would be sealed for the path — the one the
 * seal/verify cycle binds — not a hash of the single file in isolation.
 *
 * @param artifactPath - The artifact path.
 * @param options - {@link ApiOptions}
 * @returns The fingerprint, or an {@link ApiFailure}.
 * @public
 */
export async function fingerprint(
  artifactPath: string,
  options: ApiOptions = {},
): Promise<FingerprintResultOk | ApiFailure> {
  const baseDir = options.baseDir ?? process.cwd()
  const config = await loadConfigOrFail(baseDir)
  if (isApiFailure(config)) {
    return config
  }
  const loaded = config

  const gate = await resolveSingleGateOrFail(loaded, artifactPath, baseDir)
  if (typeof gate !== 'string') {
    return gate
  }
  // eslint-disable-next-line security/detect-object-injection
  const gateConfig = loaded.gates?.[gate]
  if (!gateConfig) {
    return fail('malformed', `Gate '${gate}' not found in configuration`, {
      gateId: gate,
      path: artifactPath,
    })
  }

  try {
    if (isPatternGate(gateConfig)) {
      // A pattern gate fingerprints each file individually; return the requested
      // file's own fingerprint (the one its per-file seal binds), not a combined
      // hash over the whole gate.
      const target = normalizeRelativePath(artifactPath, baseDir)
      const perFile = await computeFingerprintsPerFile({
        paths: gateConfig.fingerprint.paths,
        ...(gateConfig.fingerprint.exclude && { exclude: gateConfig.fingerprint.exclude }),
        baseDir,
      })
      const match = perFile.find((f) => f.path === target)
      if (!match) {
        return fail(
          'malformed',
          `Path '${artifactPath}' is not matched by pattern gate '${gate}'`,
          {
            gateId: gate,
            path: artifactPath,
          },
        )
      }
      return {
        schemaVersion: API_SCHEMA_VERSION,
        ok: true,
        gateId: gate,
        path: artifactPath,
        fingerprint: match.fingerprint,
        fileCount: 1,
      }
    }

    const result = await computeFingerprint({
      paths: gateConfig.fingerprint.paths,
      ...(gateConfig.fingerprint.exclude && { exclude: gateConfig.fingerprint.exclude }),
      baseDir,
    })
    return {
      schemaVersion: API_SCHEMA_VERSION,
      ok: true,
      gateId: gate,
      path: artifactPath,
      fingerprint: result.fingerprint,
      fileCount: result.fileCount,
    }
  } catch (error) {
    return fail('malformed', error instanceof Error ? error.message : String(error), {
      gateId: gate,
      path: artifactPath,
    })
  }
}

/**
 * Create a seal for the gate that governs the given path, signing as the named
 * identity.
 *
 * This is non-interactive apart from the identity's key backend, which performs
 * its own unlock (the single permitted human interaction). An unauthorized
 * identity is reported as `unauthorized-signer` **without** writing a seal.
 *
 * Environmental failures — the key backend failing or being cancelled, or a
 * filesystem write error — are thrown, not returned: they are not attestation
 * states in the taxonomy.
 *
 * @param artifactPath - The artifact path to seal.
 * @param params - {@link SealParams}; `identity` names a local identity.
 * @param options - {@link ApiOptions}
 * @returns A {@link SealResult}, or an {@link ApiFailure}.
 * @public
 */
export async function seal(
  artifactPath: string,
  params: SealParams,
  options: ApiOptions = {},
): Promise<SealResult | ApiFailure> {
  const baseDir = options.baseDir ?? process.cwd()
  const config = await loadConfigOrFail(baseDir)
  if (isApiFailure(config)) {
    return config
  }
  const loaded = config

  const gate = await resolveSingleGateOrFail(loaded, artifactPath, baseDir)
  if (typeof gate !== 'string') {
    return gate
  }
  // eslint-disable-next-line security/detect-object-injection
  const gateConfig = loaded.gates?.[gate]
  if (!gateConfig) {
    return fail('malformed', `Gate '${gate}' not found in configuration`, {
      gateId: gate,
      path: artifactPath,
    })
  }

  // Resolve the identity from the caller's local identity config.
  const localConfig = loadLocalConfigSync()
  if (!localConfig) {
    return fail('malformed', 'No local identity configuration found', {
      gateId: gate,
      path: artifactPath,
    })
  }
  const identity = localConfig.identities[params.identity]
  if (!identity) {
    return fail('malformed', `Identity '${params.identity}' not found in local config`, {
      gateId: gate,
      path: artifactPath,
    })
  }

  // Authorization must be checked before any seal is created.
  if (!gateConfig.authorizedSigners.includes(params.identity)) {
    return fail(
      'unauthorized-signer',
      `Identity '${params.identity}' is not an authorized signer for gate '${gate}' ` +
        `(authorized: ${gateConfig.authorizedSigners.join(', ') || 'none'})`,
      { gateId: gate, path: artifactPath },
    )
  }

  const keyProvider = keyProviderForIdentity(identity)
  const keyRef = keyRefForIdentity(identity)

  // Pattern gate: seal ONLY the requested file, using its individual fingerprint,
  // and persist via the low-level per-file writer. It must NOT go through the
  // aggregate writeSeals path, which is one-file-per-gate and would prune every
  // sibling file's seal.
  if (isPatternGate(gateConfig)) {
    const target = normalizeRelativePath(artifactPath, baseDir)
    let perFile
    try {
      perFile = await computeFingerprintsPerFile({
        paths: gateConfig.fingerprint.paths,
        ...(gateConfig.fingerprint.exclude && { exclude: gateConfig.fingerprint.exclude }),
        baseDir,
      })
    } catch (error) {
      return fail('malformed', error instanceof Error ? error.message : String(error), {
        gateId: gate,
        path: artifactPath,
      })
    }
    const match = perFile.find((f) => f.path === target)
    if (!match) {
      return fail('malformed', `Path '${artifactPath}' is not matched by pattern gate '${gate}'`, {
        gateId: gate,
        path: artifactPath,
      })
    }

    const signed = await createSealWithProvider({
      gateId: gate,
      fingerprint: match.fingerprint,
      sealedBy: params.identity,
      keyProvider,
      keyRef,
    })
    // artifactPath is a storage/linkage field; the signature already binds the
    // file's path via its fingerprint, so it is attached after signing.
    const perFileSeal: Seal = { ...signed, artifactPath: target }
    const root = resolveSealsRoot(baseDir, loaded.settings.sealsPath)
    await writeSealFile(root, perFileSeal)

    return {
      schemaVersion: API_SCHEMA_VERSION,
      ok: true,
      gateId: gate,
      path: artifactPath,
      fingerprint: perFileSeal.fingerprint,
      sealedBy: perFileSeal.sealedBy,
      sealedAt: perFileSeal.timestamp,
    }
  }

  // Compute the fingerprint to sign.
  const fingerprintResult = await computeFingerprint({
    paths: gateConfig.fingerprint.paths,
    ...(gateConfig.fingerprint.exclude && { exclude: gateConfig.fingerprint.exclude }),
    baseDir,
  })

  // Sign the seal via the identity's backend. Delegated signing keeps the raw
  // private key inside the backend; otherwise the key is unlocked to a temp PEM.
  const newSeal = await createSealWithProvider({
    gateId: gate,
    fingerprint: fingerprintResult.fingerprint,
    sealedBy: params.identity,
    keyProvider,
    keyRef,
  })

  let existing: SealsFile
  try {
    existing = await readSeals(baseDir, loaded.settings.sealsPath)
  } catch (error) {
    return fail('malformed', error instanceof Error ? error.message : String(error), {
      gateId: gate,
      path: artifactPath,
    })
  }
  const seals: SealsFile = {
    version: existing.version,
    seals: { ...existing.seals, [gate]: newSeal },
  }
  await writeSeals(baseDir, seals, loaded.settings.sealsPath)

  return {
    schemaVersion: API_SCHEMA_VERSION,
    ok: true,
    gateId: gate,
    path: artifactPath,
    fingerprint: newSeal.fingerprint,
    sealedBy: newSeal.sealedBy,
    sealedAt: newSeal.timestamp,
  }
}

/**
 * Verify that a single artifact is validly, currently attested.
 *
 * The returned value **is** the answer: a {@link VerificationSuccess} when the
 * artifact is validly sealed, or an {@link ApiFailure} carrying the taxonomy
 * class (`unsealed`, `fingerprint-mismatch`, `unauthorized-signer`, `expired`,
 * `untrusted-config`, or `malformed`). Expected failure states are never thrown.
 *
 * @param artifactPath - The artifact path.
 * @param options - {@link VerifyOptions} (the trusted policy source for
 *   root-gate enforcement, plus {@link ApiOptions.baseDir}).
 * @returns The verification outcome.
 * @public
 */
export async function verifyOne(
  artifactPath: string,
  options: VerifyOptions = {},
): Promise<ArtifactVerification> {
  const baseDir = options.baseDir ?? process.cwd()
  const config = await loadConfigOrFail(baseDir)
  if (isApiFailure(config)) {
    return { ...config, path: artifactPath }
  }
  const loaded = config

  // MANDATORY PRE-STEP: verify the config's OWN root seal against the trusted
  // anchor before any gate is trusted. Fails closed on a blocking root-gate
  // state or an absent trusted source (see {@link enforceRootGate}).
  const rootFailure = await enforceRootGate(loaded, baseDir, options)
  if (rootFailure) {
    return { ...rootFailure, path: artifactPath }
  }

  const gateId = await resolveSingleGateOrFail(loaded, artifactPath, baseDir)
  if (typeof gateId !== 'string') {
    return gateId
  }

  return verifyPathInGate(loaded, gateId, baseDir, artifactPath)
}

/**
 * Determine whether any file in a gate was modified at or after `since`.
 */
async function gateChangedSince(
  config: AttestItConfig,
  gateId: string,
  baseDir: string,
  since: Date,
): Promise<boolean> {
  // eslint-disable-next-line security/detect-object-injection
  const gate = config.gates?.[gateId]
  if (!gate) {
    return false
  }
  let files: string[]
  try {
    files = await listPackageFiles(gate.fingerprint.paths, gate.fingerprint.exclude ?? [], baseDir)
  } catch {
    // Indeterminate: fail safe by treating this gate as changed so it is
    // re-verified rather than silently skipped as "unchanged".
    return true
  }
  for (const file of files) {
    try {
      const stats = await stat(path.resolve(baseDir, file))
      if (stats.mtime.getTime() >= since.getTime()) {
        return true
      }
    } catch {
      // Indeterminate: fail safe by treating this file as changed so the
      // gate is re-verified rather than silently skipped as "unchanged".
      return true
    }
  }
  return false
}

/**
 * Verify every gate, optionally restricted to gates whose files changed since a
 * given time.
 *
 * @param params - {@link VerifyAllParams}; `changedSince` (ISO-8601) filters to
 *   gates with at least one file modified at/after that time (by fs mtime).
 * @param options - {@link VerifyOptions} (the trusted policy source for
 *   root-gate enforcement, plus {@link ApiOptions.baseDir}).
 * @returns Per-gate {@link ArtifactVerification} outcomes, or a top-level
 *   {@link ApiFailure} if config load, root-gate enforcement, or a bad
 *   `changedSince` value fails.
 * @public
 */
export async function verifyAll(
  params: VerifyAllParams = {},
  options: VerifyOptions = {},
): Promise<VerifyAllResult | ApiFailure> {
  const baseDir = options.baseDir ?? process.cwd()
  const config = await loadConfigOrFail(baseDir)
  if (isApiFailure(config)) {
    return config
  }
  const loaded = config

  // MANDATORY PRE-STEP: verify the config's OWN root seal against the trusted
  // anchor before any gate is trusted. Fails closed on a blocking root-gate
  // state or an absent trusted source (see {@link enforceRootGate}).
  const rootFailure = await enforceRootGate(loaded, baseDir, options)
  if (rootFailure) {
    return rootFailure
  }

  let since: Date | undefined
  if (params.changedSince !== undefined) {
    since = new Date(params.changedSince)
    if (Number.isNaN(since.getTime())) {
      return fail('malformed', `Invalid changedSince timestamp: ${params.changedSince}`)
    }
  }

  const results: ArtifactVerification[] = []
  for (const gateId of Object.keys(loaded.gates ?? {})) {
    if (since && !(await gateChangedSince(loaded, gateId, baseDir, since))) {
      continue
    }
    // eslint-disable-next-line security/detect-object-injection
    const gate = loaded.gates?.[gateId]
    if (gate && isPatternGate(gate)) {
      results.push(...(await verifyPatternGate(loaded, gateId, gate, baseDir)))
    } else {
      results.push(await verifyGate(loaded, gateId, baseDir))
    }
  }

  return { schemaVersion: API_SCHEMA_VERSION, ok: true, results }
}
