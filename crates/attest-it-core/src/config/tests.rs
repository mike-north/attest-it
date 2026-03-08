//! Serde round-trip tests for config types.
//!
//! These tests verify that Rust structs serialize to the exact JSON field names
//! and shapes expected by the TypeScript side. Cross-language compatibility
//! depends on these passing.

#[cfg(test)]
mod serde_roundtrip {
    use std::collections::HashMap;

    use crate::config::types::*;

    // -----------------------------------------------------------------------
    // TeamMember
    // -----------------------------------------------------------------------

    #[test]
    fn team_member_json_field_names() {
        let member = TeamMember {
            name: "Alice".to_owned(),
            email: Some("alice@example.com".to_owned()),
            github: Some("alice-gh".to_owned()),
            public_key: "dGVzdGtleQ==".to_owned(),
            public_key_algorithm: Some(PublicKeyAlgorithm::Ed25519),
        };
        let json = serde_json::to_value(&member).unwrap();
        assert_eq!(json["name"], "Alice");
        assert_eq!(json["email"], "alice@example.com");
        assert_eq!(json["github"], "alice-gh");
        assert_eq!(json["publicKey"], "dGVzdGtleQ==");
        assert_eq!(json["publicKeyAlgorithm"], "ed25519");
    }

    #[test]
    fn team_member_optional_fields_omitted() {
        let member = TeamMember {
            name: "Bob".to_owned(),
            email: None,
            github: None,
            public_key: "a2V5".to_owned(),
            public_key_algorithm: None,
        };
        let json = serde_json::to_value(&member).unwrap();
        assert!(json.get("email").is_none());
        assert!(json.get("github").is_none());
        assert!(json.get("publicKeyAlgorithm").is_none());
    }

    #[test]
    fn team_member_roundtrip() {
        let member = TeamMember {
            name: "Alice".to_owned(),
            email: Some("alice@example.com".to_owned()),
            github: None,
            public_key: "dGVzdGtleQ==".to_owned(),
            public_key_algorithm: Some(PublicKeyAlgorithm::Ed25519),
        };
        let json = serde_json::to_string(&member).unwrap();
        let back: TeamMember = serde_json::from_str(&json).unwrap();
        assert_eq!(member, back);
    }

    // -----------------------------------------------------------------------
    // GateConfig
    // -----------------------------------------------------------------------

    #[test]
    fn gate_config_json_field_names() {
        let gate = GateConfig {
            name: "UI Gate".to_owned(),
            description: "Verifies UI".to_owned(),
            authorized_signers: vec!["alice".to_owned()],
            fingerprint: FingerprintConfig {
                paths: vec!["src/**".to_owned()],
                exclude: vec!["**/*.test.ts".to_owned()],
            },
            max_age: "30d".to_owned(),
        };
        let json = serde_json::to_value(&gate).unwrap();
        assert_eq!(json["authorizedSigners"][0], "alice");
        assert_eq!(json["maxAge"], "30d");
        assert_eq!(json["fingerprint"]["paths"][0], "src/**");
        assert_eq!(json["fingerprint"]["exclude"][0], "**/*.test.ts");
    }

    #[test]
    fn fingerprint_config_empty_exclude_omitted() {
        let fc = FingerprintConfig {
            paths: vec!["src/**".to_owned()],
            exclude: vec![],
        };
        let json = serde_json::to_value(&fc).unwrap();
        assert!(json.get("exclude").is_none());
    }

    // -----------------------------------------------------------------------
    // SuiteConfig
    // -----------------------------------------------------------------------

    #[test]
    fn suite_config_json_field_names() {
        let suite = SuiteConfig {
            gate: Some("ui-gate".to_owned()),
            description: Some("UI tests".to_owned()),
            packages: vec![],
            files: vec![],
            ignore: vec![],
            command: Some("npm test".to_owned()),
            timeout: Some("5m".to_owned()),
            interactive: Some(true),
            invalidates: vec!["other-suite".to_owned()],
            depends_on: vec!["base-suite".to_owned()],
        };
        let json = serde_json::to_value(&suite).unwrap();
        assert_eq!(json["gate"], "ui-gate");
        // depends_on uses snake_case (matching TypeScript schema)
        assert_eq!(json["depends_on"][0], "base-suite");
        assert_eq!(json["interactive"], true);
    }

