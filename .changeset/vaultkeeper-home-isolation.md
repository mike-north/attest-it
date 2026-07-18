---
'@attest-it/core': minor
'@attest-it/cli': minor
'attest-it': minor
---

Isolate VaultKeeper private-key material under `ATTEST_IT_HOME`.

Previously, `ATTEST_IT_HOME` (and the programmatic home override / `--home-dir` flag) isolated only attest-it's own `config.yaml` and public keys. The encrypted private-key `.enc` blob was still written to the real, non-sandboxed `~/.config/vaultkeeper/file/` on every `identity create`, `identity migrate`, and any seal/sign operation — breaking the "isolated state for testing / CI-safe / embeddable" contract and accumulating orphaned key files outside the configured home.

- **Home override now propagates into VaultKeeper's config-dir resolution.** A new public `getVaultKeeperConfigDir()` resolves a sandbox-relative `<home>/vaultkeeper` directory whenever a home override is in effect (and `undefined` otherwise, preserving VaultKeeper's own default for real installs). This directory is threaded through every `BackendRegistry.create('file', …)` call — store, delete, and the retrieve/sign provider path — so key material lands under the configured home consistently.
- **Saved public-key `.pem` files now carry real PEM markers.** `savePublicKey`/`savePublicKeySync` write a standards-compliant SPKI `-----BEGIN PUBLIC KEY-----` document instead of bare base64.
- **The 1Password/Keychain provider-prompt banner is suppressed under `--storage file`,** which touches no external security tool.
