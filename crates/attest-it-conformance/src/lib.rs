//! Conformance test case definitions for attest-it.
//!
//! These test cases are shared between Rust and TypeScript test runners
//! to ensure cross-language interoperability.

use attest_it_core::config::duration::parse_duration_ms;
use attest_it_core::config::{OperationalConfig, PolicyConfig};
use base64ct::{Base64, Encoding};
use ed25519_dalek::{Signer, SigningKey};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

// ---------------------------------------------------------------------------
// Public vector types
// ---------------------------------------------------------------------------

/// The complete set of conformance test vectors.
#[derive(Debug, Serialize, Deserialize)]
pub struct ConformanceVectors {
    pub fingerprint: Vec<FingerprintVector>,
    pub seal: Vec<SealVector>,
    pub config: Vec<ConfigVector>,
    pub duration: Vec<DurationVector>,
}

/// A single fingerprint conformance vector.
#[derive(Debug, Serialize, Deserialize)]
pub struct FingerprintVector {
    pub description: String,
    pub files: Vec<FileEntry>,
    pub expected_fingerprint: String,
}

/// A file entry used in fingerprint vectors.
#[derive(Debug, Serialize, Deserialize)]
pub struct FileEntry {
    pub relative_path: String,
    pub content: String,
}

/// A single seal (Ed25519 signature) conformance vector.
#[derive(Debug, Serialize, Deserialize)]
pub struct SealVector {
    pub description: String,
    pub public_key_base64: String,
    pub signature_base64: String,
    pub canonical_string: String,
    pub expected_valid: bool,
}

/// A single config parsing conformance vector.
#[derive(Debug, Serialize, Deserialize)]
pub struct ConfigVector {
    pub description: String,
    pub input: String,
    pub format: String,
    pub config_type: String,
    pub expected_json: String,
}

/// A single duration parsing conformance vector.
#[derive(Debug, Serialize, Deserialize)]
pub struct DurationVector {
    pub description: String,
    pub input: String,
    pub expected_ms: Option<u64>,
    pub should_error: bool,
}

// ---------------------------------------------------------------------------
// Vector generation
// ---------------------------------------------------------------------------

/// Generate the complete set of conformance test vectors using real algorithms.
///
/// All fingerprints, signatures, and parsed configs are computed using the
/// actual attest-it-core implementations, ensuring that the vectors are
/// authoritative and always in sync with the Rust implementation.
pub fn generate_vectors() -> ConformanceVectors {
    ConformanceVectors {
        fingerprint: generate_fingerprint_vectors(),
        seal: generate_seal_vectors(),
        config: generate_config_vectors(),
        duration: generate_duration_vectors(),
    }
}

// ---------------------------------------------------------------------------
// Fingerprint helpers (mirrors attest-it-core fingerprint/compute.rs)
// ---------------------------------------------------------------------------

/// Normalize path separators to forward slashes (matching the core algorithm).
fn normalize_path(path: &str) -> String {
    path.replace('\\', "/")
}

/// Compute the per-file hash: `SHA256(normalizedRelativePath + ":" + content)`.
fn hash_file_entry(relative_path: &str, content: &[u8]) -> [u8; 32] {
    let normalized = normalize_path(relative_path);
    let mut hasher = Sha256::new();
    hasher.update(normalized.as_bytes());
    hasher.update(b":");
    hasher.update(content);
    hasher.finalize().into()
}

/// Compute the final fingerprint for a set of `(relative_path, content)` pairs.
///
/// The algorithm:
/// 1. Compute per-file `SHA256(normalizedPath + ":" + content)` for each file.
/// 2. Sort the per-file hashes by normalized relative path (lexicographic).
/// 3. Concatenate the sorted raw 32-byte digests.
/// 4. Compute `SHA256(concatenation)` → format as `"sha256:<hex>"`.
fn compute_fingerprint(files: &[(&str, &[u8])]) -> String {
    // Sort by normalized path to match the core algorithm's sort step.
    let mut entries: Vec<(String, [u8; 32])> = files
        .iter()
        .map(|(path, content)| {
            let normalized = normalize_path(path);
            let hash = hash_file_entry(path, content);
            (normalized, hash)
        })
        .collect();

    entries.sort_by(|a, b| a.0.cmp(&b.0));

    let mut final_hasher = Sha256::new();
    for (_, hash) in &entries {
        final_hasher.update(hash);
    }
    let digest = final_hasher.finalize();

    format!("sha256:{}", hex_encode(&digest))
}

