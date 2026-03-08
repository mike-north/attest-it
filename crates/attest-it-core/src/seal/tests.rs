//! Serde round-trip tests for seal types.

#[cfg(test)]
mod serde_roundtrip {
    use std::collections::HashMap;

    use crate::seal::types::*;

    #[test]
    fn seal_json_field_names() {
        let seal = Seal {
            gate_id: "ui-gate".to_owned(),
            fingerprint: "sha256:abc123".to_owned(),
            timestamp: "2024-06-01T08:00:00.000Z".to_owned(),
            sealed_by: "alice".to_owned(),
            signature: "c2lnbmF0dXJl".to_owned(),
        };
        let json = serde_json::to_value(&seal).unwrap();
        assert_eq!(json["gateId"], "ui-gate");
        assert_eq!(json["fingerprint"], "sha256:abc123");
        assert_eq!(json["timestamp"], "2024-06-01T08:00:00.000Z");
        assert_eq!(json["sealedBy"], "alice");
        assert_eq!(json["signature"], "c2lnbmF0dXJl");
    }

    #[test]
    fn seal_roundtrip() {
        let seal = Seal {
            gate_id: "test-gate".to_owned(),
            fingerprint: "sha256:deadbeef".to_owned(),
            timestamp: "2024-01-15T10:30:00.000Z".to_owned(),
            sealed_by: "bob".to_owned(),
            signature: "dGVzdHNpZw==".to_owned(),
        };
        let json = serde_json::to_string(&seal).unwrap();
        let back: Seal = serde_json::from_str(&json).unwrap();
        assert_eq!(seal, back);
    }

    #[test]
    fn seals_file_json_structure() {
        let mut seals = HashMap::new();
        seals.insert(
            "ui-gate".to_owned(),
            Seal {
                gate_id: "ui-gate".to_owned(),
                fingerprint: "sha256:abc".to_owned(),
                timestamp: "2024-01-15T10:30:00.000Z".to_owned(),
                sealed_by: "alice".to_owned(),
                signature: "sig".to_owned(),
            },
        );
        let file = SealsFile { version: 1, seals };
        let json = serde_json::to_value(&file).unwrap();
        assert_eq!(json["version"], 1);
        assert!(json["seals"]["ui-gate"].is_object());
    }

    #[test]
    fn seals_file_default() {
        let file = SealsFile::default();
        assert_eq!(file.version, 1);
        assert!(file.seals.is_empty());
    }

    #[test]
    fn verification_state_serializes_screaming_snake() {
        assert_eq!(
            serde_json::to_value(VerificationState::Valid).unwrap(),
            "VALID"
        );
        assert_eq!(
            serde_json::to_value(VerificationState::Missing).unwrap(),
            "MISSING"
        );
        assert_eq!(
            serde_json::to_value(VerificationState::FingerprintMismatch).unwrap(),
            "FINGERPRINT_MISMATCH"
        );
        assert_eq!(
            serde_json::to_value(VerificationState::UnknownSigner).unwrap(),
            "UNKNOWN_SIGNER"
        );
        assert_eq!(
            serde_json::to_value(VerificationState::InvalidSignature).unwrap(),
            "INVALID_SIGNATURE"
        );
        assert_eq!(
            serde_json::to_value(VerificationState::Stale).unwrap(),
            "STALE"
        );
    }

    #[test]
    fn verification_state_deserializes() {
        let state: VerificationState = serde_json::from_str("\"FINGERPRINT_MISMATCH\"").unwrap();
        assert_eq!(state, VerificationState::FingerprintMismatch);
    }

    #[test]
    fn seal_verification_result_json() {
        let result = SealVerificationResult {
            gate_id: "ui-gate".to_owned(),
            state: VerificationState::Valid,
            seal: Some(Seal {
                gate_id: "ui-gate".to_owned(),
                fingerprint: "sha256:abc".to_owned(),
                timestamp: "2024-01-15T10:30:00.000Z".to_owned(),
                sealed_by: "alice".to_owned(),
                signature: "sig".to_owned(),
            }),
            message: None,
        };
        let json = serde_json::to_value(&result).unwrap();
        assert_eq!(json["gateId"], "ui-gate");
        assert_eq!(json["state"], "VALID");
        assert!(json["seal"].is_object());
        assert!(json.get("message").is_none());
    }
}
