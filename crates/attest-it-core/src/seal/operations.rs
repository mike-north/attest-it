//! Seal creation and cryptographic signature verification.
//!
//! Seal creation delegates signing to [`HostPlatform::sign_ed25519`] (VaultKeeper).
//! Signature verification uses `ed25519-dalek` directly — only public keys are
//! needed, so no host call is required.

use base64ct::{Base64, Encoding};
use ed25519_dalek::{Signature, Verifier, VerifyingKey};

use crate::config::types::{AttestItConfig, TeamMember};
use crate::errors::AttestError;
use crate::host::HostPlatform;
use crate::seal::types::Seal;

/// Build the canonical string that is signed/verified for a seal.
///
/// Format: `"{gateId}:{fingerprint}:{timestamp}"`
///
/// This is extracted as a standalone function so that both creation and
/// verification use the exact same canonical representation.
pub fn canonical_signing_payload(gate_id: &str, fingerprint: &str, timestamp: &str) -> String {
    format!("{gate_id}:{fingerprint}:{timestamp}")
}

/// Create a seal by signing the canonical payload via the host platform.
///
/// The host's `sign_ed25519` method delegates to VaultKeeper's delegated exec —
/// private keys never leave VaultKeeper.
///
/// # Errors
///
/// Returns [`AttestError::SigningFailed`] if the host signing call fails.
pub async fn create_seal(
    gate_id: &str,
    fingerprint: &str,
    sealed_by: &str,
    host: &dyn HostPlatform,
) -> Result<Seal, AttestError> {
    let timestamp = host.now_utc();
    let canonical = canonical_signing_payload(gate_id, fingerprint, &timestamp);

    let sign_result = host.sign_ed25519(canonical.as_bytes(), sealed_by).await?;

    Ok(Seal {
        gate_id: gate_id.to_string(),
        fingerprint: fingerprint.to_string(),
        timestamp,
        sealed_by: sealed_by.to_string(),
        signature: sign_result.signature,
    })
}

/// Result of verifying a seal's Ed25519 signature.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SignatureVerificationResult {
    /// Whether the signature is cryptographically valid.
    pub valid: bool,
    /// Error description if verification failed.
    pub error: Option<String>,
}

/// Verify a seal's Ed25519 signature against the signer's public key from config.
///
/// Reconstructs the canonical string and verifies the signature using
/// `ed25519-dalek`. No host platform call is needed — public keys come from
/// the configuration.
pub fn verify_seal_signature(seal: &Seal, config: &AttestItConfig) -> SignatureVerificationResult {
    // Look up team member
    let team_member = match config.team.get(&seal.sealed_by) {
        Some(m) => m,
        None => {
            return SignatureVerificationResult {
                valid: false,
                error: Some(format!(
                    "Team member '{}' not found in configuration",
                    seal.sealed_by
                )),
            };
        }
    };

    verify_seal_signature_with_key(seal, team_member)
}

