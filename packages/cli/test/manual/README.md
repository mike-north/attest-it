# Manual Testing Guide

This directory contains manual integration tests for attest-it, including tests for platform-specific integrations (1Password, macOS Keychain) and visual verification of the CLI interface.

## Two-Level Seal Architecture

The manual tests use a **two-level seal architecture** to ensure test integrity:

### Level 1: Ephemeral Test Seals

- Created during each test run
- Verify the test code itself (e.g., 1Password integration, Keychain integration)
- Stored in temporary test fixtures
- **Automatically created and discarded** during test execution
- Use a keypair generated for the test session

### Level 2: Meta-Seals (This Directory)

- Seal the **entire test infrastructure** (test scripts, helpers, configurations)
- Stored in `packages/cli/test/manual/.attest-it/`
- **Manually created** after visual verification confirms tests work correctly
- Use the developer's 1Password-stored identity
- Reference the repository-level `.attest-it/config.yaml` configuration

The meta-seals attest that:

1. The test scripts accurately test the intended behavior
2. The visual verification passed human inspection
3. The test infrastructure hasn't been tampered with

This creates a chain of trust:

```
Human verification → Meta-seal → Test scripts → Ephemeral seals → Test code
```

## Prerequisites

### One-Time Setup

Before running manual tests, you need to set up your developer identity:

1. **Create your signing identity**:

   ```bash
   # From repository root
   npx attest-it identity create
   ```

   Choose 1Password as your key storage provider and follow the prompts.

2. **Add yourself to the project team**:

   ```bash
   npx attest-it team join
   ```

   This will add your public key to `.attest-it/config.yaml` and prompt you to authorize yourself for the manual-tests gate.

3. **Verify 1Password CLI is installed and authenticated**:
   ```bash
   op --version
   op account list
   ```

### Environment Requirements

- **macOS**: Required for Keychain integration tests
- **1Password CLI**: Required for 1Password integration tests
- **Terminal**: At least 80 columns wide, color support recommended
- **Node.js**: Version 20 or later
- **pnpm**: Package manager used by this project

## Running Tests

All manual test scripts are invoked via npm scripts for convenience:

### Visual Verification Test

Tests the CLI interface by running interactive scenarios and prompting for human verification:

```bash
pnpm test:manual:visual [scenario]
```

**Available scenarios:**

- `multi-suite` (default) - Project with 5 suites in various states
- `all-missing` - All suites missing attestations
- `complex` - Complex groups structure with 6 suites
- `failing` - Project with failing test suite
- `all` - Run all scenarios in sequence

**What to verify:**

- Status badges display correctly (VALID, MISSING, EXPIRED, CHANGED)
- Colors render properly (green, yellow, red)
- No visual artifacts or rendering glitches
- Interactive keyboard controls work (arrows, space, enter)
- Suite selection UI is clear and functional
- Progress indicators display properly
- Error messages are readable and well-formatted

### 1Password Integration Test

Tests integration with 1Password for key storage:

```bash
pnpm test:manual:1password
```

**Prerequisites:**

- 1Password CLI installed and authenticated
- Developer identity set up in 1Password (see One-Time Setup above)

**What it tests:**

- Keygen with 1Password storage
- Signing attestations using 1Password-stored keys
- Key retrieval from 1Password
- Error handling for missing/invalid 1Password items

### Keychain Integration Test

Tests integration with macOS Keychain for key storage:

```bash
pnpm test:manual:keychain
```

**Prerequisites:**

- Running on macOS
- Keychain Access permissions granted

**What it tests:**

- Keygen with Keychain storage
- Signing attestations using Keychain-stored keys
- Key retrieval from Keychain
- Error handling for missing/invalid Keychain items

### YubiKey Integration Test

Tests integration with YubiKey for key storage:

```bash
pnpm test:manual:yubikey
# or with --no-cleanup to keep artifacts for inspection
pnpm test:manual:yubikey -- --no-cleanup
```

**Prerequisites:**

- YubiKey Manager CLI (`ykman`) installed
- YubiKey connected with HMAC challenge-response configured on slot 2
- Configure with: `ykman otp chalresp --generate 2`

**What it tests:**

- Detection and selection of connected YubiKeys
- Key generation with YubiKey challenge-response encryption
- Signing attestations using YubiKey-encrypted keys
- Key retrieval/decryption via YubiKey
- Error handling for unconfigured or missing YubiKeys

**Exit codes:**

- `0`: Success
- `1`: Test failure
- `78`: Configuration error (no YubiKey, not configured, ykman not installed)

