//! Gate seal verification state machine.
//!
//! Implements the priority-ordered verification algorithm:
//!
//! 1. Look up gate config → `MISSING` if not found
//! 2. Look up seal for gate → `MISSING` if not found
//! 3. Compare fingerprints → `FINGERPRINT_MISMATCH`
//! 4. Check signer authorization → `UNKNOWN_SIGNER`
//! 5. Verify Ed25519 signature → `INVALID_SIGNATURE`
//! 6. Check staleness (maxAge) → `STALE`
//! 7. All passed → `VALID`

use crate::authorization::{get_gate, is_authorized_signer};
use crate::config::duration::parse_duration_ms;
use crate::config::types::AttestItConfig;
use crate::seal::operations::verify_seal_signature;
use crate::seal::types::{SealVerificationResult, SealsFile, VerificationState};

/// Verify a single gate's seal against the current fingerprint.
///
/// Checks are performed in priority order; the first failure determines
/// the result state.
///
/// The `now_ms` parameter is the current time as milliseconds since the Unix
/// epoch. In production this comes from `HostPlatform::now_utc()` parsed to
/// a timestamp; in tests it can be controlled directly.
pub fn verify_gate_seal(
    config: &AttestItConfig,
    gate_id: &str,
    seals: &SealsFile,
    current_fingerprint: &str,
    now_ms: i64,
) -> SealVerificationResult {
    // 1. Gate exists?
    let gate = match get_gate(config, gate_id) {
        Some(g) => g,
        None => {
            return SealVerificationResult {
                gate_id: gate_id.to_string(),
                state: VerificationState::Missing,
                seal: None,
                message: Some(format!("Gate '{gate_id}' not found in configuration")),
            };
        }
    };

    // 2. Seal exists?
    let seal = match seals.seals.get(gate_id) {
        Some(s) => s,
        None => {
            return SealVerificationResult {
                gate_id: gate_id.to_string(),
                state: VerificationState::Missing,
                seal: None,
                message: Some(format!("No seal found for gate '{gate_id}'")),
            };
        }
    };

    // 3. Fingerprint match?
    if seal.fingerprint != current_fingerprint {
        return SealVerificationResult {
            gate_id: gate_id.to_string(),
            state: VerificationState::FingerprintMismatch,
            seal: Some(seal.clone()),
            message: Some("Fingerprint changed since seal was created".to_string()),
        };
    }

    // 4. Signer authorized?
    // First check team member exists
    let team_member = match config.team.get(&seal.sealed_by) {
        Some(m) => m,
        None => {
            return SealVerificationResult {
                gate_id: gate_id.to_string(),
                state: VerificationState::UnknownSigner,
                seal: Some(seal.clone()),
                message: Some(format!("Signer '{}' not found in team", seal.sealed_by)),
            };
        }
    };

    if !is_authorized_signer(config, gate_id, &team_member.public_key) {
        return SealVerificationResult {
            gate_id: gate_id.to_string(),
            state: VerificationState::UnknownSigner,
            seal: Some(seal.clone()),
            message: Some(format!(
                "Signer '{}' is not authorized for gate '{gate_id}'",
                seal.sealed_by
            )),
        };
    }

    // 5. Signature valid?
    let sig_result = verify_seal_signature(seal, config);
    if !sig_result.valid {
        return SealVerificationResult {
            gate_id: gate_id.to_string(),
            state: VerificationState::InvalidSignature,
            seal: Some(seal.clone()),
            message: Some(
                sig_result
                    .error
                    .unwrap_or_else(|| "Signature verification failed".to_string()),
            ),
        };
    }

    // 6. Staleness check
    match check_staleness(seal, gate, now_ms) {
        StalenessResult::Fresh => {}
        StalenessResult::Stale { message } => {
            return SealVerificationResult {
                gate_id: gate_id.to_string(),
                state: VerificationState::Stale,
                seal: Some(seal.clone()),
                message: Some(message),
            };
        }
    }

    // 7. All passed
    SealVerificationResult {
        gate_id: gate_id.to_string(),
        state: VerificationState::Valid,
        seal: Some(seal.clone()),
        message: None,
    }
}