/// Verify a seal's signature using a specific team member's public key.
///
/// This is the low-level verification that performs the actual Ed25519 check.
pub fn verify_seal_signature_with_key(
    seal: &Seal,
    team_member: &TeamMember,
) -> SignatureVerificationResult {
    // Decode the public key (base64-encoded raw 32 bytes)
    let public_key_bytes = match Base64::decode_vec(&team_member.public_key) {
        Ok(bytes) => bytes,
        Err(_) => {
            return SignatureVerificationResult {
                valid: false,
                error: Some(format!(
                    "Invalid base64 in public key for '{}'",
                    team_member.name
                )),
            };
        }
    };

    if public_key_bytes.len() != 32 {
        return SignatureVerificationResult {
            valid: false,
            error: Some(format!(
                "Invalid Ed25519 public key length: expected 32 bytes, got {}",
                public_key_bytes.len()
            )),
        };
    }

    let verifying_key = match VerifyingKey::from_bytes(
        public_key_bytes
            .as_slice()
            .try_into()
            .expect("length checked above"),
    ) {
        Ok(k) => k,
        Err(e) => {
            return SignatureVerificationResult {
                valid: false,
                error: Some(format!("Invalid Ed25519 public key: {e}")),
            };
        }
    };

    // Decode the signature (base64-encoded 64 bytes)
    let sig_bytes = match Base64::decode_vec(&seal.signature) {
        Ok(bytes) => bytes,
        Err(_) => {
            return SignatureVerificationResult {
                valid: false,
                error: Some("Invalid base64 in signature".to_string()),
            };
        }
    };

    if sig_bytes.len() != 64 {
        return SignatureVerificationResult {
            valid: false,
            error: Some(format!(
                "Invalid Ed25519 signature length: expected 64 bytes, got {}",
                sig_bytes.len()
            )),
        };
    }

    let signature = Signature::from_bytes(
        sig_bytes
            .as_slice()
            .try_into()
            .expect("length checked above"),
    );

    // Reconstruct canonical string and verify
    let canonical = canonical_signing_payload(&seal.gate_id, &seal.fingerprint, &seal.timestamp);

    match verifying_key.verify(canonical.as_bytes(), &signature) {
        Ok(()) => SignatureVerificationResult {
            valid: true,
            error: None,
        },
        Err(_) => SignatureVerificationResult {
            valid: false,
            error: Some("Signature verification failed".to_string()),
        },
    }
}

#[cfg(test)]
mod tests {
    use ed25519_dalek::{Signer, SigningKey};

    use super::*;

    #[test]
    fn canonical_signing_payload_format() {
        let payload =
            canonical_signing_payload("login-gate", "sha256:abc123", "2024-06-01T08:00:00.000Z");
        assert_eq!(payload, "login-gate:sha256:abc123:2024-06-01T08:00:00.000Z");
    }

    #[test]
    fn canonical_signing_payload_empty_fields() {
        let payload = canonical_signing_payload("", "", "");
        assert_eq!(payload, "::");
    }

    /// Generate a test keypair and create a real signed seal.
    fn make_signed_seal(gate_id: &str, fingerprint: &str) -> (Seal, TeamMember) {
        let signing_key = SigningKey::from_bytes(&[42u8; 32]);
        let verifying_key = signing_key.verifying_key();
        let public_key_b64 = Base64::encode_string(verifying_key.as_bytes());

        let timestamp = "2024-06-01T08:00:00.000Z";
        let canonical = canonical_signing_payload(gate_id, fingerprint, timestamp);
        let signature: Signature = signing_key.sign(canonical.as_bytes());
        let signature_b64 = Base64::encode_string(&signature.to_bytes());

        let seal = Seal {
            gate_id: gate_id.to_string(),
            fingerprint: fingerprint.to_string(),
            timestamp: timestamp.to_string(),
            sealed_by: "alice".to_string(),
            signature: signature_b64,
        };

        let team_member = TeamMember {
            name: "Alice".to_string(),
            email: None,
            github: None,
            public_key: public_key_b64,
            public_key_algorithm: None,
        };

        (seal, team_member)
    }

    #[test]
    fn verify_valid_signature() {
        let (seal, member) = make_signed_seal("login-gate", "sha256:abc123");
        let result = verify_seal_signature_with_key(&seal, &member);
        assert!(result.valid);
        assert!(result.error.is_none());
    }

    #[test]
    fn verify_tampered_fingerprint_fails() {
        let (mut seal, member) = make_signed_seal("login-gate", "sha256:abc123");
        seal.fingerprint = "sha256:tampered".to_string();
        let result = verify_seal_signature_with_key(&seal, &member);
        assert!(!result.valid);
        assert_eq!(
            result.error.as_deref(),
            Some("Signature verification failed")
        );
    }

    #[test]
    fn verify_tampered_gate_id_fails() {
        let (mut seal, member) = make_signed_seal("login-gate", "sha256:abc123");
        seal.gate_id = "other-gate".to_string();
        let result = verify_seal_signature_with_key(&seal, &member);
        assert!(!result.valid);
    }

