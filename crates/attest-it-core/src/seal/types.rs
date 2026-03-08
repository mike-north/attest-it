//! Seal domain types.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use crate::serde_helpers::deserialize_version;

/// A cryptographic seal attesting that a gate's fingerprint was verified
/// by an authorized team member.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Seal {
    /// The gate this seal applies to (slug identifier).
    pub gate_id: String,
    /// Content fingerprint at seal time (format: `"sha256:<hex>"`).
    pub fingerprint: String,
    /// ISO 8601 UTC timestamp when the seal was created.
    pub timestamp: String,
    /// Team member slug who created the seal.
    pub sealed_by: String,
    /// Base64-encoded Ed25519 signature over the canonical string
    /// `"{gateId}:{fingerprint}:{timestamp}"`.
    pub signature: String,
}

/// Persistent storage format for seals.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SealsFile {
    /// Schema version (always 1).
    #[serde(deserialize_with = "deserialize_version")]
    pub version: u32,
    /// Map of gate ID → seal.
    pub seals: HashMap<String, Seal>,
}

impl Default for SealsFile {
    fn default() -> Self {
        Self {
            version: 1,
            seals: HashMap::new(),
        }
    }
}

/// Result of verifying a single gate's seal.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SealVerificationResult {
    /// The gate that was verified.
    pub gate_id: String,
    /// Verification outcome.
    pub state: VerificationState,
    /// The seal that was checked (if one exists).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub seal: Option<Seal>,
    /// Human-readable explanation.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

/// Outcome of a gate seal verification check.
///
/// These states form a priority-ordered state machine: the verification
/// algorithm checks each condition in order and returns the first failure.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum VerificationState {
    /// Seal is present, fingerprint matches, signer authorized, signature valid, not stale.
    Valid,
    /// No seal exists for this gate.
    Missing,
    /// Seal exists but the fingerprint has changed since sealing.
    FingerprintMismatch,
    /// Seal was created by someone not in the gate's authorized signers.
    UnknownSigner,
    /// The Ed25519 signature on the seal is invalid.
    InvalidSignature,
    /// Seal is valid but older than the gate's `maxAge` threshold.
    Stale,
}

impl std::fmt::Display for VerificationState {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Valid => write!(f, "VALID"),
            Self::Missing => write!(f, "MISSING"),
            Self::FingerprintMismatch => write!(f, "FINGERPRINT_MISMATCH"),
            Self::UnknownSigner => write!(f, "UNKNOWN_SIGNER"),
            Self::InvalidSignature => write!(f, "INVALID_SIGNATURE"),
            Self::Stale => write!(f, "STALE"),
        }
    }
}
