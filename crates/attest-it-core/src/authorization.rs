//! Authorization logic for seal creation and verification.
//!
//! These functions determine who is allowed to seal a gate by checking
//! the gate's `authorizedSigners` list against the team roster.

use crate::config::types::{AttestItConfig, GateConfig, TeamMember};

/// Check if a public key belongs to an authorized signer for a gate.
///
/// Returns `true` if a team member with the given `public_key` is listed
/// in the gate's `authorizedSigners`.
pub fn is_authorized_signer(config: &AttestItConfig, gate_id: &str, public_key: &str) -> bool {
    let gate = match config.gates.get(gate_id) {
        Some(g) => g,
        None => return false,
    };

    let slug = match find_team_member_slug(config, public_key) {
        Some(s) => s,
        None => return false,
    };

    gate.authorized_signers.contains(&slug)
}

/// Get all team members authorized to sign for a gate.
///
/// Returns an empty vec if the gate doesn't exist.
pub fn get_authorized_signers_for_gate<'a>(
    config: &'a AttestItConfig,
    gate_id: &str,
) -> Vec<&'a TeamMember> {
    let gate = match config.gates.get(gate_id) {
        Some(g) => g,
        None => return Vec::new(),
    };

    gate.authorized_signers
        .iter()
        .filter_map(|slug| config.team.get(slug.as_str()))
        .collect()
}

/// Find a team member by their public key.
pub fn find_team_member_by_public_key<'a>(
    config: &'a AttestItConfig,
    public_key: &str,
) -> Option<&'a TeamMember> {
    config
        .team
        .values()
        .find(|member| member.public_key == public_key)
}

/// Get the gate configuration for a given gate ID.
pub fn get_gate<'a>(config: &'a AttestItConfig, gate_id: &str) -> Option<&'a GateConfig> {
    config.gates.get(gate_id)
}

/// Find the slug for a team member identified by public key.
fn find_team_member_slug(config: &AttestItConfig, public_key: &str) -> Option<String> {
    config
        .team
        .iter()
        .find(|(_, member)| member.public_key == public_key)
        .map(|(slug, _)| slug.clone())
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use crate::config::types::*;

    use super::*;

    fn make_config() -> AttestItConfig {
        let mut team = HashMap::new();
        team.insert(
            "alice".to_string(),
            TeamMember {
                name: "Alice".to_string(),
                email: None,
                github: None,
                public_key: "YWxpY2VrZXk=".to_string(), // base64("alicekey")
                public_key_algorithm: None,
            },
        );
        team.insert(
            "bob".to_string(),
            TeamMember {
                name: "Bob".to_string(),
                email: None,
                github: None,
                public_key: "Ym9ia2V5".to_string(), // base64("bobkey")
                public_key_algorithm: None,
            },
        );

        let mut gates = HashMap::new();
        gates.insert(
            "login-gate".to_string(),
            GateConfig {
                name: "Login Gate".to_string(),
                description: "Login flow verification".to_string(),
                authorized_signers: vec!["alice".to_string()],
                fingerprint: FingerprintConfig {
                    paths: vec!["src/**".to_string()],
                    exclude: vec![],
                },
                max_age: "30d".to_string(),
            },
        );
        gates.insert(
            "payment-gate".to_string(),
            GateConfig {
                name: "Payment Gate".to_string(),
                description: "Payment flow verification".to_string(),
                authorized_signers: vec!["alice".to_string(), "bob".to_string()],
                fingerprint: FingerprintConfig {
                    paths: vec!["src/**".to_string()],
                    exclude: vec![],
                },
                max_age: "7d".to_string(),
            },
        );

        AttestItConfig {
            version: 1,
            min_version: None,
            settings: AttestItSettings::default(),
            team,
            gates,
            suites: HashMap::new(),
            groups: HashMap::new(),
        }
    }

    #[test]
    fn is_authorized_signer_returns_true_for_authorized() {
        let config = make_config();
        assert!(is_authorized_signer(&config, "login-gate", "YWxpY2VrZXk="));
    }

    #[test]
    fn is_authorized_signer_returns_false_for_unauthorized() {
        let config = make_config();
        // Bob is not authorized for login-gate
        assert!(!is_authorized_signer(&config, "login-gate", "Ym9ia2V5"));
    }

    #[test]
    fn is_authorized_signer_returns_false_for_unknown_gate() {
        let config = make_config();
        assert!(!is_authorized_signer(
            &config,
            "nonexistent",
            "YWxpY2VrZXk="
        ));
    }

    #[test]
    fn is_authorized_signer_returns_false_for_unknown_key() {
        let config = make_config();
        assert!(!is_authorized_signer(&config, "login-gate", "unknown-key"));
    }

    #[test]
    fn both_alice_and_bob_authorized_for_payment_gate() {
        let config = make_config();
        assert!(is_authorized_signer(
            &config,
            "payment-gate",
            "YWxpY2VrZXk="
        ));
        assert!(is_authorized_signer(&config, "payment-gate", "Ym9ia2V5"));
    }

    #[test]
    fn get_authorized_signers_returns_members() {
        let config = make_config();
        let signers = get_authorized_signers_for_gate(&config, "payment-gate");
        assert_eq!(signers.len(), 2);
        let names: Vec<&str> = signers.iter().map(|m| m.name.as_str()).collect();
        assert!(names.contains(&"Alice"));
        assert!(names.contains(&"Bob"));
    }

    #[test]
    fn get_authorized_signers_returns_empty_for_unknown_gate() {
        let config = make_config();
        let signers = get_authorized_signers_for_gate(&config, "nonexistent");
        assert!(signers.is_empty());
    }

    #[test]
    fn find_team_member_by_public_key_found() {
        let config = make_config();
        let member = find_team_member_by_public_key(&config, "YWxpY2VrZXk=");
        assert!(member.is_some());
        assert_eq!(member.unwrap().name, "Alice");
    }

    #[test]
    fn find_team_member_by_public_key_not_found() {
        let config = make_config();
        let member = find_team_member_by_public_key(&config, "unknown-key");
        assert!(member.is_none());
    }

    #[test]
    fn get_gate_found() {
        let config = make_config();
        let gate = get_gate(&config, "login-gate");
        assert!(gate.is_some());
        assert_eq!(gate.unwrap().name, "Login Gate");
    }

    #[test]
    fn get_gate_not_found() {
        let config = make_config();
        assert!(get_gate(&config, "nonexistent").is_none());
    }
}
