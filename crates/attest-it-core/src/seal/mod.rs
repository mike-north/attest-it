//! Seal creation, storage, and verification.
//!
//! A **seal** is a cryptographic attestation that a gate's content fingerprint
//! was verified by an authorized team member. It contains an Ed25519 signature
//! over the canonical string `"{gateId}:{fingerprint}:{timestamp}"`, proving
//! that the named signer approved the exact content at a specific point in time.
//!
//! Seals are persisted in a [`SealsFile`] (typically `.attest-it/seals.json`)
//! and verified against the current fingerprint and the gate's authorized signers.

pub mod operations;
#[cfg(test)]
mod tests;
pub mod types;
pub mod verification;

pub use operations::{canonical_signing_payload, create_seal, verify_seal_signature};
pub use types::{Seal, SealVerificationResult, SealsFile, VerificationState};
pub use verification::{verify_all_seals, verify_gate_seal};
