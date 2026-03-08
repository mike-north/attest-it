//! Configuration validation.
//!
//! Post-deserialization validation for individual configs and cross-config
//! consistency checks (suite→gate references, signer existence, etc.).

use std::collections::HashMap;

use crate::errors::{AttestError, CrossConfigError, CrossConfigErrorType};

use super::duration::parse_duration_ms;
use super::types::{GateConfig, OperationalConfig, PolicyConfig, SuiteConfig, TeamMember};

// ---------------------------------------------------------------------------
// Semver validation
// ---------------------------------------------------------------------------

/// Validate that a string is a valid semver version.
pub fn validate_semver(input: &str) -> bool {
    semver::Version::parse(input).is_ok()
}

// ---------------------------------------------------------------------------
// Duration validation
// ---------------------------------------------------------------------------

/// Validate that a string is a valid positive duration.
pub fn validate_duration(input: &str) -> bool {
    parse_duration_ms(input).is_ok()
}

// ---------------------------------------------------------------------------
// Fingerprint format validation
// ---------------------------------------------------------------------------

/// Validate that a fingerprint string matches the expected format `sha256:<hex>`.
///
/// Checks that the prefix is exactly `"sha256:"` (case-sensitive) followed by
/// one or more hex characters. Does **not** validate the hex length (a full
/// SHA-256 hash is 64 hex characters, but shorter strings pass).
pub fn validate_fingerprint(input: &str) -> bool {
    if let Some(hex) = input.strip_prefix("sha256:") {
        !hex.is_empty() && hex.chars().all(|c| c.is_ascii_hexdigit())
    } else {
        false
    }
}

// ---------------------------------------------------------------------------
// Policy config validation
// ---------------------------------------------------------------------------

/// Validate a policy config after deserialization.
pub fn validate_policy(config: &PolicyConfig) -> Result<(), AttestError> {
    let mut errors = Vec::new();

    // Check version
    if config.version != 1 {
        errors.push(format!("unsupported policy version: {}", config.version));
    }

    // Check minVersion is valid semver if present
    if let Some(ref min_ver) = config.min_version
        && !validate_semver(min_ver)
    {
        errors.push(format!("invalid minVersion semver: \"{min_ver}\""));
    }

    // Check team members have non-empty required fields
    for (slug, member) in &config.team {
        if member.name.is_empty() {
            errors.push(format!("team member \"{slug}\": name is required"));
        }
        if member.public_key.is_empty() {
            errors.push(format!("team member \"{slug}\": publicKey is required"));
        }
    }

    // Check gates
    for (slug, gate) in &config.gates {
        validate_gate(slug, gate, &mut errors);
    }

    if errors.is_empty() {
        Ok(())
    } else {
        Err(AttestError::ConfigValidation {
            message: format!("policy config has {} validation error(s)", errors.len()),
            errors,
        })
    }
}

fn validate_gate(slug: &str, gate: &GateConfig, errors: &mut Vec<String>) {
    if gate.name.is_empty() {
        errors.push(format!("gate \"{slug}\": name is required"));
    }
    if gate.description.is_empty() {
        errors.push(format!("gate \"{slug}\": description is required"));
    }
    if gate.authorized_signers.is_empty() {
        errors.push(format!(
            "gate \"{slug}\": at least one authorized signer is required"
        ));
    }
    if gate.fingerprint.paths.is_empty() {
        errors.push(format!(
            "gate \"{slug}\": at least one fingerprint path is required"
        ));
    }
    if !validate_duration(&gate.max_age) {
        errors.push(format!(
            "gate \"{slug}\": invalid maxAge duration \"{}\"",
            gate.max_age
        ));
    }
}

// ---------------------------------------------------------------------------
// Operational config validation
// ---------------------------------------------------------------------------

/// Validate an operational config after deserialization.
pub fn validate_operational(config: &OperationalConfig) -> Result<(), AttestError> {
    let mut errors = Vec::new();

    if config.version != 1 {
        errors.push(format!(
            "unsupported operational version: {}",
            config.version
        ));
    }

    if let Some(ref min_ver) = config.min_version
        && !validate_semver(min_ver)
    {
        errors.push(format!("invalid minVersion semver: \"{min_ver}\""));
    }

    if config.suites.is_empty() {
        errors.push("at least one suite is required".to_owned());
    }

    for (slug, suite) in &config.suites {
        validate_suite(slug, suite, &config.suites, &mut errors);
    }

    // Validate group references
    for (group_name, suite_names) in &config.groups {
        for suite_name in suite_names {
            if !config.suites.contains_key(suite_name) {
                errors.push(format!(
                    "group \"{group_name}\": references unknown suite \"{suite_name}\""
                ));
            }
        }
    }

    if errors.is_empty() {
        Ok(())
    } else {
        Err(AttestError::ConfigValidation {
            message: format!(
                "operational config has {} validation error(s)",
                errors.len()
            ),
            errors,
        })
    }
}

