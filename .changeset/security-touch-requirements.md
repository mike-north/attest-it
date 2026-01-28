---
'@attest-it/core': minor
---

Add security requirements for human interaction during signing operations:

- YubiKey: Add `-t` flag to require physical touch for challenge-response operations
- 1Password: Filter session tokens from environment to force re-authentication via Touch ID/password

These changes prevent automated agents from using cached credentials to sign attestations.
