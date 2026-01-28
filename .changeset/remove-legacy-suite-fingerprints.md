---
'@attest-it/core': minor
---

BREAKING: Remove suite-level fingerprint configuration in favor of gates.

- Remove `packages`, `files`, and `ignore` fields from suite configuration
- Require `gate` field on all suites (must reference a defined gate)
- Remove deprecated functions: `getProjectPublicKeysDir()`, `hasProjectConfig()`
- Remove `projectPath` field from `SavePublicKeyResult`
- Remove `projectRoot` parameter from `savePublicKey()` and `savePublicKeySync()`

Migration: Replace suite-level `packages`/`files`/`ignore` with a `gate` reference to a named gate definition.