/// Verify all gates' seals.
///
/// Returns one [`SealVerificationResult`] per gate defined in the config.
/// Gates with no corresponding fingerprint get a `MISSING` result.
pub fn verify_all_seals(
    config: &AttestItConfig,
    seals: &SealsFile,
    fingerprints: &std::collections::HashMap<String, String>,
    now_ms: i64,
) -> Vec<SealVerificationResult> {
    let mut results = Vec::new();

    for gate_id in config.gates.keys() {
        match fingerprints.get(gate_id) {
            Some(fp) => {
                results.push(verify_gate_seal(config, gate_id, seals, fp, now_ms));
            }
            None => {
                results.push(SealVerificationResult {
                    gate_id: gate_id.to_string(),
                    state: VerificationState::Missing,
                    seal: None,
                    message: Some(format!("No fingerprint computed for gate '{gate_id}'")),
                });
            }
        }
    }

    results
}

// ---------------------------------------------------------------------------
// Staleness helper
// ---------------------------------------------------------------------------

enum StalenessResult {
    Fresh,
    Stale { message: String },
}

/// Check whether a seal exceeds the gate's `maxAge`.
///
/// Fails closed: if `maxAge` can't be parsed or the timestamp is invalid,
/// the seal is treated as stale.
fn check_staleness(
    seal: &crate::seal::types::Seal,
    gate: &crate::config::types::GateConfig,
    now_ms: i64,
) -> StalenessResult {
    let max_age_ms = match parse_duration_ms(&gate.max_age) {
        Ok(ms) => ms as i64,
        Err(e) => {
            return StalenessResult::Stale {
                message: format!("Cannot verify freshness: invalid maxAge format: {e}"),
            };
        }
    };

    // Parse ISO 8601 timestamp to epoch millis.
    // We do a simplified parse: strip trailing 'Z', split on 'T', parse date/time.
    let seal_ms = match parse_iso8601_ms(&seal.timestamp) {
        Some(ms) => ms,
        None => {
            return StalenessResult::Stale {
                message: format!(
                    "Cannot verify freshness: invalid seal timestamp: {}",
                    seal.timestamp
                ),
            };
        }
    };

    let age_ms = now_ms - seal_ms;
    if age_ms > max_age_ms {
        let age_days = age_ms / (1000 * 60 * 60 * 24);
        let max_age_days = max_age_ms / (1000 * 60 * 60 * 24);
        StalenessResult::Stale {
            message: format!("Seal is {age_days} days old, exceeds maxAge of {max_age_days} days"),
        }
    } else {
        StalenessResult::Fresh
    }
}

/// Parse a subset of ISO 8601 timestamps to milliseconds since Unix epoch.
///
/// Handles formats like `"2024-06-01T08:00:00.000Z"` and `"2024-06-01T08:00:00Z"`.
/// Returns `None` for unparseable input.
fn parse_iso8601_ms(s: &str) -> Option<i64> {
    // Strip trailing 'Z'
    let s = s.strip_suffix('Z').or_else(|| s.strip_suffix('z'))?;

    let (date_part, time_part) = s.split_once('T')?;

    // Parse date: YYYY-MM-DD
    let mut date_parts = date_part.split('-');
    let year: i64 = date_parts.next()?.parse().ok()?;
    let month: i64 = date_parts.next()?.parse().ok()?;
    let day: i64 = date_parts.next()?.parse().ok()?;

    if !(1..=12).contains(&month) || !(1..=31).contains(&day) {
        return None;
    }

    // Parse time: HH:MM:SS or HH:MM:SS.mmm
    let (time_hms, millis) = if let Some((hms, frac)) = time_part.split_once('.') {
        // Parse fractional seconds as milliseconds
        let ms: i64 = if frac.len() >= 3 {
            frac[..3].parse().ok()?
        } else {
            // Pad to 3 digits
            let padded = format!("{frac:0<3}");
            padded.parse().ok()?
        };
        (hms, ms)
    } else {
        (time_part, 0i64)
    };

    let mut time_parts = time_hms.split(':');
    let hour: i64 = time_parts.next()?.parse().ok()?;
    let min: i64 = time_parts.next()?.parse().ok()?;
    let sec: i64 = time_parts.next()?.parse().ok()?;

    if !(0..=23).contains(&hour) || !(0..=59).contains(&min) || !(0..=60).contains(&sec) {
        return None;
    }

    // Convert to epoch millis using a simplified algorithm.
    // Days from year 0 to the start of this year (Gregorian calendar).
    let days = days_from_civil(year, month, day);
    let total_secs = days * 86400 + hour * 3600 + min * 60 + sec;
    Some(total_secs * 1000 + millis)
}

