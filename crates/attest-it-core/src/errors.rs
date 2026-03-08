//! Error types for attest-it core.

use std::path::PathBuf;

/// All errors that can occur in attest-it core operations.
#[derive(Debug, thiserror::Error)]
pub enum AttestError {
    // --- File I/O ---
    /// A required file does not exist at the expected path.
    #[error("{message}")]
    FileNotFound { message: String, path: PathBuf },

    /// A file exists but could not be read (permissions, encoding, I/O error).
    #[error("{message}")]
    FileRead { message: String, path: PathBuf },

    /// A file could not be written (permissions, disk full, I/O error).
    #[error("{message}")]
    FileWrite { message: String, path: PathBuf },

    // --- Config ---
    /// A configuration file could not be found at any of the expected paths.
    #[error("{message}")]
    ConfigNotFound {
        message: String,
        config_type: ConfigType,
    },

    /// A configuration file exists but contains invalid YAML or JSON.
    #[error("{message}")]
    ConfigParse {
        message: String,
        format: ConfigFormat,
    },

    /// A configuration file parsed successfully but failed post-deserialization
    /// validation (e.g., missing required fields, invalid durations).
    #[error("{message}")]
    ConfigValidation {
        message: String,
        errors: Vec<String>,
    },

    /// Policy and operational configs are individually valid but reference
    /// each other inconsistently (e.g., suite references a nonexistent gate).
    ///
    /// See [`crate::config::validation::validate_cross_config`].
    #[error("{message}")]
    CrossConfigValidation {
        message: String,
        errors: Vec<CrossConfigError>,
    },

    /// The running CLI version does not satisfy the config's `minVersion`.
    #[error("{message}")]
    VersionMismatch {
        message: String,
        required: String,
        current: String,
    },

    // --- Crypto ---
    /// Ed25519 signing failed (VaultKeeper delegation error, key unavailable, etc.).
    #[error("{message}")]
    SigningFailed { message: String },

    /// Ed25519 signature verification failed (corrupted data, wrong key, etc.).
    #[error("{message}")]
    VerificationFailed { message: String },

    /// A public or private key is malformed (invalid base64, wrong length, etc.).
    #[error("{message}")]
    InvalidKey { message: String },

    /// A seal's Ed25519 signature does not match the canonical payload.
    #[error("{message}")]
    InvalidSignature { message: String },

    // --- Seal ---
    /// No seal exists for the specified gate.
    #[error("{message}")]
    SealNotFound {
        message: String,
        /// The gate slug that has no seal.
        gate_id: String,
    },

    /// A seal was created by someone not in the gate's `authorizedSigners`.
    #[error("{message}")]
    UnknownSigner {
        message: String,
        /// The team member slug from the seal's `sealedBy` field.
        signer: String,
        /// The gate slug being verified.
        gate_id: String,
    },

    // --- Fingerprint ---
    /// The current fingerprint does not match the sealed fingerprint.
    #[error("{message}")]
    FingerprintMismatch {
        message: String,
        expected: String,
        actual: String,
    },

    // --- General ---
    /// A duration string (e.g., `"30d"`, `"5m"`) could not be parsed.
    #[error("{message}")]
    InvalidDuration {
        message: String,
        /// The raw input string that failed to parse.
        input: String,
    },

    /// Fallback for errors that don't fit a typed variant.
    ///
    /// Every use of `Other` at call sites should eventually be replaced
    /// with a more specific variant.
    #[error("{0}")]
    Other(String),
}

/// Type of configuration file.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ConfigType {
    /// Policy config (`.attest-it/policy.yaml`) — shared, committed to git.
    Policy,
    /// Operational config (`.attest-it/config.yaml`) — local, per-environment.
    Operational,
    /// Seals file (`.attest-it/seals.json`) — seal storage.
    Seals,
}

impl std::fmt::Display for ConfigType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Policy => write!(f, "policy"),
            Self::Operational => write!(f, "operational"),
            Self::Seals => write!(f, "seals"),
        }
    }
}

/// Format of a configuration file.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ConfigFormat {
    /// YAML format (`.yaml` / `.yml`).
    Yaml,
    /// JSON format (`.json`).
    Json,
}

impl std::fmt::Display for ConfigFormat {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Yaml => write!(f, "yaml"),
            Self::Json => write!(f, "json"),
        }
    }
}

/// A cross-configuration validation error.
///
/// Produced by [`crate::config::validation::validate_cross_config`] when
/// policy and operational configs reference each other inconsistently.
///
/// The `suite`, `gate`, and `signer` fields provide context for the error:
/// - `UnknownGate`: `suite` and `gate` are set; `signer` is `None`
/// - `MissingTeamMember`: `gate` and `signer` are set; `suite` is `None`
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CrossConfigError {
    /// The category of cross-config error.
    #[serde(rename = "type")]
    pub error_type: CrossConfigErrorType,
    /// Suite slug involved (set for `UnknownGate` errors).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub suite: Option<String>,
    /// Gate slug involved.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub gate: Option<String>,
    /// Team member slug involved (set for `MissingTeamMember` errors).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub signer: Option<String>,
    /// Human-readable error description.
    pub message: String,
}

/// Type of cross-config validation error.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum CrossConfigErrorType {
    /// A suite references a gate that does not exist in the policy config.
    UnknownGate,
    /// A gate's `authorizedSigners` references a team member not in the policy.
    MissingTeamMember,
}
