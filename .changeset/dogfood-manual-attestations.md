---
'@attest-it/cli': minor
---

Add manual attestation-gated tests that dogfood the project's own GitHub Action. This includes a new YubiKey integration test script and CI workflow that verifies manual test attestations on PRs to main. The system ensures humans have actually run and verified credential store integrations (1Password, macOS Keychain, YubiKey) work before code can be merged.