**Troubleshooting:**

- "ykman not found" - Install YubiKey Manager: `brew install ykman` (macOS), `pip install yubikey-manager` (Linux)
- "Slot 2 not configured" - Run: `ykman otp chalresp --generate 2` (⚠️ overwrites slot 2)
- Multiple YubiKeys - The test will prompt you to select which one to use

## Creating Meta-Seals

After running manual tests and confirming they work correctly, create meta-seals to attest to the test infrastructure:

### 1. Run All Manual Tests

First, verify that all manual tests pass:

```bash
# Visual verification
pnpm test:manual:visual all

# Platform integrations (on macOS with 1Password and YubiKey)
pnpm test:manual:1password
pnpm test:manual:keychain
pnpm test:manual:yubikey
```

### 2. Review Changes

Ensure all test code changes are committed:

```bash
git status
git diff packages/cli/test/manual/
```

### 3. Create the Meta-Seal

From the repository root, create a seal for the manual test infrastructure:

```bash
# Assuming you have a suite configured for manual tests in .attest-it/config.yaml
npx attest-it run --suite manual-tests

# Or manually specify the test command
npx attest-it seal \
  --paths "packages/cli/test/manual/**" \
  --command "pnpm test:manual:visual all" \
  --provider 1password \
  --account your-email@example.com \
  --vault "Development" \
  --item-name "attest-it-signing-key"
```

### 4. Commit the Meta-Seal

```bash
git add packages/cli/test/manual/.attest-it/
git commit -m "chore: update manual test meta-seals"
```

### 5. Verify in CI

The CI workflow will automatically verify meta-seals as part of the build:

```yaml
- name: Verify manual test seals
  run: npx attest-it verify
```

## Configuration

The manual tests reference the repository-level configuration at `.attest-it/config.yaml`.

### Key Configuration Sections

**Team members** (who can create seals):

```yaml
team:
  your-username:
    name: Your Name
    publicKey: <your-public-key>
```

**Gates** (for verification):

```yaml
gates:
  manual-tests:
    name: Manual Test Infrastructure
    description: Manual integration and visual tests
    authorizedSigners:
      - your-username
    fingerprint:
      paths:
        - packages/cli/test/manual/**
    maxAge: 90d # Meta-seals can be longer-lived
```

**Suites** (for running):

```yaml
suites:
  manual-tests:
    description: Manual test infrastructure
    gate: manual-tests
    packages:
      - packages/cli/test/manual
    command: pnpm test:manual:visual all
```

## Troubleshooting

### 1Password Authentication Issues

If you encounter authentication errors:

```bash
# Check 1Password CLI status
op account list

# Sign in if needed
op signin

# Verify you can access the item
op item get "attest-it-signing-key" --vault "Development"
```

### Keychain Access Denied

If Keychain access is denied:

1. Open **Keychain Access** app
2. Go to **Preferences** → **Security**
3. Ensure "Confirm before allowing access" is enabled
4. When prompted, click "Always Allow" for Node.js

### Visual Artifacts in Terminal

If you see rendering issues:

1. Ensure terminal is at least 80 columns wide
2. Try a different terminal emulator (iTerm2, Terminal.app, etc.)
3. Check that `$TERM` is set correctly (e.g., `xterm-256color`)

### Meta-Seal Verification Failures

If CI fails to verify meta-seals:

1. Ensure your public key is in `.attest-it/config.yaml`
2. Check that the seal paths match the fingerprint configuration
3. Verify the seal hasn't expired (check `maxAge` setting)
4. Ensure all sealed files are committed and haven't changed

## Best Practices

1. **Run visual verification before creating meta-seals**: Always verify the UI works correctly before sealing.

2. **Update meta-seals after changes**: Any changes to test scripts, helpers, or configurations require new meta-seals.

3. **Use longer maxAge for meta-seals**: Test infrastructure changes less frequently than application code, so 90 days is reasonable.

4. **Document test intent**: Update this README when adding new test scenarios.

5. **Keep test fixtures realistic**: Test scenarios should mirror real-world usage patterns.

## Related Documentation

- [Attest-it CLI Documentation](../../README.md)
- [Core Library Documentation](../../../core/README.md)
- [Repository Configuration](.attest-it/config.yaml)
- [GitHub Action Documentation](../../../github-action/README.md)

## Questions?

If you have questions about the manual testing process or encounter issues:

1. Check the [main documentation](../../README.md)
2. Review existing test scripts for examples
3. Open an issue on GitHub with details about your problem
