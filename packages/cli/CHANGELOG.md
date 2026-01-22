# @attest-it/cli

## 0.8.0

### Minor Changes

- 16ede3f: Add passphrase encryption option for filesystem-stored private keys

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

### Patch Changes

- 16ede3f: Fix three bugs discovered during dogfooding:

  **Bug 1: Gate-based suites skipped by run command**
  - The `run` command was skipping suites that reference gates via the `gate` property
  - Fixed `getAllSuiteStatuses` to look up gate config and use `fingerprint.paths` and `fingerprint.exclude`

  **Bug 2: Seal uses display name instead of identity slug**
  - The `seal` and `run` commands were using `identity.name` (display name) for `sealedBy`
  - Fixed to use `localConfig.activeIdentity` (the slug) which is the key used for team member lookup during verification

  **Bug 3: sealsPath config option not respected**
  - Seal read/write operations were hardcoded to `.attest-it/seals.json`
  - Added `sealsPath` to config schemas and updated all seal operations to accept an optional path override

  Also adds comprehensive regression tests for all three bugs to prevent future regressions.

- Updated dependencies [16ede3f]
- Updated dependencies [16ede3f]
  - @attest-it/core@0.8.0

## 0.7.0

### Minor Changes

- 1f8f8cd: Add YubiKey as a key storage option in interactive keygen flow

  Users can now select YubiKey as a private key storage provider when running
  `attest-it keygen`. The private key is encrypted using YubiKey's HMAC-SHA1
  challenge-response feature, requiring physical touch of the YubiKey to sign
  attestations.

  Features:
  - Auto-detects connected YubiKeys when ykman CLI is installed
  - Supports multiple YubiKey devices (prompts user to select)
  - Auto-selects slot if only one is configured for challenge-response
  - Offers to automatically configure HMAC-SHA1 on slot 2 if not set up

### Patch Changes

- fca2467: Fix 1Password account selection to show human-readable account names
  - Updated `listAccounts()` to fetch account details and include the human-readable name (e.g., "North Family")
  - Account selection now shows "Account Name (email)" format when available
  - Fixed crash when pressing Escape during account selection
  - Added test coverage for Escape key handling

- Updated dependencies [fca2467]
- Updated dependencies [1f8f8cd]
  - @attest-it/core@0.7.0

## 0.6.1

### Patch Changes

- e885162: Fix React "duplicate key" warning when multiple 1Password accounts share the same email address. The Select component now uses unique identifiers (user_uuid for accounts, vault ID for vaults) instead of potentially duplicate values (email, vault name).

## 0.6.0

### Minor Changes

- 745fedc: Add shell completion support and improve configuration documentation

  **CLI Package:**
  - Add shell completion for bash, zsh, and fish shells
  - Auto-detect user's shell from `$SHELL` environment variable
  - Support both `attest-it` and `attest` command aliases
  - Offer shell completion installation during `init` and `identity create` commands
  - Remember user's preference if they decline completion installation
  - Fix escape sequence corruption in fish shell completions

  **Core Package:**
  - Add user preferences system for CLI experience settings
  - Add JSON schema generation from Zod schemas (`pnpm generate:schemas`)
  - Schemas in `schemas/policy.schema.json` and `schemas/config.schema.json` now stay in sync with validation logic

  **Documentation:**
  - Simplify README configuration example with clearer gate setup
  - Rewrite docs/configuration.md as comprehensive reference with:
    - Complete field reference tables with types, defaults, and required status
    - Duration string format reference
    - Glob pattern examples
    - All key provider options documented
    - JSON schema integration instructions for VS Code
    - Troubleshooting section
  - Add documentation sync reminder comments to Zod schema files

### Patch Changes

- 4fc9cfa: Security hardening for YubiKey key provider

  **Core Package:**
  - Add Zod schema validation for encrypted key file structure with runtime type checking
  - Add Additional Authenticated Data (AAD) to AES-256-GCM encryption, binding metadata to ciphertext
  - Add path traversal protection - encrypted key paths must be within the config directory
  - Add serial number verification with security warnings when not specified
  - Add process exit handlers for temp file cleanup on SIGINT/SIGTERM
  - Remove TOCTOU (time-of-check/time-of-use) vulnerabilities in file operations
  - Sanitize error messages to prevent information leakage
  - Add buffer size validation for IV, auth tag, salt, and challenge
  - Document memory security limitations for JavaScript string handling in JSDoc

  **CLI Package:**
  - Integrate YubiKey provider into identity creation flow
  - Add YubiKey device selection when multiple keys are connected
  - Add challenge-response slot configuration guidance

- Updated dependencies [745fedc]
- Updated dependencies [9c55c10]
- Updated dependencies [4fc9cfa]
  - @attest-it/core@0.6.0