/// Convert a Gregorian date to days since Unix epoch (1970-01-01).
///
/// Uses Howard Hinnant's `days_from_civil` algorithm.
/// See: https://howardhinnant.github.io/date_algorithms.html
fn days_from_civil(year: i64, month: i64, day: i64) -> i64 {
    let y = if month <= 2 { year - 1 } else { year };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = (y - era * 400) as u64; // [0, 399]
    let m = month as u64;
    let d = day as u64;
    let doy = (153 * (if m > 2 { m - 3 } else { m + 9 }) + 2) / 5 + d - 1; // [0, 365]
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy; // [0, 146096]
    era * 146097 + doe as i64 - 719468
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use base64ct::{Base64, Encoding};
    use ed25519_dalek::{Signer, SigningKey};

    use crate::config::types::*;
    use crate::seal::operations::canonical_signing_payload;
    use crate::seal::types::{Seal, SealsFile};

    use super::*;

    /// Create a test config with one gate and one team member using real Ed25519 keys.
    fn make_test_setup() -> (AttestItConfig, Seal, SigningKey) {
        let signing_key = SigningKey::from_bytes(&[42u8; 32]);
        let verifying_key = signing_key.verifying_key();
        let public_key_b64 = Base64::encode_string(verifying_key.as_bytes());

        let mut team = HashMap::new();
        team.insert(
            "alice".to_string(),
            TeamMember {
                name: "Alice".to_string(),
                email: None,
                github: None,
                public_key: public_key_b64,
                public_key_algorithm: None,
            },
        );

        let mut gates = HashMap::new();
        gates.insert(
            "login-gate".to_string(),
            GateConfig {
                name: "Login Gate".to_string(),
                description: "Login flow".to_string(),
                authorized_signers: vec!["alice".to_string()],
                fingerprint: FingerprintConfig {
                    paths: vec!["src/**".to_string()],
                    exclude: vec![],
                },
                max_age: "30d".to_string(),
            },
        );

        let config = AttestItConfig {
            version: 1,
            min_version: None,
            settings: AttestItSettings::default(),
            team,
            gates,
            suites: HashMap::new(),
            groups: HashMap::new(),
        };

        // Create a properly signed seal
        let gate_id = "login-gate";
        let fingerprint = "sha256:abc123";
        let timestamp = "2024-06-01T08:00:00.000Z";
        let canonical = canonical_signing_payload(gate_id, fingerprint, timestamp);
        let signature: ed25519_dalek::Signature = signing_key.sign(canonical.as_bytes());

        let seal = Seal {
            gate_id: gate_id.to_string(),
            fingerprint: fingerprint.to_string(),
            timestamp: timestamp.to_string(),
            sealed_by: "alice".to_string(),
            signature: Base64::encode_string(&signature.to_bytes()),
        };

        (config, seal, signing_key)
    }

    fn make_seals_file(seal: Seal) -> SealsFile {
        let gate_id = seal.gate_id.clone();
        let mut seals = HashMap::new();
        seals.insert(gate_id, seal);
        SealsFile { version: 1, seals }
    }

    // Timestamp for 2024-06-15 (14 days after seal creation on 2024-06-01)
    const NOW_14_DAYS_LATER: i64 = 1718409600000;
    // Timestamp for 2024-08-01 (61 days after seal creation — past 30d maxAge)
    const NOW_61_DAYS_LATER: i64 = 1722470400000;

    #[test]
    fn verify_valid_seal() {
        let (config, seal, _) = make_test_setup();
        let seals = make_seals_file(seal);
        let result = verify_gate_seal(
            &config,
            "login-gate",
            &seals,
            "sha256:abc123",
            NOW_14_DAYS_LATER,
        );
        assert_eq!(result.state, VerificationState::Valid);
        assert!(result.seal.is_some());
        assert!(result.message.is_none());
    }

    #[test]
    fn verify_missing_gate() {
        let (config, seal, _) = make_test_setup();
        let seals = make_seals_file(seal);
        let result = verify_gate_seal(
            &config,
            "nonexistent-gate",
            &seals,
            "sha256:abc123",
            NOW_14_DAYS_LATER,
        );
        assert_eq!(result.state, VerificationState::Missing);
        assert!(result.message.unwrap().contains("not found"));
    }

    #[test]
    fn verify_missing_seal() {
        let (config, _seal, _) = make_test_setup();
        let seals = SealsFile::default(); // empty
        let result = verify_gate_seal(
            &config,
            "login-gate",
            &seals,
            "sha256:abc123",
            NOW_14_DAYS_LATER,
        );
        assert_eq!(result.state, VerificationState::Missing);
        assert!(result.message.unwrap().contains("No seal found"));
    }

    #[test]
    fn verify_fingerprint_mismatch() {
        let (config, seal, _) = make_test_setup();
        let seals = make_seals_file(seal);
        let result = verify_gate_seal(
            &config,
            "login-gate",
            &seals,
            "sha256:different",
            NOW_14_DAYS_LATER,
        );
        assert_eq!(result.state, VerificationState::FingerprintMismatch);
        assert!(result.message.unwrap().contains("Fingerprint changed"));
    }

    #[test]
    fn verify_unknown_signer_not_in_team() {
        let (config, mut seal, signing_key) = make_test_setup();
        // Change sealedBy to someone not in team
        seal.sealed_by = "charlie".to_string();
        // Re-sign with same key (signature is valid but signer is unknown)
        let canonical =
            canonical_signing_payload(&seal.gate_id, &seal.fingerprint, &seal.timestamp);
        let sig: ed25519_dalek::Signature = signing_key.sign(canonical.as_bytes());
        seal.signature = Base64::encode_string(&sig.to_bytes());

        let seals = make_seals_file(seal);
        let result = verify_gate_seal(
            &config,
            "login-gate",
            &seals,
            "sha256:abc123",
            NOW_14_DAYS_LATER,
        );
        assert_eq!(result.state, VerificationState::UnknownSigner);
    }

    #[test]
    fn verify_unknown_signer_not_authorized_for_gate() {
        let (mut config, seal, _) = make_test_setup();
        // Remove alice from authorized signers
        config
            .gates
            .get_mut("login-gate")
            .unwrap()
            .authorized_signers
            .clear();

        let seals = make_seals_file(seal);
        let result = verify_gate_seal(
            &config,
            "login-gate",
            &seals,
            "sha256:abc123",
            NOW_14_DAYS_LATER,
        );
        assert_eq!(result.state, VerificationState::UnknownSigner);
        assert!(result.message.unwrap().contains("not authorized"));
    }

    #[test]
    fn verify_invalid_signature() {
        let (config, mut seal, _) = make_test_setup();
        // Corrupt the signature
        seal.signature = Base64::encode_string(&[0u8; 64]);
        let seals = make_seals_file(seal);
        let result = verify_gate_seal(
            &config,
            "login-gate",
            &seals,
            "sha256:abc123",
            NOW_14_DAYS_LATER,
        );
        assert_eq!(result.state, VerificationState::InvalidSignature);
    }

    #[test]
    fn verify_stale_seal() {
        let (config, seal, _) = make_test_setup();
        let seals = make_seals_file(seal);
        // 61 days later → exceeds 30d maxAge
        let result = verify_gate_seal(
            &config,
            "login-gate",
            &seals,
            "sha256:abc123",
            NOW_61_DAYS_LATER,
        );
        assert_eq!(result.state, VerificationState::Stale);
        assert!(result.message.unwrap().contains("exceeds maxAge"));
    }

    #[test]
    fn verify_stale_invalid_max_age_fails_closed() {
        let (mut config, seal, _) = make_test_setup();
        config.gates.get_mut("login-gate").unwrap().max_age = "not-a-duration".to_string();
        let seals = make_seals_file(seal);
        let result = verify_gate_seal(
            &config,
            "login-gate",
            &seals,
            "sha256:abc123",
            NOW_14_DAYS_LATER,
        );
        assert_eq!(result.state, VerificationState::Stale);
        assert!(result.message.unwrap().contains("invalid maxAge format"));
    }

    #[test]
    fn verify_all_seals_returns_per_gate_results() {
        let (config, seal, _) = make_test_setup();
        let seals = make_seals_file(seal);
        let mut fingerprints = HashMap::new();
        fingerprints.insert("login-gate".to_string(), "sha256:abc123".to_string());

        let results = verify_all_seals(&config, &seals, &fingerprints, NOW_14_DAYS_LATER);
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].state, VerificationState::Valid);
    }

    #[test]
    fn verify_all_seals_missing_fingerprint() {
        let (config, seal, _) = make_test_setup();
        let seals = make_seals_file(seal);
        let fingerprints = HashMap::new(); // no fingerprints

        let results = verify_all_seals(&config, &seals, &fingerprints, NOW_14_DAYS_LATER);
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].state, VerificationState::Missing);
        assert!(
            results[0]
                .message
                .as_ref()
                .unwrap()
                .contains("No fingerprint computed")
        );
    }

    // -----------------------------------------------------------------------
    // ISO 8601 parser tests
    // -----------------------------------------------------------------------

    #[test]
    fn parse_iso8601_basic() {
        let ms = parse_iso8601_ms("2024-06-01T08:00:00.000Z").unwrap();
        // 2024-06-01 08:00:00 UTC
        assert_eq!(ms, 1717228800000);
    }

    #[test]
    fn parse_iso8601_no_millis() {
        let ms = parse_iso8601_ms("2024-06-01T08:00:00Z").unwrap();
        assert_eq!(ms, 1717228800000);
    }

    #[test]
    fn parse_iso8601_unix_epoch() {
        let ms = parse_iso8601_ms("1970-01-01T00:00:00.000Z").unwrap();
        assert_eq!(ms, 0);
    }

    #[test]
    fn parse_iso8601_with_millis() {
        let ms = parse_iso8601_ms("2024-06-01T08:00:00.500Z").unwrap();
        assert_eq!(ms, 1717228800500);
    }

    #[test]
    fn parse_iso8601_invalid_returns_none() {
        assert!(parse_iso8601_ms("not-a-date").is_none());
        assert!(parse_iso8601_ms("2024-13-01T00:00:00Z").is_none()); // month 13
        assert!(parse_iso8601_ms("2024-06-01").is_none()); // no time
    }

    // -----------------------------------------------------------------------
    // days_from_civil tests
    // -----------------------------------------------------------------------

    #[test]
    fn days_from_civil_unix_epoch() {
        assert_eq!(days_from_civil(1970, 1, 1), 0);
    }

    #[test]
    fn days_from_civil_known_date() {
        // 2024-06-01 is day 19875 (verified against external source)
        assert_eq!(days_from_civil(2024, 6, 1), 19875);
    }
}