    #[test]
    fn suite_config_depends_on_yaml_roundtrip() {
        // Verify depends_on uses snake_case in YAML (matching TypeScript schema)
        let yaml = "gate: my-gate\ndepends_on:\n  - other-suite\n";
        let suite: SuiteConfig = serde_yaml::from_str(yaml).unwrap();
        assert_eq!(suite.depends_on, vec!["other-suite"]);

        // Verify it serializes back as snake_case
        let json = serde_json::to_value(&suite).unwrap();
        assert_eq!(json["depends_on"][0], "other-suite");
        assert!(json.get("dependsOn").is_none());
    }

    #[test]
    fn suite_config_empty_vecs_omitted() {
        let suite = SuiteConfig {
            gate: Some("g".to_owned()),
            description: None,
            packages: vec![],
            files: vec![],
            ignore: vec![],
            command: None,
            timeout: None,
            interactive: None,
            invalidates: vec![],
            depends_on: vec![],
        };
        let json = serde_json::to_value(&suite).unwrap();
        assert!(json.get("packages").is_none());
        assert!(json.get("files").is_none());
        assert!(json.get("ignore").is_none());
        assert!(json.get("invalidates").is_none());
        assert!(json.get("depends_on").is_none());
        assert!(json.get("description").is_none());
        assert!(json.get("command").is_none());
    }

    // -----------------------------------------------------------------------
    // KeyProviderSettings
    // -----------------------------------------------------------------------

    #[test]
    fn key_provider_json_field_names() {
        let kp = KeyProviderSettings {
            provider_type: "filesystem".to_owned(),
            options: Some(KeyProviderOptions {
                private_key_path: Some("/path/to/key".to_owned()),
                vault: None,
                item_name: None,
                account: None,
            }),
        };
        let json = serde_json::to_value(&kp).unwrap();
        assert_eq!(json["type"], "filesystem");
        assert_eq!(json["options"]["privateKeyPath"], "/path/to/key");
    }

    // -----------------------------------------------------------------------
    // AttestItSettings defaults
    // -----------------------------------------------------------------------

    #[test]
    fn settings_defaults() {
        let settings = AttestItSettings::default();
        assert_eq!(settings.max_age_days, 30);
        assert_eq!(settings.public_key_path, ".attest-it/pubkey.pem");
        assert_eq!(settings.attestations_path, ".attest-it/attestations.json");
        assert_eq!(settings.seals_path, ".attest-it/seals.json");
        assert!(settings.default_command.is_none());
        assert!(settings.key_provider.is_none());
    }

    #[test]
    fn settings_deserialized_with_defaults() {
        let json = r#"{"maxAgeDays": 30}"#;
        let settings: AttestItSettings = serde_json::from_str(json).unwrap();
        assert_eq!(settings.public_key_path, ".attest-it/pubkey.pem");
        assert_eq!(settings.seals_path, ".attest-it/seals.json");
    }

    // -----------------------------------------------------------------------
    // Config merge
    // -----------------------------------------------------------------------

    fn empty_policy() -> PolicyConfig {
        PolicyConfig {
            version: 1,
            min_version: None,
            settings: PolicySettings::default(),
            team: HashMap::new(),
            gates: HashMap::new(),
        }
    }

    fn empty_operational() -> OperationalConfig {
        OperationalConfig {
            version: 1,
            min_version: None,
            settings: OperationalSettings::default(),
            suites: HashMap::new(),
            groups: HashMap::new(),
        }
    }