## 0.5.0

### Minor Changes

- 27e9e08: Add shell completion support and testing improvements

  ### Shell Completion (`@attest-it/cli`)
  - Add `completion` command with `install`, `uninstall` subcommands for bash, zsh, and fish shells
  - Dynamic completions for identity names, gate names, and suite names from config files
  - Uses `@pnpm/tabtab` for cross-shell completion support

  ### Testing Infrastructure (`@attest-it/core`)
  - Add hidden `--home-dir` option for isolated testing without Docker
  - New `setAttestItHomeDir()`, `getAttestItHomeDir()`, and `getAttestItConfigDir()` functions for configuring the attest-it home directory at runtime

  ### Identity Management Improvements (`@attest-it/cli`)
  - Enhanced `whoami` command to show key storage location and truncated public key
  - Enhanced `identity remove` command to show key storage location before deletion
  - Improved 1Password integration with account and vault selection prompts
  - Improved macOS Keychain integration with keychain selection
  - Added input validation for identity slugs (whitespace trimming) and email addresses

  ### macOS Keychain Improvements (`@attest-it/core`)
  - Add `listKeychains()` static method to enumerate available keychains
  - Improved keychain item naming with identity slug prefix

### Patch Changes

- Updated dependencies [27e9e08]
  - @attest-it/core@0.5.0

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

- be09e0b: Improve attestation prompt visibility and remove unsafe --yes flag

  **Visual Improvements:**
  - Add visually distinctive yellow box border around attestation confirmation prompt
  - Use box-drawing characters for clean, professional appearance
  - Makes attestation prompt stand out from test output

  **Security Enhancement:**
  - Remove `--yes` / `-y` flag that bypassed user confirmation
  - All attestations now require explicit user approval
  - Default answer changed to "No" - user must actively confirm with "y"
  - Prevents accidental or automated attestation creation

  The new prompt appears as:

  ```
  ┌────────────────────────────────────────┐
  │ Create attestation? (y/N)              │
  └────────────────────────────────────────┘
  ```

  This ensures that human verification - the core principle of attest-it - cannot be bypassed programmatically.

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

### Patch Changes

- Updated dependencies [2720f52]
- Updated dependencies [462d0db]
  - @attest-it/core@0.4.0

## 0.3.0

### Minor Changes

- 7f9d7fb: Add comprehensive interactive CLI testing infrastructure

  **New Testing Utilities:**
  - Fixture factory using fixturify-project for creating realistic test projects
  - Automated integration tests validating CLI behavior across user workflows
  - Manual test runner for visual validation and artifact detection
  - Pre-configured test scenarios (multi-suite, all-missing, complex groups, failing tests)

  **New Documentation:**
  - Complete testing guide (test/README.md) with fixture usage and debugging tips
  - Quick start guide (test/QUICKSTART.md) with step-by-step workflows
  - Interactive CLI testing guide with usage examples

  **Testing Coverage:**
  - Git working tree validation
  - Exit code handling (SUCCESS, FAILURE, NO_WORK, CONFIG_ERROR, CANCELLED, MISSING_KEY)
  - Suite filtering and selection
  - Dry run mode validation
  - User workflow scenarios (first-time use, re-attestation, nothing to do)

  This infrastructure enables systematic testing of the interactive CLI experience, including React/Ink UI components, keyboard shortcuts, status displays, and visual artifact detection.

  **AI-Friendly Error Detection:**
  - Added signature error detection wrapper to prevent AI assistants from looping on unfixable cryptographic issues
  - Wraps keygen and attestation operations with clear error messages when signature-related failures occur
  - Explicitly distinguishes signature issues (require human intervention) from other test failures (AI can help fix)
  - Prevents futile retry loops when private keys are missing, corrupted, or have permission issues
  - Created comprehensive AI Assistant Guide (`/AI_ASSISTANT_GUIDE.md`) optimized for RAG systems
  - Error messages link directly to the guide for AI assistants examining CI/CD logs

  **Fixes:**
  - Updated README exit codes table to match implementation (6 codes instead of 2)
  - Improved error handling in test helpers
  - Added project-local private key support in fixtures to avoid test conflicts
  - Enhanced `createRealAttestation()` with better error messages

## 0.2.0

### Minor Changes

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

### Patch Changes

- Updated dependencies [b5e5769]
  - @attest-it/core@0.2.0

## 0.1.0

### Minor Changes

- 49c778c: Simplified `attest-it init` command

## 0.0.2

### Patch Changes

- 2fde289: Fix package release so that pnpm workspaces references are replaced by actual semver version specifiers
- 2fde289: Fix dependency references
- Updated dependencies [2fde289]
- Updated dependencies [2fde289]
  - @attest-it/core@0.0.2
