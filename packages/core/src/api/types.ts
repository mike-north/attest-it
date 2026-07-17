/**
 * Stable, versioned types for the embeddable attest-it API surface.
 *
 * This module is the single home for the discriminated result union and the
 * failure taxonomy that embedders (e.g. Toolsmith) code against. The shape of
 * these types is a contract: a change to any result shape or to the failure
 * taxonomy is a breaking release (see {@link API_SCHEMA_VERSION}).
 *
 * @packageDocumentation
 */

import type { VerificationState } from '../seal/verification.js'

/**
 * Version of the embeddable API's structured output schemas.
 *
 * Every structured result returned by the API carries this value in its
 * `schemaVersion` field so serialized output (library return values and the
 * CLI `--json` surface) is self-describing. Bumping this constant — or changing
 * the shape of any exported result type or the {@link FailureClass} union — is a
 * **breaking release** and must be documented as such in the changeset.
 *
 * @public
 */
export const API_SCHEMA_VERSION = 1

/**
 * The literal type of {@link API_SCHEMA_VERSION}.
 * @public
 */
export type ApiSchemaVersion = typeof API_SCHEMA_VERSION

/**
 * The documented, versioned failure taxonomy.
 *
 * Every expected failure of an API operation is tagged with exactly one of
 * these classes. This is the stable vocabulary an embedder pins against.
 *
 * - `unsealed` — the artifact is governed by a gate, but no seal exists for it.
 * - `fingerprint-mismatch` — a seal exists, but the artifact's content changed
 *   since it was sealed.
 * - `unauthorized-signer` — the seal's signer is not authorized for the gate, or
 *   the signature does not cryptographically verify against an authorized key.
 * - `untrusted-config` — the policy/config defining trust is not itself anchored
 *   to a trusted root. Reserved for the root-gate trust work; it is shipped as a
 *   documented stub and is not returned at runtime until that work lands.
 * - `expired` — a valid seal exists but is older than the gate's `maxAge`.
 * - `malformed` — the input or on-disk state cannot be interpreted: an
 *   unparseable config, an unreadable/structurally-invalid seal, or a path that
 *   is not governed by any gate under the current policy.
 *
 * Environmental errors that are **not** attestation states — key-backend unlock
 * failure or cancellation, filesystem I/O errors — are surfaced as thrown
 * exceptions, not taxonomy failures. Embedders treat those as an inability to
 * decide and fail closed (degrade to a human prompt).
 *
 * @public
 */
export type FailureClass =
  | 'unsealed'
  | 'fingerprint-mismatch'
  | 'unauthorized-signer'
  | 'untrusted-config'
  | 'expired'
  | 'malformed'

/**
 * Fields common to every structured API result.
 * @public
 */
export interface ApiResultBase {
  /** Schema version of this result shape. See {@link API_SCHEMA_VERSION}. */
  schemaVersion: ApiSchemaVersion
}

/**
 * A failed operation, tagged with a taxonomy {@link FailureClass}.
 *
 * This is returned as a value (never thrown) for every anticipated failure
 * state, so callers pattern-match on `ok === false` and `failureClass` rather
 * than catching exceptions.
 *
 * @public
 */
export interface ApiFailure extends ApiResultBase {
  /** Discriminant: this is a failure result. */
  ok: false
  /** The taxonomy class this failure belongs to. */
  failureClass: FailureClass
  /** Human-legible explanation of the failure. */
  message: string
  /** The gate involved, when the failure could be attributed to one. */
  gateId?: string
  /** The artifact path involved, for path-keyed operations. */
  path?: string
  /**
   * The lower-level verification state that produced this failure, when the
   * failure came from seal verification. Preserves detail (e.g. distinguishing
   * an invalid signature from an unknown signer) that the coarser
   * {@link FailureClass} collapses.
   */
  underlyingState?: VerificationState
}

/**
 * A single gate's definition, as returned by {@link listGates}.
 * @public
 */