    #[test]
    fn merge_takes_higher_min_version() {
        let policy = PolicyConfig {
            min_version: Some("0.8.0".to_owned()),
            ..empty_policy()
        };
        let operational = OperationalConfig {
            min_version: Some("1.0.0".to_owned()),
            ..empty_operational()
        };
        let merged = AttestItConfig::merge(policy, operational);
        assert_eq!(merged.min_version.as_deref(), Some("1.0.0"));
    }

    #[test]
    fn merge_policy_only_min_version() {
        let policy = PolicyConfig {
            min_version: Some("0.5.0".to_owned()),
            ..empty_policy()
        };
        let merged = AttestItConfig::merge(policy, empty_operational());
        assert_eq!(merged.min_version.as_deref(), Some("0.5.0"));
    }

    #[test]
    fn merge_both_none_min_version() {
        let merged = AttestItConfig::merge(empty_policy(), empty_operational());
        assert!(merged.min_version.is_none());
    }

    #[test]
    fn merge_always_produces_version_1() {
        let merged = AttestItConfig::merge(empty_policy(), empty_operational());
        assert_eq!(merged.version, 1);
    }

    // -----------------------------------------------------------------------
    // YAML round-trip (critical for config files)
    // -----------------------------------------------------------------------

    #[test]
    fn policy_config_yaml_roundtrip() {
        let yaml = r#"
version: 1
minVersion: "0.8.0"
settings:
  maxAgeDays: 30
  publicKeyPath: ".attest-it/pubkey.pem"
  attestationsPath: ".attest-it/attestations.json"
  sealsPath: ".attest-it/seals.json"
team:
  alice:
    name: Alice
    publicKey: "dGVzdGtleQ=="
gates:
  ui-gate:
    name: UI Gate
    description: Verifies UI components
    authorizedSigners:
      - alice
    fingerprint:
      paths:
        - "src/**/*.tsx"
    maxAge: "30d"
"#;
        let config: PolicyConfig = serde_yaml::from_str(yaml).unwrap();
        assert_eq!(config.version, 1);
        assert_eq!(config.min_version.as_deref(), Some("0.8.0"));
        assert!(config.team.contains_key("alice"));
        assert!(config.gates.contains_key("ui-gate"));
        assert_eq!(config.gates["ui-gate"].max_age, "30d");
    }

    #[test]
    fn operational_config_yaml_roundtrip() {
        let yaml = r#"
version: 1
settings:
  defaultCommand: "npm test"
suites:
  ui-tests:
    gate: ui-gate
    description: UI test suite
    command: "npm run test:ui"
    timeout: "5m"
    depends_on:
      - setup-suite
groups:
  all:
    - ui-tests
"#;
        let config: OperationalConfig = serde_yaml::from_str(yaml).unwrap();
        assert_eq!(config.version, 1);
        assert_eq!(config.settings.default_command.as_deref(), Some("npm test"));
        assert!(config.suites.contains_key("ui-tests"));
        assert_eq!(config.suites["ui-tests"].gate.as_deref(), Some("ui-gate"));
        assert_eq!(config.suites["ui-tests"].depends_on, vec!["setup-suite"]);
        assert_eq!(config.groups["all"], vec!["ui-tests"]);
    }

    #[test]
    fn version_accepts_string_or_number_operational() {
        let yaml_number = "version: 1\nsuites:\n  s:\n    gate: g\n";
        let yaml_string = "version: \"1\"\nsuites:\n  s:\n    gate: g\n";

        let config1: OperationalConfig = serde_yaml::from_str(yaml_number).unwrap();
        let config2: OperationalConfig = serde_yaml::from_str(yaml_string).unwrap();

        assert_eq!(config1.version, 1);
        assert_eq!(config2.version, 1);
    }

    #[test]
    fn version_accepts_string_or_number_policy() {
        let yaml_number = "version: 1\n";
        let yaml_string = "version: \"1\"\n";

        let config1: PolicyConfig = serde_yaml::from_str(yaml_number).unwrap();
        let config2: PolicyConfig = serde_yaml::from_str(yaml_string).unwrap();

        assert_eq!(config1.version, 1);
        assert_eq!(config2.version, 1);
    }

