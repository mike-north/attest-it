//! Configuration data types.
//!
//! attest-it uses a split configuration model:
//! - **Policy config** (`.attest-it/policy.yaml`) — shared, committed to git:
//!   team members, gates, settings like max age and public key paths.
//! - **Operational config** (`.attest-it/config.yaml`) — local/per-environment:
//!   suites with commands, key provider settings, groups.
//!
//! These are merged into [`AttestItConfig`] at runtime.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use crate::serde_helpers::deserialize_version;

// ---------------------------------------------------------------------------
// Merged (runtime) config
// ---------------------------------------------------------------------------

/// Fully merged attest-it configuration (policy + operational).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AttestItConfig {
    /// Schema version (always 1).
    #[serde(deserialize_with = "deserialize_version")]
    pub version: u32,
    /// Minimum attest-it CLI version required (semver, e.g. `"0.8.0"`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub min_version: Option<String>,
    /// Merged settings from policy + operational.
    pub settings: AttestItSettings,
    /// Team members keyed by slug.
    #[serde(default, skip_serializing_if = "HashMap::is_empty")]
    pub team: HashMap<String, TeamMember>,
    /// Gates keyed by slug.
    #[serde(default, skip_serializing_if = "HashMap::is_empty")]
    pub gates: HashMap<String, GateConfig>,
    /// Suites keyed by slug.
    pub suites: HashMap<String, SuiteConfig>,
    /// Named groups of suite slugs.
    #[serde(default, skip_serializing_if = "HashMap::is_empty")]
    pub groups: HashMap<String, Vec<String>>,
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

/// Combined settings from policy and operational configs.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AttestItSettings {
    /// Maximum age of a seal in days before it is considered stale.
    #[serde(default = "default_max_age_days")]
    pub max_age_days: u32,
    /// Path to the Ed25519 public key file.
    #[serde(default = "default_public_key_path")]
    pub public_key_path: String,
    /// Path to the attestations JSON file.
    #[serde(default = "default_attestations_path")]
    pub attestations_path: String,
    /// Path to the seals file.
    #[serde(default = "default_seals_path")]
    pub seals_path: String,
    /// Default command to run for suites that don't specify one.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default_command: Option<String>,
    /// Key provider configuration.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub key_provider: Option<KeyProviderSettings>,
}

impl Default for AttestItSettings {
    fn default() -> Self {
        Self {
            max_age_days: default_max_age_days(),
            public_key_path: default_public_key_path(),
            attestations_path: default_attestations_path(),
            seals_path: default_seals_path(),
            default_command: None,
            key_provider: None,
        }
    }
}

fn default_max_age_days() -> u32 {
    30
}
fn default_public_key_path() -> String {
    ".attest-it/pubkey.pem".to_owned()
}
fn default_attestations_path() -> String {
    ".attest-it/attestations.json".to_owned()
}
fn default_seals_path() -> String {
    ".attest-it/seals.json".to_owned()
}

// ---------------------------------------------------------------------------
// Key provider
// ---------------------------------------------------------------------------

/// Configuration for the key management provider.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KeyProviderSettings {
    /// Provider type identifier (e.g. `"filesystem"`, `"1password"`).
    #[serde(rename = "type")]
    pub provider_type: String,
    /// Provider-specific options.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub options: Option<KeyProviderOptions>,
}

/// Provider-specific key provider options.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KeyProviderOptions {
    /// Path to the private key file (filesystem provider).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub private_key_path: Option<String>,
    /// 1Password vault name.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub vault: Option<String>,
    /// 1Password item name.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub item_name: Option<String>,
    /// macOS Keychain account name.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub account: Option<String>,
}

// ---------------------------------------------------------------------------
// Team
// ---------------------------------------------------------------------------

/// A team member who can create and verify seals.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TeamMember {
    /// Display name.
    pub name: String,
    /// Email address.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub email: Option<String>,
    /// GitHub username.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub github: Option<String>,
    /// Base64-encoded Ed25519 public key (32 bytes raw).
    pub public_key: String,
    /// Key algorithm (currently always `"ed25519"`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub public_key_algorithm: Option<PublicKeyAlgorithm>,
}

/// Supported public key algorithms.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PublicKeyAlgorithm {
    Ed25519,
}

// ---------------------------------------------------------------------------
// Gates
// ---------------------------------------------------------------------------

/// A gate defines a verification checkpoint: which files to fingerprint,
/// who can seal it, and how long a seal stays valid.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GateConfig {
    /// Human-readable gate name.
    pub name: String,
    /// Description of what this gate verifies.
    pub description: String,
    /// Team member slugs authorized to seal this gate.
    pub authorized_signers: Vec<String>,
    /// File patterns that make up this gate's fingerprint.
    pub fingerprint: FingerprintConfig,
    /// Maximum seal age before staleness (duration string, e.g. `"30d"`).
    pub max_age: String,
}

/// Fingerprint file selection within a gate.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FingerprintConfig {
    /// Glob patterns for files to include.
    pub paths: Vec<String>,
    /// Glob patterns for files to exclude.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub exclude: Vec<String>,
}

// ---------------------------------------------------------------------------
// Suites
// ---------------------------------------------------------------------------

