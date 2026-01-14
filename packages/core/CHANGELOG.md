# @attest-it/core

## 0.4.0

### Minor Changes

- 2720f52: Add 1Password and macOS Keychain key providers for secure private key storage

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

- 462d0db: Implement attest-it v2.0 specification with identity system, Ed25519 cryptography, and gate-based seals

  This is a major release that introduces a new architecture for cryptographic attestation with breaking changes from v1.x.

  **Breaking Changes:**
  - Fingerprint algorithm separator changed from `\0` to `:` - existing attestations will not verify
  - CLI `verify` and `status` commands now work with gates/seals instead of suites/attestations
  - New local identity configuration required at `~/.config/attest-it/config.yaml`
  - Project configuration now uses `team` and `gates` sections

  **New Features:**
  - **Identity System**: Local identity management with support for multiple identities
    - Commands: `identity list`, `identity create`, `identity use`, `identity show`, `identity edit`, `identity remove`, `identity export`
    - `whoami` command to show active identity
    - Support for file, macOS Keychain, and 1Password key storage backends
  - **Ed25519 Cryptography**: Modern elliptic curve cryptography using Node.js native crypto
    - `generateEd25519KeyPair()`, `signEd25519()`, `verifyEd25519()`, `getPublicKeyFromPrivate()`
    - 32-byte public keys encoded as Base64
  - **Team and Authorization**: Per-gate authorization with team member public keys
    - Team members defined in project config with public keys
    - Gates specify `authorizedSigners` array of team member slugs
    - Authorization functions: `isAuthorizedSigner()`, `getAuthorizedSignersForGate()`, `findTeamMemberByPublicKey()`
  - **Seal System**: Cryptographic seals for gates replacing attestations
    - Verification states: `VALID`, `MISSING`, `STALE`, `FINGERPRINT_MISMATCH`, `INVALID_SIGNATURE`, `UNKNOWN_SIGNER`
    - `seal` command to create seals for gates
    - Updated `verify` and `status` commands for seal verification
  - **Team Management CLI**: Commands to manage team members in project config
    - Commands: `team list`, `team add`, `team edit`, `team remove`

  **Configuration:**

  ```yaml
  # Project config (.attest-it/config.yaml)
  version: 1

  team:
    alice:
      name: Alice Smith
      email: alice@example.com
      publicKey: <base64-ed25519-public-key>

  gates:
    unit-tests:
      name: Unit Tests
      description: All unit tests pass
      authorizedSigners: [alice]
      fingerprint:
        paths: ['src/**/*.ts', 'test/**/*.ts']
        exclude: ['**/*.d.ts']
      maxAge: 30d
  ```

  ```yaml
  # Local config (~/.config/attest-it/config.yaml)
  activeIdentity: work
  identities:
    work:
      name: Alice Smith
      email: alice@example.com
      publicKey: <base64-ed25519-public-key>
      privateKey:
        type: keychain
        service: attest-it-work
        account: alice
  ```

  **Migration:**

  Users upgrading from v1.x will need to:
  1. Create a local identity: `attest-it identity create`
  2. Add team members to project config with their public keys
  3. Define gates with authorized signers
  4. Re-seal all gates (existing attestations will not verify)

## 0.2.0

### Patch Changes

- b5e5769: Add interactive mode for `attest-it run` with suite selection

  **New Features:**
  - Interactive suite selection UI when `attest-it run` is invoked without `--suite` or `--all`
  - Status display with colored badges: MISSING, STALE, CHANGED, VALID
  - New CLI options: `--dry-run`, `--continue`, `--filter <pattern>`
  - Session persistence in `.attest-it/session.json` for resumable interrupted runs
  - Suite dependencies via `depends_on` config with automatic topological sorting
  - Suite groups for batch selection

  **Breaking Changes:**
  - **Default behavior change:** `attest-it run` without flags now enters interactive mode instead of erroring
  - Exit code 2 now means "no work needed" (all suites valid)
  - Exit code 3 is now CONFIG_ERROR (was 2)
  - Exit code 4 is now CANCELLED (was 3)
  - Exit code 5 is now MISSING_KEY (was 4)

  **Dependencies:**
  - Replaced `picocolors` with `chromaterm` for terminal colors
  - Added `ink` and `react` for interactive TUI components
  - Added `ink-testing-library` for component testing (dev)

## 0.0.2

### Patch Changes

- 2fde289: Fix package release so that pnpm workspaces references are replaced by actual semver version specifiers
- 2fde289: Fix dependency references
