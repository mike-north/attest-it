//! Shared domain types for attest-it.

use std::path::PathBuf;

use serde::{Deserialize, Serialize};

/// Target platform for the host environment.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Platform {
    /// macOS — serializes as `"darwin"`.
    Darwin,
    /// Linux — serializes as `"linux"`.
    Linux,
    /// Windows — serializes as `"win32"` (matching Node.js `process.platform`).
    Win32,
}

impl std::fmt::Display for Platform {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Darwin => write!(f, "darwin"),
            Self::Linux => write!(f, "linux"),
            Self::Win32 => write!(f, "win32"),
        }
    }
}

/// Result of an Ed25519 signing operation (returned by the host).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SignResult {
    /// Base64-encoded Ed25519 signature.
    pub signature: String,
    /// The algorithm used (always "ed25519").
    pub algorithm: String,
}

/// A file resolved by glob expansion, with its content.
#[derive(Debug, Clone)]
pub struct ResolvedFile {
    /// Relative path from the base directory (forward-slash separated).
    pub relative_path: String,
    /// Absolute path on the host filesystem.
    pub absolute_path: PathBuf,
}
