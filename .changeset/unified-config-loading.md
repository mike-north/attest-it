---
'@attest-it/core': patch
'@attest-it/cli': patch
'@attest-it/github-action': patch
---

Unify configuration loading between CLI and GitHub Action.

Previously, the CLI and GitHub Action used different code paths to load configuration, causing inconsistent assessments. The CLI would report "No gates defined" while CI showed fingerprint mismatches because they loaded different parts of the configuration.

This change introduces `loadSplitConfig()` - a unified configuration loading function used by both CLI and GitHub Action:

- **Split config support**: Loads `policy.yaml` (gates, team) and `config.yaml` (suites, settings) separately and merges them
- **Backward compatibility**: Falls back to unified config format when `policy.yaml` is not found
- **Flexible policy source**: Supports filesystem loading or content-based loading (for fetching policy from GitHub API in PR context)
- **Cross-config validation**: Validates that suite gate references exist in the policy

The CLI and GitHub Action now provide consistent assessments of seal status.
