/**
 * Internal helpers shared by the embeddable API operations.
 *
 * Nothing here is part of the public contract; these functions map between the
 * gate-keyed core primitives and the path-keyed, taxonomy-tagged surface.
 *
 * @packageDocumentation
 */

import * as path from 'node:path'
import type { AttestItConfig } from '../types.js'
import type { Identity } from '../identity/index.js'
import { listPackageFiles } from '../fingerprint.js'
import { KeyProviderRegistry } from '../key-provider/index.js'
import type { VerificationState } from '../seal/verification.js'
import type { ApiFailure, FailureClass } from './types.js'
import { API_SCHEMA_VERSION } from './types.js'

/**
 * Type guard: is a value an {@link ApiFailure} (a returned failure) rather than
 * an operation's success payload?
 * @internal
 */
export function isApiFailure(value: object): value is ApiFailure {
  return 'ok' in value && value.ok === false
}

/**
 * Build an {@link ApiFailure}, stamping the current schema version.
 * @internal
 */
export function fail(
  failureClass: FailureClass,
  message: string,
  extra: Pick<ApiFailure, 'gateId' | 'path' | 'underlyingState'> = {},
): ApiFailure {
  return {
    schemaVersion: API_SCHEMA_VERSION,
    ok: false,
    failureClass,
    message,
    ...extra,
  }
}

/**
 * Map a low-level {@link VerificationState} to a taxonomy {@link FailureClass}.
 *
 * `VALID` has no failure class and is handled by the caller as success.
 *
 * Reconciliation of the core enum with the PRD taxonomy:
 * - `MISSING` → `unsealed` (governed gate, but no seal on disk)
 * - `STALE` → `expired` (seal older than the gate's `maxAge`)
 * - `FINGERPRINT_MISMATCH` → `fingerprint-mismatch`
 * - `UNKNOWN_SIGNER` → `unauthorized-signer` (signer absent or not authorized)
 * - `INVALID_SIGNATURE` → `unauthorized-signer` (a signature that does not
 *   verify cannot establish an authorized human signer; the original state is
 *   preserved in `underlyingState` so the distinction is not lost)
 *
 * @internal
 */
export function stateToFailureClass(state: Exclude<VerificationState, 'VALID'>): FailureClass {
  switch (state) {
    case 'MISSING':
      return 'unsealed'
    case 'STALE':
      return 'expired'
    case 'FINGERPRINT_MISMATCH':
      return 'fingerprint-mismatch'
    case 'UNKNOWN_SIGNER':
    case 'INVALID_SIGNATURE':
      return 'unauthorized-signer'
  }
}

/**
 * Normalize a caller-supplied artifact path to a forward-slash path relative to
 * `baseDir`, matching the relative paths produced by
 * {@link listPackageFiles}. Absolute paths and `./`-prefixed paths are both
 * accepted.
 *
 * @internal
 */
function normalizeRelativePath(artifactPath: string, baseDir: string): string {
  const absolute = path.isAbsolute(artifactPath)
    ? artifactPath
    : path.resolve(baseDir, artifactPath)
  const relative = path.relative(baseDir, absolute)
  return relative.split(path.sep).join('/')
}

/**
 * Resolve which gates govern a given artifact path.
 *
 * A gate governs the path when the path is among the files matched by the
 * gate's fingerprint globs (respecting `exclude`). This reuses the exact file
 * enumeration that fingerprinting uses, so ownership and fingerprint content
 * never drift apart.
 *
 * Returned gate ids are sorted lexicographically for determinism. A path may be
 * governed by zero, one, or several gates.
 *
 * NOTE (coupling): this enumerates the statically-configured `config.gates`.
 * Pattern gates (computed, not enumerated) will extend resolution here; this
 * function is the single place that change lands. File-per-seal storage changes
 * only how seals are read, not this resolution.
 *
 * @internal
 */