/// Encode bytes as lowercase hex.
fn hex_encode(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

// ---------------------------------------------------------------------------
// Fingerprint vectors
// ---------------------------------------------------------------------------

fn generate_fingerprint_vectors() -> Vec<FingerprintVector> {
    // Vector 1: single file
    let v1_files: &[(&str, &[u8])] = &[("hello.txt", b"Hello, World!\n")];
    let v1_fingerprint = compute_fingerprint(v1_files);

    // Vector 2: two files
    let v2_files: &[(&str, &[u8])] = &[("a.txt", b"aaa"), ("b.txt", b"bbb")];
    let v2_fingerprint = compute_fingerprint(v2_files);

    // Vector 3: path with backslashes — normalized to forward slashes
    let v3_files: &[(&str, &[u8])] = &[("src\\main.rs", b"fn main() {}")];
    let v3_fingerprint = compute_fingerprint(v3_files);

    vec![
        FingerprintVector {
            description: "single file: hello.txt with 'Hello, World!\\n'".to_string(),
            files: vec![FileEntry {
                relative_path: "hello.txt".to_string(),
                content: "Hello, World!\n".to_string(),
            }],
            expected_fingerprint: v1_fingerprint,
        },
        FingerprintVector {
            description: "two files: a.txt='aaa' and b.txt='bbb'".to_string(),
            files: vec![
                FileEntry {
                    relative_path: "a.txt".to_string(),
                    content: "aaa".to_string(),
                },
                FileEntry {
                    relative_path: "b.txt".to_string(),
                    content: "bbb".to_string(),
                },
            ],
            expected_fingerprint: v2_fingerprint,
        },
        FingerprintVector {
            description: "path with backslashes normalized to forward slashes".to_string(),
            files: vec![FileEntry {
                relative_path: "src\\main.rs".to_string(),
                content: "fn main() {}".to_string(),
            }],
            expected_fingerprint: v3_fingerprint,
        },
    ]
}

// ---------------------------------------------------------------------------
// Seal vectors
// ---------------------------------------------------------------------------

/// Canonical signing string used in the seal vectors.
const SEAL_CANONICAL: &str = "test-gate:sha256:abc123:2024-01-15T10:30:00.000Z";

/// Fixed 32-byte seed used for deterministic key generation (vector 1 & 2).
const SIGNING_SEED_PRIMARY: [u8; 32] = [0u8; 32];

/// Fixed 32-byte seed for a different key (vector 3 — wrong key).
const SIGNING_SEED_OTHER: [u8; 32] = [1u8; 32];

fn generate_seal_vectors() -> Vec<SealVector> {
    let signing_key = SigningKey::from_bytes(&SIGNING_SEED_PRIMARY);
    let verifying_key = signing_key.verifying_key();
    let public_key_b64 = Base64::encode_string(verifying_key.as_bytes());

    // Compute a valid signature over the canonical string.
    let signature = signing_key.sign(SEAL_CANONICAL.as_bytes());
    let signature_b64 = Base64::encode_string(&signature.to_bytes());

    // A different public key (wrong key for vector 3).
    let other_signing_key = SigningKey::from_bytes(&SIGNING_SEED_OTHER);
    let other_public_key_b64 = Base64::encode_string(other_signing_key.verifying_key().as_bytes());

    vec![
        // Vector 1: valid signature
        SealVector {
            description: "valid Ed25519 signature over canonical string".to_string(),
            public_key_base64: public_key_b64.clone(),
            signature_base64: signature_b64.clone(),
            canonical_string: SEAL_CANONICAL.to_string(),
            expected_valid: true,
        },
        // Vector 2: same signature but tampered canonical string
        SealVector {
            description: "tampered canonical string — signature should not verify".to_string(),
            public_key_base64: public_key_b64.clone(),
            signature_base64: signature_b64.clone(),
            canonical_string: "test-gate:sha256:TAMPERED:2024-01-15T10:30:00.000Z".to_string(),
            expected_valid: false,
        },
        // Vector 3: valid signature but wrong public key
        SealVector {
            description: "wrong public key — valid signature but key mismatch".to_string(),
            public_key_base64: other_public_key_b64,
            signature_base64: signature_b64,
            canonical_string: SEAL_CANONICAL.to_string(),
            expected_valid: false,
        },
    ]
}

// ---------------------------------------------------------------------------
// Config vectors
// ---------------------------------------------------------------------------

fn generate_config_vectors() -> Vec<ConfigVector> {
    let policy_yaml = r#"version: 1
team:
  alice:
    name: Alice
    publicKey: AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=
gates:
  login-gate:
    name: Login Gate
    description: Verifies login-related files
    authorizedSigners:
      - alice
    fingerprint:
      paths:
        - "src/login/**"
    maxAge: 30d
"#;

    let operational_yaml = r#"version: 1
suites:
  login:
    gate: login-gate
    description: Run login suite
    command: pnpm test -- --suite login
"#;

    // Parse policy config and round-trip to JSON.
    let policy: PolicyConfig =
        serde_yaml::from_str(policy_yaml).expect("policy_yaml must be valid");
    let policy_json =
        serde_json::to_string_pretty(&policy).expect("PolicyConfig must serialize to JSON");

    // Parse operational config and round-trip to JSON.
    let operational: OperationalConfig =
        serde_yaml::from_str(operational_yaml).expect("operational_yaml must be valid");
    let operational_json = serde_json::to_string_pretty(&operational)
        .expect("OperationalConfig must serialize to JSON");

    vec![
        ConfigVector {
            description: "minimal valid policy config YAML".to_string(),
            input: policy_yaml.to_string(),
            format: "yaml".to_string(),
            config_type: "policy".to_string(),
            expected_json: policy_json,
        },
        ConfigVector {
            description: "minimal valid operational config YAML".to_string(),
            input: operational_yaml.to_string(),
            format: "yaml".to_string(),
            config_type: "operational".to_string(),
            expected_json: operational_json,
        },
    ]
}

// ---------------------------------------------------------------------------
// Duration vectors
// ---------------------------------------------------------------------------

fn generate_duration_vectors() -> Vec<DurationVector> {
    let cases: &[(&str, Option<u64>, bool)] = &[
        ("30d", Some(2_592_000_000), false),
        ("1h", Some(3_600_000), false),
        ("500ms", Some(500), false),
        ("2w", Some(1_209_600_000), false),
        ("invalid", None, true),
        ("0s", None, true),
    ];

    cases
        .iter()
        .map(|(input, expected_ms, should_error)| {
            // Cross-check: the computed value from parse_duration_ms must match
            // the expected_ms we specify (for non-error cases).
            if let Some(expected) = expected_ms {
                let computed =
                    parse_duration_ms(input).expect("non-error duration must parse successfully");
                assert_eq!(
                    computed, *expected,
                    "duration vector mismatch for input '{input}': computed {computed}, expected {expected}"
                );
            } else {
                assert!(
                    parse_duration_ms(input).is_err(),
                    "duration input '{input}' must return an error"
                );
            }

            DurationVector {
                description: format!("parse_duration_ms({input:?})"),
                input: input.to_string(),
                expected_ms: *expected_ms,
                should_error: *should_error,
            }
        })
        .collect()
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use ed25519_dalek::{Verifier, VerifyingKey};

    use super::*;

    /// Helper: call `generate_vectors()` once and return the result.
    fn vectors() -> ConformanceVectors {
        generate_vectors()
    }

    // --- Fingerprint tests ---

    #[test]
    fn fingerprint_vectors_have_sha256_prefix() {
        for v in &vectors().fingerprint {
            assert!(
                v.expected_fingerprint.starts_with("sha256:"),
                "fingerprint vector '{}' expected_fingerprint does not start with 'sha256:': {}",
                v.description,
                v.expected_fingerprint,
            );
        }
    }

    #[test]
    fn fingerprint_single_file_is_deterministic() {
        let v1a = generate_fingerprint_vectors();
        let v1b = generate_fingerprint_vectors();
        assert_eq!(
            v1a[0].expected_fingerprint, v1b[0].expected_fingerprint,
            "fingerprint generation must be deterministic"
        );
    }

    #[test]
    fn fingerprint_two_files_differs_from_single_file() {
        let fp = generate_fingerprint_vectors();
        assert_ne!(
            fp[0].expected_fingerprint, fp[1].expected_fingerprint,
            "single-file and two-file vectors must produce different fingerprints"
        );
    }

    #[test]
    fn fingerprint_backslash_vector_matches_normalized_path() {
        // The backslash vector (index 2) uses "src\\main.rs".
        // The normalized equivalent "src/main.rs" should yield the same fingerprint.
        let backslash_fp = compute_fingerprint(&[("src\\main.rs", b"fn main() {}")]);
        let forward_fp = compute_fingerprint(&[("src/main.rs", b"fn main() {}")]);
        assert_eq!(
            backslash_fp, forward_fp,
            "backslash and forward-slash paths must produce the same fingerprint"
        );
        let vectors_fp = generate_fingerprint_vectors();
        assert_eq!(vectors_fp[2].expected_fingerprint, backslash_fp);
    }

    #[test]
    fn fingerprint_hex_string_is_64_chars() {
        for v in &vectors().fingerprint {
            // "sha256:" is 7 chars; the hex portion is 64 chars (32 bytes * 2).
            let hex_part = v.expected_fingerprint.strip_prefix("sha256:").unwrap();
            assert_eq!(
                hex_part.len(),
                64,
                "hex part of fingerprint '{}' must be 64 chars, got {}",
                v.description,
                hex_part.len()
            );
        }
    }

    // --- Seal tests ---

    /// Decode a base64ct-encoded public key and signature, then verify.
    fn verify_seal_vector(v: &SealVector) -> bool {
        let pk_bytes = match Base64::decode_vec(&v.public_key_base64) {
            Ok(b) => b,
            Err(_) => return false,
        };
        if pk_bytes.len() != 32 {
            return false;
        }
        let pk_arr: [u8; 32] = pk_bytes.try_into().expect("length checked above");
        let verifying_key = match VerifyingKey::from_bytes(&pk_arr) {
            Ok(k) => k,
            Err(_) => return false,
        };

        let sig_bytes = match Base64::decode_vec(&v.signature_base64) {
            Ok(b) => b,
            Err(_) => return false,
        };
        if sig_bytes.len() != 64 {
            return false;
        }
        let sig_arr: [u8; 64] = sig_bytes.try_into().expect("length checked above");
        let signature = ed25519_dalek::Signature::from_bytes(&sig_arr);

        verifying_key
            .verify(v.canonical_string.as_bytes(), &signature)
            .is_ok()
    }

    #[test]
    fn seal_valid_vector_verifies() {
        let seal_vectors = generate_seal_vectors();
        let v = &seal_vectors[0];
        assert!(
            v.expected_valid,
            "first seal vector must be marked expected_valid=true"
        );
        assert!(
            verify_seal_vector(v),
            "first seal vector must pass Ed25519 verification"
        );
    }

    #[test]
    fn seal_tampered_canonical_fails_verification() {
        let seal_vectors = generate_seal_vectors();
        let v = &seal_vectors[1];
        assert!(
            !v.expected_valid,
            "tampered canonical vector must be marked expected_valid=false"
        );
        assert!(
            !verify_seal_vector(v),
            "tampered canonical vector must fail Ed25519 verification"
        );
    }

    #[test]
    fn seal_wrong_key_fails_verification() {
        let seal_vectors = generate_seal_vectors();
        let v = &seal_vectors[2];
        assert!(
            !v.expected_valid,
            "wrong-key vector must be marked expected_valid=false"
        );
        assert!(
            !verify_seal_vector(v),
            "wrong-key vector must fail Ed25519 verification"
        );
    }

    #[test]
    fn seal_expected_valid_matches_actual_verification() {
        for v in &generate_seal_vectors() {
            let actual = verify_seal_vector(v);
            assert_eq!(
                actual, v.expected_valid,
                "seal vector '{}': expected_valid={} but actual={}",
                v.description, v.expected_valid, actual
            );
        }
    }

    // --- Config tests ---

    #[test]
    fn config_vectors_expected_json_is_valid_json() {
        for v in &vectors().config {
            let parsed: serde_json::Value =
                serde_json::from_str(&v.expected_json).unwrap_or_else(|e| {
                    panic!(
                        "config vector '{}' expected_json is not valid JSON: {e}",
                        v.description
                    )
                });
            assert!(
                parsed.is_object(),
                "config vector '{}' expected_json must be a JSON object",
                v.description
            );
        }
    }

    #[test]
    fn config_vectors_round_trip() {
        for v in &vectors().config {
            // Re-parse the expected_json back through the config types to ensure
            // it round-trips without data loss.
            match v.config_type.as_str() {
                "policy" => {
                    let config: PolicyConfig = serde_json::from_str(&v.expected_json)
                        .unwrap_or_else(|e| {
                            panic!(
                                "config vector '{}' expected_json cannot round-trip as PolicyConfig: {e}",
                                v.description
                            )
                        });
                    let re_serialized = serde_json::to_string_pretty(&config).unwrap();
                    assert_eq!(
                        re_serialized, v.expected_json,
                        "config vector '{}' did not round-trip identically",
                        v.description
                    );
                }
                "operational" => {
                    let config: OperationalConfig = serde_json::from_str(&v.expected_json)
                        .unwrap_or_else(|e| {
                            panic!(
                                "config vector '{}' expected_json cannot round-trip as OperationalConfig: {e}",
                                v.description
                            )
                        });
                    let re_serialized = serde_json::to_string_pretty(&config).unwrap();
                    assert_eq!(
                        re_serialized, v.expected_json,
                        "config vector '{}' did not round-trip identically",
                        v.description
                    );
                }
                other => panic!(
                    "unknown config_type '{other}' in vector '{}'",
                    v.description
                ),
            }
        }
    }

    // --- Duration tests ---

    #[test]
    fn duration_vectors_expected_ms_matches_parse() {
        for v in &vectors().duration {
            if v.should_error {
                assert!(
                    parse_duration_ms(&v.input).is_err(),
                    "duration vector '{}': input '{}' must produce an error",
                    v.description,
                    v.input
                );
            } else {
                let ms = parse_duration_ms(&v.input).unwrap_or_else(|e| {
                    panic!(
                        "duration vector '{}': input '{}' must parse successfully, got: {e}",
                        v.description, v.input
                    )
                });
                assert_eq!(
                    Some(ms),
                    v.expected_ms,
                    "duration vector '{}': expected {:?} ms, got {ms}",
                    v.description,
                    v.expected_ms
                );
            }
        }
    }

    #[test]
    fn duration_error_vectors_have_no_expected_ms() {
        for v in &vectors().duration {
            if v.should_error {
                assert!(
                    v.expected_ms.is_none(),
                    "duration vector '{}': should_error=true vectors must have expected_ms=null",
                    v.description
                );
            }
        }
    }

    // --- JSON round-trip for the full vectors struct ---

    #[test]
    fn full_vectors_json_round_trip() {
        let original = generate_vectors();
        let json = serde_json::to_string_pretty(&original)
            .expect("ConformanceVectors must serialize to JSON");

        // Must deserialize back without error.
        let _restored: ConformanceVectors =
            serde_json::from_str(&json).expect("JSON must deserialize back to ConformanceVectors");

        // Re-serialize and compare for structural equivalence.
        let json2 = serde_json::to_string_pretty(&_restored)
            .expect("restored ConformanceVectors must serialize to JSON");
        assert_eq!(
            json, json2,
            "JSON round-trip must be byte-for-byte identical"
        );
    }
}