/// A test suite that maps to a gate and defines how to run verification.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SuiteConfig {
    /// The gate this suite verifies (gate slug).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub gate: Option<String>,
    /// Human-readable description.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// File/directory glob patterns (used when no gate is specified).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub packages: Vec<String>,
    /// Individual file patterns.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub files: Vec<String>,
    /// Ignore patterns.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub ignore: Vec<String>,
    /// Command to execute for this suite.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub command: Option<String>,
    /// Timeout duration string (e.g. `"5m"`, `"30s"`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub timeout: Option<String>,
    /// Whether this suite requires an interactive terminal.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub interactive: Option<bool>,
    /// Suite names that are invalidated when this suite's fingerprint changes.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub invalidates: Vec<String>,
    /// Suite names that must pass before this suite.
    ///
    /// Note: This field uses snake_case (`depends_on`) in both TypeScript and YAML,
    /// so it needs an explicit rename to override the struct-level `camelCase`.
    #[serde(default, skip_serializing_if = "Vec::is_empty", rename = "depends_on")]
    pub depends_on: Vec<String>,
}

// ---------------------------------------------------------------------------
// Policy config (split config — committed to git)
// ---------------------------------------------------------------------------

/// Policy configuration — the shared, version-controlled half.
///
/// Contains team members, gates, and shared settings (max age, paths).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PolicyConfig {
    /// Schema version (always 1).
    #[serde(deserialize_with = "deserialize_version")]
    pub version: u32,
    /// Minimum CLI version required.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub min_version: Option<String>,
    /// Policy-level settings.
    #[serde(default)]
    pub settings: PolicySettings,
    /// Team members keyed by slug.
    #[serde(default, skip_serializing_if = "HashMap::is_empty")]
    pub team: HashMap<String, TeamMember>,
    /// Gates keyed by slug.
    #[serde(default, skip_serializing_if = "HashMap::is_empty")]
    pub gates: HashMap<String, GateConfig>,
}

/// Settings that live in the policy config.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PolicySettings {
    /// Maximum seal age in days.
    #[serde(default = "default_max_age_days")]
    pub max_age_days: u32,
    /// Path to the public key file.
    #[serde(default = "default_public_key_path")]
    pub public_key_path: String,
    /// Path to the attestations file.
    #[serde(default = "default_attestations_path")]
    pub attestations_path: String,
    /// Path to the seals file.
    #[serde(default = "default_seals_path")]
    pub seals_path: String,
}

impl Default for PolicySettings {
    fn default() -> Self {
        Self {
            max_age_days: default_max_age_days(),
            public_key_path: default_public_key_path(),
            attestations_path: default_attestations_path(),
            seals_path: default_seals_path(),
        }
    }
}

// ---------------------------------------------------------------------------
// Operational config (split config — local/per-environment)
// ---------------------------------------------------------------------------

/// Operational configuration — the local, per-environment half.
///
/// Contains suites, groups, key provider settings, and default command.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OperationalConfig {
    /// Schema version (always 1).
    #[serde(deserialize_with = "deserialize_version")]
    pub version: u32,
    /// Minimum CLI version required.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub min_version: Option<String>,
    /// Operational settings.
    #[serde(default)]
    pub settings: OperationalSettings,
    /// Suites keyed by slug.
    pub suites: HashMap<String, SuiteConfig>,
    /// Named groups of suite slugs.
    #[serde(default, skip_serializing_if = "HashMap::is_empty")]
    pub groups: HashMap<String, Vec<String>>,
}

/// Settings that live in the operational config.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OperationalSettings {
    /// Default command for suites that don't specify one.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default_command: Option<String>,
    /// Key provider configuration.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub key_provider: Option<KeyProviderSettings>,
}

// ---------------------------------------------------------------------------
// Config merge
// ---------------------------------------------------------------------------

impl AttestItConfig {
    /// Merge a policy config and an operational config into a single runtime config.
    ///
    /// The policy provides team, gates, and shared settings.
    /// The operational provides suites, groups, key provider, and default command.
    /// The `minVersion` is taken from whichever config specifies a higher version.
    pub fn merge(policy: PolicyConfig, operational: OperationalConfig) -> Self {
        let min_version = match (&policy.min_version, &operational.min_version) {
            (Some(p), Some(o)) => {
                // Take the higher semver requirement
                match (semver::Version::parse(p), semver::Version::parse(o)) {
                    (Ok(pv), Ok(ov)) => {
                        if pv >= ov {
                            Some(p.clone())
                        } else {
                            Some(o.clone())
                        }
                    }
                    _ => Some(p.clone()),
                }
            }
            (Some(v), None) | (None, Some(v)) => Some(v.clone()),
            (None, None) => None,
        };

        Self {
            version: 1,
            min_version,
            settings: AttestItSettings {
                max_age_days: policy.settings.max_age_days,
                public_key_path: policy.settings.public_key_path,
                attestations_path: policy.settings.attestations_path,
                seals_path: policy.settings.seals_path,
                default_command: operational.settings.default_command,
                key_provider: operational.settings.key_provider,
            },
            team: policy.team,
            gates: policy.gates,
            suites: operational.suites,
            groups: operational.groups,
        }
    }
}
