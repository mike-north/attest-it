---
'@attest-it/cli': minor
'@attest-it/core': minor
---

Add passphrase encryption option for filesystem-stored private keys

Users can now optionally encrypt their private key with a passphrase when
selecting "Local Filesystem" storage in `attest-it keygen`. This provides an
additional layer of security for users who don't have access to macOS Keychain,
1Password, or YubiKey.

Features:

- New encryption prompt after selecting filesystem storage
- Passphrase confirmation step to prevent typos
- AES-256 encryption via OpenSSL
- Clear error message when wrong passphrase is provided during signing
- Passphrase passed via stdin (not command line) for security
- Minimum 8 character passphrase requirement
