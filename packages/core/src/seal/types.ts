/**
 * Seal types for attest-it v2.0.
 * @packageDocumentation
 */

/**
 * A seal represents a cryptographic attestation that a gate's fingerprint
 * was signed by an authorized team member.
 * @public
 */
export interface Seal {
  /** Gate identifier (slug) */
  gateId: string
  /** SHA-256 fingerprint of the gate's content in format "sha256:..." */
  fingerprint: string
  /** ISO 8601 timestamp when the seal was created */
  timestamp: string
  /** Team member slug who created the seal */
  sealedBy: string
  /** Base64-encoded Ed25519 signature of gateId:fingerprint:timestamp */
  signature: string
}

/**
 * The in-memory aggregate view of all seals.
 *
 * @remarks
 * Seals are persisted **one file per (gate, signer)** under the seals storage
 * directory (default `.attest-it/seals/`); this interface is the aggregate the
 * storage layer assembles on read and fans out on write. It is inherently
 * one-seal-per-gate (`seals` is keyed by gate slug) — see the seal storage
 * module for how multiple signer files per gate (m-of-n) are stored and how the
 * aggregate collapses them.
 *
 * `version` is `1` for the retired monolithic single-file era and `2` for the
 * file-per-seal era; reads normalize to the current version.
 * @public
 */
export interface SealsFile {
  /** Schema version for forward compatibility (`1` = monolithic, `2` = file-per-seal). */
  version: 1 | 2
  /** Map of gate slugs to their seals */
  seals: Record<string, Seal>
}
