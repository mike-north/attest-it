//! Content fingerprint computation.
//!
//! A fingerprint is a SHA-256 hash over sorted file contents, producing a
//! deterministic identifier for a set of files. The algorithm:
//!
//! 1. Resolve glob patterns → sorted file list
//! 2. For each file: `SHA256(relativePath + ":" + content)` → per-file hash
//! 3. Concatenate all per-file hashes (sorted by relative path)
//! 4. `SHA256(concatenation)` → final fingerprint as `"sha256:<hex>"`

pub mod compute;
pub mod types;

pub use compute::compute_fingerprint;
pub use types::{FingerprintOptions, FingerprintResult};