    #[test]
    fn version_rejects_invalid_string() {
        let yaml = "version: \"abc\"\nsuites:\n  s:\n    gate: g\n";
        assert!(serde_yaml::from_str::<OperationalConfig>(yaml).is_err());
    }

    #[test]
    fn version_rejects_negative() {
        let yaml = "version: -1\nsuites:\n  s:\n    gate: g\n";
        assert!(serde_yaml::from_str::<OperationalConfig>(yaml).is_err());
    }

    // -----------------------------------------------------------------------
    // CrossConfigError serde
    // -----------------------------------------------------------------------

    #[test]
    fn cross_config_error_json_field_names() {
        use crate::errors::{CrossConfigError, CrossConfigErrorType};

        let err = CrossConfigError {
            error_type: CrossConfigErrorType::UnknownGate,
            suite: Some("ui-tests".to_owned()),
            gate: Some("missing-gate".to_owned()),
            signer: None,
            message: "not found".to_owned(),
        };
        let json = serde_json::to_value(&err).unwrap();
        assert_eq!(json["type"], "UNKNOWN_GATE");
        assert_eq!(json["suite"], "ui-tests");
        assert_eq!(json["gate"], "missing-gate");
        assert!(json.get("signer").is_none());
    }

    #[test]
    fn cross_config_error_type_serialization() {
        use crate::errors::CrossConfigErrorType;
        assert_eq!(
            serde_json::to_value(CrossConfigErrorType::UnknownGate).unwrap(),
            "UNKNOWN_GATE"
        );
        assert_eq!(
            serde_json::to_value(CrossConfigErrorType::MissingTeamMember).unwrap(),
            "MISSING_TEAM_MEMBER"
        );
    }

    // -----------------------------------------------------------------------
    // Platform, SignResult serde
    // -----------------------------------------------------------------------

    #[test]
    fn platform_serialization() {
        use crate::types::Platform;
        assert_eq!(serde_json::to_value(Platform::Darwin).unwrap(), "darwin");
        assert_eq!(serde_json::to_value(Platform::Linux).unwrap(), "linux");
        assert_eq!(serde_json::to_value(Platform::Win32).unwrap(), "win32");
    }

    #[test]
    fn sign_result_json_field_names() {
        use crate::types::SignResult;
        let sr = SignResult {
            signature: "c2ln".to_owned(),
            algorithm: "ed25519".to_owned(),
        };
        let json = serde_json::to_value(&sr).unwrap();
        assert_eq!(json["signature"], "c2ln");
        assert_eq!(json["algorithm"], "ed25519");
    }

    // -----------------------------------------------------------------------
    // FingerprintOptions, FingerprintResult serde
    // -----------------------------------------------------------------------

    #[test]
    fn fingerprint_options_json_field_names() {
        use crate::fingerprint::FingerprintOptions;
        let opts = FingerprintOptions {
            paths: vec!["src/**".to_owned()],
            ignore: vec!["*.test.ts".to_owned()],
            base_dir: Some("/project".to_owned()),
        };
        let json = serde_json::to_value(&opts).unwrap();
        assert_eq!(json["paths"][0], "src/**");
        assert_eq!(json["ignore"][0], "*.test.ts");
        assert_eq!(json["baseDir"], "/project");
    }

    #[test]
    fn fingerprint_result_json_field_names() {
        use crate::fingerprint::FingerprintResult;
        let result = FingerprintResult {
            fingerprint: "sha256:abc123".to_owned(),
            files: vec!["src/main.rs".to_owned()],
            file_count: 1,
        };
        let json = serde_json::to_value(&result).unwrap();
        assert_eq!(json["fingerprint"], "sha256:abc123");
        assert_eq!(json["files"][0], "src/main.rs");
        assert_eq!(json["fileCount"], 1);
    }
}