export async function resolveGatesForPath(
  config: AttestItConfig,
  artifactPath: string,
  baseDir: string,
): Promise<string[]> {
  if (!config.gates) {
    return []
  }

  const target = normalizeRelativePath(artifactPath, baseDir)
  const owning: string[] = []

  for (const [gateId, gate] of Object.entries(config.gates)) {
    let files: string[]
    try {
      files = await listPackageFiles(
        gate.fingerprint.paths,
        gate.fingerprint.exclude ?? [],
        baseDir,
      )
    } catch {
      // A gate whose globs match nothing (or error) simply does not own the path.
      continue
    }
    const normalized = files.map((f) => f.split(path.sep).join('/'))
    if (normalized.includes(target)) {
      owning.push(gateId)
    }
  }

  return owning.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
}

/**
 * Result of a configuration trust evaluation.
 * @internal
 */
export interface ConfigTrust {
  /** Whether the configuration is anchored to a trusted root. */
  trusted: boolean
  /** Explanation when `trusted` is false. */
  reason?: string
}

/**
 * Evaluate whether the loaded configuration is itself trust-anchored.
 *
 * STUB (see #72): root-gate trust anchoring is not yet implemented. Until it
 * lands, every successfully-loaded config is treated as trusted, so this check
 * never produces an `untrusted-config` failure. The `untrusted-config` class,
 * the wiring below, and this function's shape are intentionally in place now so
 * that completing #72 changes only this function's body — not the public
 * contract.
 *
 * @internal
 */
export function evaluateConfigTrust(_config: AttestItConfig, _baseDir: string): ConfigTrust {
  // TODO(#72): evaluate the config against the trusted root gate. Until then,
  // a config that parsed and merged successfully is considered trusted.
  return { trusted: true }
}

/**
 * Map an {@link Identity}'s private-key reference to a key provider instance.
 *
 * Mirrors the CLI's identity→provider mapping so the library `seal()` resolves
 * keys the same way the `attest-it seal` command does.
 *
 * @internal
 */
export function keyProviderForIdentity(
  identity: Identity,
): ReturnType<typeof KeyProviderRegistry.create> {
  const { privateKey } = identity

  switch (privateKey.type) {
    case 'file':
      // VaultKeeper file backend — id is the VaultKeeper secret ID.
      return KeyProviderRegistry.create({ type: 'filesystem', options: {} })
    case 'keychain':
      // VaultKeeper keychain backend — id is the VaultKeeper secret ID.
      return KeyProviderRegistry.create({ type: 'macos-keychain', options: {} })
    case '1password':
      // VaultKeeper 1Password backend — id is the VaultKeeper secret ID.
      return KeyProviderRegistry.create({ type: '1password', options: {} })
    case 'yubikey':
      // VaultKeeper YubiKey backend — id is the VaultKeeper secret ID.
      return KeyProviderRegistry.create({ type: 'yubikey', options: {} })
    case 'filesystem':
      // Legacy filesystem provider — for v1 identities not yet imported into
      // VaultKeeper. The key ref is a raw PEM path on disk.
      return KeyProviderRegistry.create({ type: 'filesystem-legacy', options: {} })
    default: {
      const _exhaustive: never = privateKey
      throw new Error(`Unsupported private key type: ${String(_exhaustive)}`)
    }
  }
}

/**
 * Get the provider key-reference string for an {@link Identity}.
 *
 * For v2 VaultKeeper-backed types the ref is the secret ID; for the legacy
 * `filesystem` type it is the file path.
 *
 * @internal
 */
export function keyRefForIdentity(identity: Identity): string {
  const { privateKey } = identity

  switch (privateKey.type) {
    case 'file':
      return privateKey.id
    case 'keychain':
      return privateKey.id
    case '1password':
      return privateKey.id
    case 'yubikey':
      return privateKey.id
    case 'filesystem':
      return privateKey.path
    default: {
      const _exhaustive: never = privateKey
      throw new Error(`Unsupported private key type: ${String(_exhaustive)}`)
    }
  }
}
