//! Fingerprint computation algorithm.
//!
//! Delegates glob resolution and file I/O to the [`HostPlatform`] trait,
//! keeping this module platform-agnostic.

use std::path::Path;

use sha2::{Digest, Sha256};

use crate::errors::AttestError;
use crate::host::HostPlatform;
use crate::types::ResolvedFile;

use super::types::{FingerprintOptions, FingerprintResult};

/// Compute a deterministic content fingerprint for a set of files.
///
/// # Algorithm
///
/// 1. Resolve glob patterns via [`HostPlatform::resolve_globs`] → sorted file list
/// 2. For each file: `SHA256(relativePath + ":" + fileContent)` → per-file hash
/// 3. Sort per-file hashes by relative path
/// 4. Concatenate all hashes (raw bytes)
/// 5. `SHA256(concatenation)` → `"sha256:<hex>"`
///
/// # Errors
///
/// Returns [`AttestError`] if glob resolution or file reading fails.
pub async fn compute_fingerprint(
    options: &FingerprintOptions,
    host: &dyn HostPlatform,
) -> Result<FingerprintResult, AttestError> {
    let base_dir = options.base_dir.as_deref().unwrap_or(".");
    let base_path = Path::new(base_dir);

    // Step 1: resolve globs → sorted file list
    let mut resolved_files = host
        .resolve_globs(&options.paths, &options.ignore, base_path)
        .await?;

    // Sort by relative path (locale-independent byte comparison, matching TS)
    resolved_files.sort_by(|a, b| a.relative_path.cmp(&b.relative_path));

    // Step 2 & 3: compute per-file hashes
    let mut file_hashes: Vec<FileHash> = Vec::with_capacity(resolved_files.len());
    let file_names: Vec<String> = resolved_files
        .iter()
        .map(|f| f.relative_path.clone())
        .collect();

    for file in &resolved_files {
        let hash = hash_file(host, file).await?;
        file_hashes.push(FileHash {
            relative_path: file.relative_path.clone(),
            hash,
        });
    }

    // Step 4: sort by relative path (already sorted, but explicit for clarity)
    file_hashes.sort_by(|a, b| a.relative_path.cmp(&b.relative_path));

    // Step 5: concatenate all hashes and compute final SHA-256
    let fingerprint = compute_final_fingerprint(&file_hashes);

    Ok(FingerprintResult {
        fingerprint,
        files: file_names,
        file_count: file_hashes.len(),
    })
}

/// A per-file hash used during fingerprint computation.
struct FileHash {
    relative_path: String,
    hash: [u8; 32],
}

/// Hash a single file: `SHA256(normalizedRelativePath + ":" + content)`.
///
/// Path separators are normalized to forward slashes (matching the TS implementation).
async fn hash_file(host: &dyn HostPlatform, file: &ResolvedFile) -> Result<[u8; 32], AttestError> {
    let content = host.read_file(&file.absolute_path).await?;
    let normalized_path = normalize_path(&file.relative_path);

    let mut hasher = Sha256::new();
    hasher.update(normalized_path.as_bytes());
    hasher.update(b":");
    hasher.update(&content);

    Ok(hasher.finalize().into())
}

/// Normalize path separators to forward slashes.
fn normalize_path(path: &str) -> String {
    path.replace('\\', "/")
}

/// Concatenate per-file hashes and compute the final SHA-256 fingerprint.
fn compute_final_fingerprint(file_hashes: &[FileHash]) -> String {
    let mut hasher = Sha256::new();
    for fh in file_hashes {
        hasher.update(fh.hash);
    }
    let final_hash = hasher.finalize();
    format!("sha256:{}", hex_encode(&final_hash))
}

/// Encode bytes as lowercase hex (avoids pulling in a hex crate).
fn hex_encode(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_path_forward_slashes_unchanged() {
        assert_eq!(normalize_path("src/main.rs"), "src/main.rs");
    }

    #[test]
    fn normalize_path_backslashes_converted() {
        assert_eq!(normalize_path("src\\main.rs"), "src/main.rs");
    }

    #[test]
    fn normalize_path_mixed_slashes() {
        assert_eq!(normalize_path("src\\foo/bar\\baz.rs"), "src/foo/bar/baz.rs");
    }

    #[test]
    fn hex_encode_empty() {
        assert_eq!(hex_encode(&[]), "");
    }

    #[test]
    fn hex_encode_known_values() {
        assert_eq!(hex_encode(&[0x00, 0xff, 0xab, 0x12]), "00ffab12");
    }

    #[test]
    fn compute_final_fingerprint_empty_produces_sha256_of_nothing() {
        let result = compute_final_fingerprint(&[]);
        // SHA256 of empty input
        assert!(result.starts_with("sha256:"));
        assert_eq!(
            result,
            "sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
    }

    #[test]
    fn compute_final_fingerprint_deterministic() {
        let hashes = vec![
            FileHash {
                relative_path: "a.txt".to_string(),
                hash: Sha256::digest(b"a.txt:hello").into(),
            },
            FileHash {
                relative_path: "b.txt".to_string(),
                hash: Sha256::digest(b"b.txt:world").into(),
            },
        ];
        let r1 = compute_final_fingerprint(&hashes);
        let r2 = compute_final_fingerprint(&hashes);
        assert_eq!(r1, r2);
        assert!(r1.starts_with("sha256:"));
    }

    #[test]
    fn compute_final_fingerprint_order_matters() {
        let hash_a = FileHash {
            relative_path: "a.txt".to_string(),
            hash: Sha256::digest(b"a.txt:hello").into(),
        };
        let hash_b = FileHash {
            relative_path: "b.txt".to_string(),
            hash: Sha256::digest(b"b.txt:world").into(),
        };
        let forward = compute_final_fingerprint(&[
            FileHash {
                relative_path: hash_a.relative_path.clone(),
                hash: hash_a.hash,
            },
            FileHash {
                relative_path: hash_b.relative_path.clone(),
                hash: hash_b.hash,
            },
        ]);
        let reversed = compute_final_fingerprint(&[
            FileHash {
                relative_path: hash_b.relative_path.clone(),
                hash: hash_b.hash,
            },
            FileHash {
                relative_path: hash_a.relative_path.clone(),
                hash: hash_a.hash,
            },
        ]);
        assert_ne!(forward, reversed);
    }
}
