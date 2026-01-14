---
"@attest-it/cli": minor
"@attest-it/core": minor
---

Add shell completion support and testing improvements

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
