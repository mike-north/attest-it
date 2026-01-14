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
 * The seals file structure stored at .attest-it/seals.json.
 * @public
 */
export interface SealsFile {
  /** Schema version for forward compatibility */
  version: 1
  /** Map of gate slugs to their seals */
  seals: Record<string, Seal>
}
