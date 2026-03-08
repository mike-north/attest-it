//! Fingerprint computation types.

use serde::{Deserialize, Serialize};

/// Options for computing a content fingerprint.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FingerprintOptions {
    /// Glob patterns for files to include.
    pub paths: Vec<String>,
    /// Glob patterns for files to exclude.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub ignore: Vec<String>,
    /// Base directory for resolving paths (defaults to project root).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub base_dir: Option<String>,
}

/// Result of a fingerprint computation.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FingerprintResult {
    /// The content fingerprint (format: `"sha256:<hex>"`).
    pub fingerprint: String,
    /// Relative paths of all files included in the fingerprint.
    pub files: Vec<String>,
    /// Number of files included.
    pub file_count: usize,
}