    #[test]
    fn verify_tampered_timestamp_fails() {
        let (mut seal, member) = make_signed_seal("login-gate", "sha256:abc123");
        seal.timestamp = "2025-01-01T00:00:00.000Z".to_string();
        let result = verify_seal_signature_with_key(&seal, &member);
        assert!(!result.valid);
    }

    #[test]
    fn verify_wrong_public_key_fails() {
        let (seal, _) = make_signed_seal("login-gate", "sha256:abc123");
        // Different key
        let other_key = SigningKey::from_bytes(&[99u8; 32]);
        let wrong_member = TeamMember {
            name: "Wrong".to_string(),
            email: None,
            github: None,
            public_key: Base64::encode_string(other_key.verifying_key().as_bytes()),
            public_key_algorithm: None,
        };
        let result = verify_seal_signature_with_key(&seal, &wrong_member);
        assert!(!result.valid);
    }

    #[test]
    fn verify_invalid_base64_public_key() {
        let (seal, _) = make_signed_seal("login-gate", "sha256:abc123");
        let bad_member = TeamMember {
            name: "Bad".to_string(),
            email: None,
            github: None,
            public_key: "not-valid-base64!!!".to_string(),
            public_key_algorithm: None,
        };
        let result = verify_seal_signature_with_key(&seal, &bad_member);
        assert!(!result.valid);
        assert!(result.error.as_deref().unwrap().contains("Invalid base64"));
    }

    #[test]
    fn verify_wrong_length_public_key() {
        let (seal, _) = make_signed_seal("login-gate", "sha256:abc123");
        let bad_member = TeamMember {
            name: "Bad".to_string(),
            email: None,
            github: None,
            public_key: Base64::encode_string(&[1u8; 16]), // 16 bytes, not 32
            public_key_algorithm: None,
        };
        let result = verify_seal_signature_with_key(&seal, &bad_member);
        assert!(!result.valid);
        assert!(
            result
                .error
                .as_deref()
                .unwrap()
                .contains("expected 32 bytes")
        );
    }

    #[test]
    fn verify_invalid_base64_signature() {
        let (mut seal, member) = make_signed_seal("login-gate", "sha256:abc123");
        seal.signature = "not-valid-base64!!!".to_string();
        let result = verify_seal_signature_with_key(&seal, &member);
        assert!(!result.valid);
        assert!(result.error.as_deref().unwrap().contains("Invalid base64"));
    }

    #[test]
    fn verify_wrong_length_signature() {
        let (mut seal, member) = make_signed_seal("login-gate", "sha256:abc123");
        seal.signature = Base64::encode_string(&[1u8; 32]); // 32 bytes, not 64
        let result = verify_seal_signature_with_key(&seal, &member);
        assert!(!result.valid);
        assert!(
            result
                .error
                .as_deref()
                .unwrap()
                .contains("expected 64 bytes")
        );
    }

    #[test]
    fn verify_seal_signature_with_config_team_lookup() {
        use std::collections::HashMap;

        use crate::config::types::*;

        let (seal, member) = make_signed_seal("login-gate", "sha256:abc123");
        let mut team = HashMap::new();
        team.insert("alice".to_string(), member);

        let config = AttestItConfig {
            version: 1,
            min_version: None,
            settings: AttestItSettings::default(),
            team,
            gates: HashMap::new(),
            suites: HashMap::new(),
            groups: HashMap::new(),
        };

        let result = verify_seal_signature(&seal, &config);
        assert!(result.valid);
    }

    #[test]
    fn verify_seal_signature_team_member_not_found() {
        use std::collections::HashMap;

        use crate::config::types::*;

        let (seal, _) = make_signed_seal("login-gate", "sha256:abc123");

        let config = AttestItConfig {
            version: 1,
            min_version: None,
            settings: AttestItSettings::default(),
            team: HashMap::new(), // empty team
            gates: HashMap::new(),
            suites: HashMap::new(),
            groups: HashMap::new(),
        };

        let result = verify_seal_signature(&seal, &config);
        assert!(!result.valid);
        assert!(result.error.as_deref().unwrap().contains("not found"));
    }
}
