---
'@attest-it/core': minor
'@attest-it/cli': minor
---

Add 1Password and macOS Keychain key providers for secure private key storage

This release introduces support for storing private signing keys in 1Password or macOS Keychain, providing more secure alternatives to filesystem storage. Keys are retrieved on-demand with biometric authentication (Touch ID) when available.

**New Features:**

- **KeyProvider abstraction**: Extensible interface for pluggable key storage backends
- **1Password provider**: Store and retrieve private keys from 1Password vaults via the `op` CLI
- **macOS Keychain provider**: Store and retrieve private keys from the macOS login keychain
- **Interactive keygen**: New interactive mode in `keygen` command for selecting storage provider and configuration
- **Backward compatible**: Existing filesystem-based key storage continues to work unchanged

**Usage:**

```bash
# Interactive key generation (auto-detects available providers)
attest-it keygen

# Non-interactive with 1Password
attest-it keygen --provider 1password --vault Private --item-name my-signing-key

# Non-interactive with macOS Keychain
attest-it keygen --provider macos-keychain --item-name my-signing-key
```

**Configuration:**

```yaml
# 1Password
settings:
  publicKeyPath: .attest-it/pubkey.pem
  keyProvider:
    type: 1password
    options:
      vault: Private
      itemName: attest-it-private-key
      account: user@example.com  # optional, for multi-account setups

# macOS Keychain
settings:
  publicKeyPath: .attest-it/pubkey.pem
  keyProvider:
    type: macos-keychain
    options:
      itemName: attest-it-private-key
```

**Requirements:**

- 1Password: `op` CLI must be installed and authenticated
- macOS Keychain: Only available on macOS (`process.platform === 'darwin'`)
- Touch ID or password authentication when signing