fn validate_suite(
    slug: &str,
    suite: &SuiteConfig,
    all_suites: &HashMap<String, SuiteConfig>,
    errors: &mut Vec<String>,
) {
    let has_gate = suite.gate.is_some();
    let has_packages = !suite.packages.is_empty();

    if !has_gate && !has_packages {
        errors.push(format!(
            "suite \"{slug}\": must specify either 'gate' or 'packages' with at least one entry"
        ));
    }

    if let Some(ref timeout) = suite.timeout
        && !validate_duration(timeout)
    {
        errors.push(format!(
            "suite \"{slug}\": invalid timeout duration \"{timeout}\""
        ));
    }

    // Validate depends_on references
    for dep in &suite.depends_on {
        if !all_suites.contains_key(dep) {
            errors.push(format!(
                "suite \"{slug}\": depends_on references unknown suite \"{dep}\""
            ));
        }
    }

    // Validate invalidates references
    for inv in &suite.invalidates {
        if !all_suites.contains_key(inv) {
            errors.push(format!(
                "suite \"{slug}\": invalidates references unknown suite \"{inv}\""
            ));
        }
    }
}

// ---------------------------------------------------------------------------
// Cross-config validation
// ---------------------------------------------------------------------------

/// Validate consistency between policy and operational configs.
///
/// Checks:
/// - Each suite's `gate` reference exists in the policy's gates
/// - Each gate's `authorizedSigners` references exist in the policy's team
pub fn validate_cross_config(
    policy: &PolicyConfig,
    operational: &OperationalConfig,
) -> Result<(), AttestError> {
    let errors = collect_cross_config_errors(&operational.suites, &policy.gates, &policy.team);

    if errors.is_empty() {
        Ok(())
    } else {
        Err(AttestError::CrossConfigValidation {
            message: format!("cross-config validation found {} error(s)", errors.len()),
            errors,
        })
    }
}

