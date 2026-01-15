---
'@attest-it/core': minor
'@attest-it/github-action': minor
---

Add split config model and policy-ref input for GitHub Action

**Core Package:**

- Add split config model separating policy.yaml (trust definitions) from config.yaml (operational settings)
- Policy file contains: team members, gates, security settings (maxAgeDays, publicKeyPath, attestationsPath)
- Operational file contains: suites, groups, non-security settings
- Add `mergeConfigs()` to combine policy and operational configs
- Add `validateSuiteGateReferences()` for cross-config validation
- Export new functions: `parsePolicyContent`, `parseOperationalContent`, `mergeConfigs`, `validateSuiteGateReferences`

**GitHub Action:**

- Add `policy-ref` input to specify which branch/tag to fetch policy from (e.g., 'production')
- Defaults to base branch for PRs, filesystem for pushes
- Add `fetch-policy.ts` for fetching policy from GitHub API
- Update to use split config model (policy.yaml + config.yaml)

**CI:**

- Add act-based testing for the GitHub Action in CI
- Contributors without Docker can still run unit tests locally
