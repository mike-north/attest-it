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

import { readFile, stat } from 'node:fs/promises'
import * as path from 'node:path'
import type { AttestItConfig } from '../types.js'
import { loadSplitConfig } from '../config/index.js'
import { computeFingerprint, listPackageFiles } from '../fingerprint.js'
import { loadLocalConfigSync } from '../identity/index.js'
import { createSeal, readSeals, writeSeals, verifyGateSeal, type SealsFile } from '../seal/index.js'
import {
  evaluateConfigTrust,
  fail,
  isApiFailure,
  keyProviderForIdentity,
  keyRefForIdentity,
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
  type VerificationSuccess,
  type VerifyAllParams,
  type VerifyAllResult,
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
      packages: gate.fingerprint.paths,
      ...(gate.fingerprint.exclude && { ignore: gate.fingerprint.exclude }),
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

  if (verdict.state === 'VALID') {
    const success: VerificationSuccess = {
      schemaVersion: API_SCHEMA_VERSION,
      ok: true,
      gateId,
      fingerprint,
      sealedBy: verdict.seal?.sealedBy ?? '',
      sealedAt: verdict.seal?.timestamp ?? '',
      ...(artifactPath !== undefined && { path: artifactPath }),
    }
    return success
  }

  return fail(stateToFailureClass(verdict.state), verdict.message ?? verdict.state, {
    gateId,
    underlyingState: verdict.state,
    ...(artifactPath !== undefined && { path: artifactPath }),
  })
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
    authorizedSigners: [...gate.authorizedSigners],
    paths: [...gate.fingerprint.paths],
    exclude: [...(gate.fingerprint.exclude ?? [])],
    maxAge: gate.maxAge,
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
      const gate = await resolveSingleGateOrFail(loaded, artifactPath, baseDir)
      if (typeof gate !== 'string') {
        results.push(gate)
        continue
      }
      results.push(await verifyGate(loaded, gate, baseDir, artifactPath))
    }
  } else {
    for (const gateId of Object.keys(loaded.gates ?? {})) {
      results.push(await verifyGate(loaded, gateId, baseDir))
    }
  }

  return { schemaVersion: API_SCHEMA_VERSION, ok: true, results }
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
    const result = await computeFingerprint({
      packages: gateConfig.fingerprint.paths,
      ...(gateConfig.fingerprint.exclude && { ignore: gateConfig.fingerprint.exclude }),
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

  // Compute the fingerprint to sign.
  const fingerprintResult = await computeFingerprint({
    packages: gateConfig.fingerprint.paths,
    ...(gateConfig.fingerprint.exclude && { ignore: gateConfig.fingerprint.exclude }),
    baseDir,
  })

  // Resolve the private key via the identity's backend. The unlock happens here.
  const keyProvider = keyProviderForIdentity(identity)
  const keyResult = await keyProvider.getPrivateKey(keyRefForIdentity(identity))
  let privateKeyPem: string
  try {
    privateKeyPem = await readFile(keyResult.keyPath, 'utf8')
  } finally {
    await keyResult.cleanup()
  }

  const newSeal = createSeal({
    gateId: gate,
    fingerprint: fingerprintResult.fingerprint,
    sealedBy: params.identity,
    privateKey: privateKeyPem,
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
 * @param options - {@link ApiOptions}
 * @returns The verification outcome.
 * @public
 */
export async function verifyOne(
  artifactPath: string,
  options: ApiOptions = {},
): Promise<ArtifactVerification> {
  const baseDir = options.baseDir ?? process.cwd()
  const config = await loadConfigOrFail(baseDir)
  if (isApiFailure(config)) {
    return { ...config, path: artifactPath }
  }
  const loaded = config

  const trust = evaluateConfigTrust(loaded, baseDir)
  if (!trust.trusted) {
    return fail('untrusted-config', trust.reason ?? 'Configuration is not trust-anchored', {
      path: artifactPath,
    })
  }

  const gate = await resolveSingleGateOrFail(loaded, artifactPath, baseDir)
  if (typeof gate !== 'string') {
    return gate
  }

  return verifyGate(loaded, gate, baseDir, artifactPath)
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
 * @param options - {@link ApiOptions}
 * @returns Per-gate {@link ArtifactVerification} outcomes, or a top-level
 *   {@link ApiFailure} if config load, trust evaluation, or a bad
 *   `changedSince` value fails.
 * @public
 */
export async function verifyAll(
  params: VerifyAllParams = {},
  options: ApiOptions = {},
): Promise<VerifyAllResult | ApiFailure> {
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
    results.push(await verifyGate(loaded, gateId, baseDir))
  }

  return { schemaVersion: API_SCHEMA_VERSION, ok: true, results }
}