/// Collect all cross-config validation errors without short-circuiting.
///
/// Unlike [`validate_cross_config`], this returns the raw error list rather
/// than wrapping it in an `AttestError`. Useful for callers that need to
/// inspect or aggregate errors programmatically (e.g., WASM bindings that
/// serialize the error list to JSON for the TypeScript caller).
pub fn collect_cross_config_errors(
    suites: &HashMap<String, SuiteConfig>,
    gates: &HashMap<String, GateConfig>,
    team: &HashMap<String, TeamMember>,
) -> Vec<CrossConfigError> {
    let mut errors = Vec::new();

    // Check suite → gate references
    for (suite_slug, suite) in suites {
        if let Some(ref gate_id) = suite.gate
            && !gates.contains_key(gate_id)
        {
            errors.push(CrossConfigError {
                error_type: CrossConfigErrorType::UnknownGate,
                suite: Some(suite_slug.clone()),
                gate: Some(gate_id.clone()),
                signer: None,
                message: format!("suite \"{suite_slug}\" references unknown gate \"{gate_id}\""),
            });
        }
    }

    // Check gate → team member references
    for (gate_slug, gate) in gates {
        for signer_slug in &gate.authorized_signers {
            if !team.contains_key(signer_slug) {
                errors.push(CrossConfigError {
                    error_type: CrossConfigErrorType::MissingTeamMember,
                    suite: None,
                    gate: Some(gate_slug.clone()),
                    signer: Some(signer_slug.clone()),
                    message: format!(
                        "gate \"{gate_slug}\" references unknown team member \"{signer_slug}\""
                    ),
                });
            }
        }
    }

    errors
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::types::{
        FingerprintConfig, GateConfig, OperationalSettings, PolicySettings, TeamMember,
    };

    // -----------------------------------------------------------------------
    // Semver
    // -----------------------------------------------------------------------

    #[test]
    fn test_valid_semver() {
        assert!(validate_semver("0.8.0"));
        assert!(validate_semver("1.0.0"));
        assert!(validate_semver("1.0.0-beta.1"));
        assert!(validate_semver("1.0.0+build.123"));
    }

    #[test]
    fn test_invalid_semver() {
        assert!(!validate_semver(""));
        assert!(!validate_semver("1"));
        assert!(!validate_semver("1.0"));
        assert!(!validate_semver("not-a-version"));
    }

    // -----------------------------------------------------------------------
    // Fingerprint format
    // -----------------------------------------------------------------------

    #[test]
    fn test_valid_fingerprint() {
        assert!(validate_fingerprint("sha256:abcdef0123456789"));
        assert!(validate_fingerprint("sha256:ABCDEF"));
    }

    #[test]
    fn test_invalid_fingerprint() {
        assert!(!validate_fingerprint(""));
        assert!(!validate_fingerprint("sha256:"));
        assert!(!validate_fingerprint("md5:abc"));
        assert!(!validate_fingerprint("sha256:xyz"));
    }

    #[test]
    fn test_fingerprint_prefix_must_be_lowercase() {
        assert!(!validate_fingerprint("SHA256:abc123"));
        assert!(!validate_fingerprint("Sha256:abc123"));
    }

    // -----------------------------------------------------------------------
    // Policy validation
    // -----------------------------------------------------------------------

    fn sample_policy() -> PolicyConfig {
        let mut team = HashMap::new();
        team.insert(
            "alice".to_owned(),
            TeamMember {
                name: "Alice".to_owned(),
                email: None,
                github: None,
                public_key: "dGVzdGtleQ==".to_owned(),
                public_key_algorithm: None,
            },
        );

        let mut gates = HashMap::new();
        gates.insert(
            "ui-gate".to_owned(),
            GateConfig {
                name: "UI Gate".to_owned(),
                description: "Verifies UI components".to_owned(),
                authorized_signers: vec!["alice".to_owned()],
                fingerprint: FingerprintConfig {
                    paths: vec!["src/**/*.tsx".to_owned()],
                    exclude: vec![],
                },
                max_age: "30d".to_owned(),
            },
        );

        PolicyConfig {
            version: 1,
            min_version: None,
            settings: PolicySettings::default(),
            team,
            gates,
        }
    }

    #[test]
    fn test_valid_policy() {
        assert!(validate_policy(&sample_policy()).is_ok());
    }

    #[test]
    fn test_policy_invalid_version() {
        let mut policy = sample_policy();
        policy.version = 2;
        assert!(validate_policy(&policy).is_err());
    }

    #[test]
    fn test_policy_empty_team_member_name() {
        let mut policy = sample_policy();
        policy.team.get_mut("alice").unwrap().name = String::new();
        assert!(validate_policy(&policy).is_err());
    }

    #[test]
    fn test_policy_empty_team_member_public_key() {
        let mut policy = sample_policy();
        policy.team.get_mut("alice").unwrap().public_key = String::new();
        assert!(validate_policy(&policy).is_err());
    }

    #[test]
    fn test_policy_invalid_gate_duration() {
        let mut policy = sample_policy();
        policy.gates.get_mut("ui-gate").unwrap().max_age = "invalid".to_owned();
        assert!(validate_policy(&policy).is_err());
    }

    #[test]
    fn test_policy_gate_empty_name() {
        let mut policy = sample_policy();
        policy.gates.get_mut("ui-gate").unwrap().name = String::new();
        assert!(validate_policy(&policy).is_err());
    }

    #[test]
    fn test_policy_gate_empty_description() {
        let mut policy = sample_policy();
        policy.gates.get_mut("ui-gate").unwrap().description = String::new();
        assert!(validate_policy(&policy).is_err());
    }

    #[test]
    fn test_policy_gate_empty_signers() {
        let mut policy = sample_policy();
        policy
            .gates
            .get_mut("ui-gate")
            .unwrap()
            .authorized_signers
            .clear();
        assert!(validate_policy(&policy).is_err());
    }

    #[test]
    fn test_policy_gate_empty_fingerprint_paths() {
        let mut policy = sample_policy();
        policy
            .gates
            .get_mut("ui-gate")
            .unwrap()
            .fingerprint
            .paths
            .clear();
        assert!(validate_policy(&policy).is_err());
    }

    #[test]
    fn test_policy_multiple_errors_accumulated() {
        let mut policy = sample_policy();
        policy.version = 2;
        policy.gates.get_mut("ui-gate").unwrap().max_age = "bad".to_owned();
        let err = validate_policy(&policy).unwrap_err();
        if let AttestError::ConfigValidation { errors, .. } = err {
            assert!(
                errors.len() >= 2,
                "expected at least 2 errors, got {}",
                errors.len()
            );
        } else {
            panic!("expected ConfigValidation error");
        }
    }

    // -----------------------------------------------------------------------
    // Operational validation
    // -----------------------------------------------------------------------

    fn sample_operational() -> OperationalConfig {
        let mut suites = HashMap::new();
        suites.insert(
            "ui-tests".to_owned(),
            SuiteConfig {
                gate: Some("ui-gate".to_owned()),
                description: Some("UI test suite".to_owned()),
                packages: vec![],
                files: vec![],
                ignore: vec![],
                command: Some("npm test".to_owned()),
                timeout: Some("5m".to_owned()),
                interactive: None,
                invalidates: vec![],
                depends_on: vec![],
            },
        );

        OperationalConfig {
            version: 1,
            min_version: None,
            settings: OperationalSettings::default(),
            suites,
            groups: HashMap::new(),
        }
    }

    #[test]
    fn test_valid_operational() {
        assert!(validate_operational(&sample_operational()).is_ok());
    }

    #[test]
    fn test_operational_invalid_version() {
        let mut op = sample_operational();
        op.version = 2;
        assert!(validate_operational(&op).is_err());
    }

    #[test]
    fn test_operational_empty_suites() {
        let mut op = sample_operational();
        op.suites.clear();
        assert!(validate_operational(&op).is_err());
    }

    #[test]
    fn test_operational_suite_needs_gate_or_packages() {
        let mut op = sample_operational();
        let suite = op.suites.get_mut("ui-tests").unwrap();
        suite.gate = None;
        suite.packages.clear();
        assert!(validate_operational(&op).is_err());
    }

    #[test]
    fn test_operational_invalid_timeout() {
        let mut op = sample_operational();
        op.suites.get_mut("ui-tests").unwrap().timeout = Some("bad".to_owned());
        assert!(validate_operational(&op).is_err());
    }

    #[test]
    fn test_operational_invalid_group_reference() {
        let mut op = sample_operational();
        op.groups
            .insert("my-group".to_owned(), vec!["nonexistent".to_owned()]);
        assert!(validate_operational(&op).is_err());
    }

    #[test]
    fn test_operational_invalid_depends_on_reference() {
        let mut op = sample_operational();
        op.suites.get_mut("ui-tests").unwrap().depends_on = vec!["nonexistent".to_owned()];
        assert!(validate_operational(&op).is_err());
    }

    #[test]
    fn test_operational_invalid_invalidates_reference() {
        let mut op = sample_operational();
        op.suites.get_mut("ui-tests").unwrap().invalidates = vec!["nonexistent".to_owned()];
        assert!(validate_operational(&op).is_err());
    }

    #[test]
    fn test_operational_multiple_errors_accumulated() {
        let mut op = sample_operational();
        op.version = 2;
        op.suites.get_mut("ui-tests").unwrap().timeout = Some("bad".to_owned());
        let err = validate_operational(&op).unwrap_err();
        if let AttestError::ConfigValidation { errors, .. } = err {
            assert!(
                errors.len() >= 2,
                "expected at least 2 errors, got {}",
                errors.len()
            );
        } else {
            panic!("expected ConfigValidation error");
        }
    }

    // -----------------------------------------------------------------------
    // Cross-config validation
    // -----------------------------------------------------------------------

    #[test]
    fn test_valid_cross_config() {
        let policy = sample_policy();
        let op = sample_operational();
        assert!(validate_cross_config(&policy, &op).is_ok());
    }

    #[test]
    fn test_cross_config_unknown_gate() {
        let mut policy = sample_policy();
        policy.gates.clear();
        let op = sample_operational();
        let result = validate_cross_config(&policy, &op);
        assert!(result.is_err());
        if let Err(AttestError::CrossConfigValidation { errors, .. }) = result {
            assert_eq!(errors.len(), 1);
            assert_eq!(errors[0].error_type, CrossConfigErrorType::UnknownGate);
        }
    }

    #[test]
    fn test_cross_config_missing_team_member() {
        let mut policy = sample_policy();
        policy.team.clear();
        let op = sample_operational();
        let result = validate_cross_config(&policy, &op);
        assert!(result.is_err());
        if let Err(AttestError::CrossConfigValidation { errors, .. }) = result {
            assert!(
                errors
                    .iter()
                    .any(|e| e.error_type == CrossConfigErrorType::MissingTeamMember)
            );
        }
    }

    #[test]
    fn test_cross_config_both_error_types() {
        let mut policy = sample_policy();
        policy.team.clear(); // causes MissingTeamMember
        policy.gates.clear(); // causes UnknownGate (suite references ui-gate)
        // Re-add a gate that references a missing team member
        policy.gates.insert(
            "other-gate".to_owned(),
            GateConfig {
                name: "Other".to_owned(),
                description: "Other gate".to_owned(),
                authorized_signers: vec!["bob".to_owned()],
                fingerprint: FingerprintConfig {
                    paths: vec!["src/**".to_owned()],
                    exclude: vec![],
                },
                max_age: "7d".to_owned(),
            },
        );
        let op = sample_operational();
        let result = validate_cross_config(&policy, &op);
        assert!(result.is_err());
        if let Err(AttestError::CrossConfigValidation { errors, .. }) = result {
            assert!(errors.len() >= 2, "expected both error types");
            assert!(
                errors
                    .iter()
                    .any(|e| e.error_type == CrossConfigErrorType::UnknownGate)
            );
            assert!(
                errors
                    .iter()
                    .any(|e| e.error_type == CrossConfigErrorType::MissingTeamMember)
            );
        }
    }
}