export interface GateDescriptor {
  /** Gate identifier (slug). */
  gateId: string
  /** Human-readable gate name. */
  name: string
  /** Description of what the gate protects. */
  description: string
  /** Team member slugs authorized to seal this gate. */
  authorizedSigners: string[]
  /** Glob patterns whose matched files form the gate's fingerprint. */
  paths: string[]
  /** Glob patterns excluded from the fingerprint. */
  exclude: string[]
  /** Maximum seal age before it is considered expired (duration string). */
  maxAge: string
}

/**
 * Successful result of {@link listGates}.
 * @public
 */
export interface ListGatesResult extends ApiResultBase {
  /** Discriminant: success. */
  ok: true
  /** All gates enumerated from the current configuration. */
  gates: GateDescriptor[]
}

/**
 * Successful result of {@link fingerprint}.
 * @public
 */
export interface FingerprintResultOk extends ApiResultBase {
  /** Discriminant: success. */
  ok: true
  /** The gate that governs the requested path. */
  gateId: string
  /** The path the fingerprint was requested for. */
  path: string
  /** The gate's current fingerprint, in `sha256:...` form. */
  fingerprint: string
  /** Number of files contributing to the fingerprint. */
  fileCount: number
}

/**
 * Successful verification of a single artifact/gate.
 *
 * The absence of a `failureClass` and `ok === true` together mean the artifact
 * is validly, currently attested by an authorized human signer.
 *
 * @public
 */
export interface VerificationSuccess extends ApiResultBase {
  /** Discriminant: success. */
  ok: true
  /** The gate that was verified. */
  gateId: string
  /** The artifact path, when the verification was path-keyed. */
  path?: string
  /** The fingerprint that was verified. */
  fingerprint: string
  /** Team member slug that created the seal. */
  sealedBy: string
  /** ISO-8601 timestamp when the seal was created. */
  sealedAt: string
}

/**
 * The verification outcome for one artifact or gate: either a
 * {@link VerificationSuccess} or an {@link ApiFailure} carrying a taxonomy class.
 * @public
 */
export type ArtifactVerification = VerificationSuccess | ApiFailure

/**
 * Successful result of {@link status}: the per-target verification outcomes.
 *
 * The top-level `ok: true` only means the operation ran; each element of
 * `results` carries its own success/failure verdict.
 *
 * @public
 */
export interface StatusResult extends ApiResultBase {
  /** Discriminant: the operation ran. */
  ok: true
  /** One verification outcome per gate (no paths) or per resolved path. */
  results: ArtifactVerification[]
}

/**
 * Successful result of {@link verifyAll}: the verification outcomes for every
 * (optionally change-filtered) gate.
 * @public
 */
export interface VerifyAllResult extends ApiResultBase {
  /** Discriminant: the operation ran. */
  ok: true
  /** One verification outcome per verified gate. */
  results: ArtifactVerification[]
}

/**
 * Successful result of {@link seal}.
 * @public
 */
export interface SealResult extends ApiResultBase {
  /** Discriminant: success. */
  ok: true
  /** The gate that was sealed. */
  gateId: string
  /** The path whose owning gate was sealed. */
  path: string
  /** The fingerprint that was sealed. */
  fingerprint: string
  /** Team member slug that created the seal. */
  sealedBy: string
  /** ISO-8601 timestamp when the seal was created. */
  sealedAt: string
}

/**
 * Options common to every API operation.
 * @public
 */
export interface ApiOptions {
  /**
   * Base directory the operation runs against. Defaults to `process.cwd()`.
   * Config, seals, and artifact paths are all resolved relative to this
   * directory, so an embedder can point the API at a checked-out worktree.
   */
  baseDir?: string
}

/**
 * Parameters for {@link seal}.
 * @public
 */
export interface SealParams {
  /**
   * The identity to seal as — a key in the caller's local identity config
   * (`identities[identity]`). Its configured key backend performs the unlock.
   */
  identity: string
}

/**
 * Parameters for {@link verifyAll}.
 * @public
 */
export interface VerifyAllParams {
  /**
   * When set, restrict verification to gates that have at least one file
   * modified at or after this ISO-8601 timestamp (by filesystem mtime).
   *
   * This is deliberately host-agnostic: attest-it does not invoke git. An
   * embedder that already knows which paths changed (e.g. from a git diff it
   * owns) can instead call {@link status} with those paths.
   */
  changedSince?: string
}
