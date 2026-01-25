# Manual Integration Test Scripts

This directory contains interactive integration test scripts for manual verification of attest-it functionality with real external services.

## Scripts

### `1password-integration.ts`

Full end-to-end integration test with 1Password CLI (`op`).

**Prerequisites:**

- Install 1Password CLI: https://developer.1password.com/docs/cli/get-started/
- Sign in to at least one 1Password account: `op account add`
- Have at least one vault accessible

**Usage:**

```bash
# Run from workspace root
pnpm --filter @attest-it/cli test:manual:1password

# Or directly with tsx
pnpm tsx packages/cli/test/manual/scripts/1password-integration.ts

# Keep test artifacts for inspection (no cleanup)
pnpm tsx packages/cli/test/manual/scripts/1password-integration.ts --no-cleanup
```

**What it does:**

1. Checks if `op` CLI is installed using `OnePasswordKeyProvider.isInstalled()`
2. Lists available 1Password accounts
3. Prompts user to select an account (or uses default if only one)
4. Lists available vaults in the selected account
5. Prompts user to select a vault for test key storage
6. Creates an ephemeral test project with a simple test suite
7. Generates an Ed25519 keypair and stores the private key in the selected 1Password vault
8. Updates the test project configuration with the test identity
9. Creates a test seal by retrieving the private key from 1Password
10. Verifies the seal passes validation
11. Cleans up: deletes the test item from 1Password and removes temp directory
12. Prints success/failure summary with checkmarks

**Exit codes:**

- `0` - All tests passed
- `1` - Test failed or error occurred

**Options:**

- `--no-cleanup` - Skip cleanup of test item and temp directory (useful for debugging)

**Expected output:**

```
================================================================================
1Password Integration Test
================================================================================
This test will:
  1. Create an ephemeral test identity with 1Password key provider
  2. Generate a keypair and store the private key in your 1Password vault
  3. Create a test seal using the stored key
  4. Verify the seal passes validation
  5. Clean up the test item from 1Password

==> Step 1: Checking if 1Password CLI is installed
✓ 1Password CLI is installed

==> Step 2: Listing 1Password accounts
✓ Found 1 account(s)

Available accounts:
  1. user@example.com (https://example.1password.com)

==> Step 3: Selecting account
✓ Using only account: user@example.com

==> Step 4: Listing vaults
✓ Found 3 vault(s)

Available vaults:
  1. Private
  2. Work
  3. Development

? Select a vault for storing the test key: ›
  Development

==> Step 5: Selecting vault for test key storage
✓ Selected vault: Development

==> Step 6: Creating ephemeral test project
✓ Project created at: /tmp/...

==> Step 7: Generating keypair and storing in 1Password
ℹ Item name: attest-it-test-1234567890
✓ Keypair generated and private key stored in 1Password
ℹ Private key ref: attest-it-test-1234567890
ℹ Public key path: /tmp/.../test-pubkey.pem
ℹ Storage: 1Password: Development/attest-it-test-1234567890

==> Step 8: Verifying key exists in 1Password
✓ Key verified in 1Password

==> Step 9: Testing key retrieval
✓ Key retrieved successfully from 1Password
ℹ Temporary key path: /tmp/...
✓ Temporary key cleaned up

==> Step 10: Creating test seal with 1Password key
ℹ Fingerprint: abc123...
✓ Seal created successfully
✓ Seal written to disk

==> Step 11: Verifying the seal
✓ Seal verification passed!
ℹ Sealed by: test-user
ℹ Sealed at: 2026-01-14T...

================================================================================
✓ All tests passed!
================================================================================

==> Cleanup: Removing test artifacts
✓ Deleted 1Password item: attest-it-test-1234567890
✓ Removed temporary project
```

### `keychain-integration.ts`

Full end-to-end integration test with macOS Keychain.

**Prerequisites:**

- macOS operating system
- Keychain access (may prompt for password if needed)

**Usage:**

```bash
# Run from workspace root
pnpm --filter @attest-it/cli test:manual:keychain

# Or directly with tsx
pnpm tsx packages/cli/test/manual/scripts/keychain-integration.ts
```

**What it does:**

1. Checks platform is macOS using `MacOSKeychainKeyProvider.isAvailable()`
2. Creates an ephemeral test identity with Keychain as key provider
3. Generates unique item name like `attest-it-test-{timestamp}`
4. Generates Ed25519 keypair and stores private key in Keychain
5. Verifies key exists in Keychain using `provider.keyExists()`
6. Sets up minimal test project config in temp directory
7. Computes fingerprint of test source files
8. Creates a test seal by retrieving the private key from Keychain
9. Verifies the seal passes validation
10. Cleans up: deletes test key from Keychain using `security delete-generic-password`
11. Removes temporary directory
12. Prints success/failure summary with checkmarks

**Exit codes:**

- `0` - All tests passed
- `1` - Test failed or error occurred
- `78` - Not running on macOS (EX_CONFIG)

**Expected output:**

```
================================================================================
macOS Keychain Integration Test
================================================================================

→ Checking platform compatibility...
✓ Running on macOS
→ Using test item name: attest-it-test-1234567890
→ Creating MacOS Keychain key provider...
✓ Key provider created
→ Creating temporary test project...
✓ Test project: /tmp/attest-it-keychain-test-xxx
→ Generating keypair and storing in Keychain...
✓ Public key: /tmp/.../test-pubkey.pem
✓ Private key: macOS Keychain: attest-it-test-1234567890
→ Verifying key exists in Keychain...
✓ Key verified in Keychain
→ Reading public key...
✓ Public key read successfully
→ Creating test project configuration...
✓ Configuration created
→ Creating test source files...
✓ Test files created
→ Computing fingerprint...
✓ Fingerprint: sha256:abc123... (1 files)
→ Retrieving private key from Keychain for signing...
✓ Private key retrieved from Keychain
→ Creating test seal...
✓ Seal created at 2026-01-14T...
→ Writing seal to seals.json...
✓ Seal written to file
→ Verifying seal...
✓ Seal verification passed
→ Cleaning up temporary private key file...
✓ Temporary key file cleaned up

================================================================================
✓ All tests passed!
================================================================================

Cleaning up...
→ Deleting test key from Keychain...
✓ Test key deleted from Keychain
→ Removing temporary directory...
✓ Temporary directory removed
Cleanup complete
```

### `yubikey-integration.ts`

Full end-to-end integration test with YubiKey hardware tokens.

**Prerequisites:**

- YubiKey Manager CLI (`ykman`) installed: https://developers.yubico.com/yubikey-manager/
- YubiKey connected with HMAC challenge-response configured on slot 2
- Configure slot 2: `ykman otp chalresp --generate 2` (⚠️ overwrites slot 2 if already configured)

**Usage:**

```bash
# Run from workspace root
pnpm --filter @attest-it/cli test:manual:yubikey

# Or directly with tsx
pnpm tsx packages/cli/test/manual/scripts/yubikey-integration.ts

# Keep test artifacts for inspection (no cleanup)
pnpm tsx packages/cli/test/manual/scripts/yubikey-integration.ts --no-cleanup
```

**What it does:**

1. Checks if `ykman` CLI is installed using `YubiKeyProvider.isInstalled()`
2. Detects connected YubiKeys with their serial numbers
3. Prompts user to select a YubiKey if multiple are connected
4. Verifies slot 2 is configured for HMAC challenge-response
5. Creates an ephemeral test project with a simple test suite
6. Generates an Ed25519 keypair encrypted with YubiKey challenge-response
7. Stores the encrypted private key in the test project
8. Updates the test project configuration with the test identity
9. Creates a test seal by decrypting the private key via YubiKey
10. Verifies the seal passes validation
11. Cleans up: removes encrypted key file and temporary directory
12. Prints success/failure summary with checkmarks

**Exit codes:**

- `0` - All tests passed
- `1` - Test failed or error occurred
- `78` - Configuration error (no YubiKey, slot 2 not configured, ykman not installed) - EX_CONFIG

**Options:**

- `--no-cleanup` - Skip cleanup of encrypted key file and temp directory (useful for debugging)

**Expected output:**

```
================================================================================
YubiKey Integration Test
================================================================================
This test will:
  1. Create an ephemeral test identity with YubiKey encryption
  2. Generate a keypair encrypted with YubiKey challenge-response (slot 2)
  3. Create a test seal using the YubiKey-encrypted key
  4. Verify the seal passes validation
  5. Clean up the test artifacts

==> Step 1: Checking if YubiKey Manager CLI is installed
✓ YubiKey Manager CLI is installed

==> Step 2: Detecting connected YubiKeys
✓ Found 1 YubiKey(s)

Connected YubiKeys:
  1. YubiKey 5C NFC - Serial: 12345678

==> Step 3: Selecting YubiKey
✓ Using YubiKey: Serial 12345678

==> Step 4: Verifying slot 2 is configured
✓ Slot 2 is configured for HMAC challenge-response

==> Step 5: Creating ephemeral test project
✓ Project created at: /tmp/...

==> Step 6: Generating keypair with YubiKey encryption
ℹ YubiKey serial: 12345678
✓ Keypair generated and encrypted with YubiKey
ℹ Encrypted key path: /tmp/.../test-privkey.enc
ℹ Public key path: /tmp/.../test-pubkey.pem
ℹ Storage: YubiKey-encrypted (Serial: 12345678, Slot: 2)

==> Step 7: Verifying encrypted key file exists
✓ Encrypted key verified

==> Step 8: Testing key decryption
✓ Key decrypted successfully with YubiKey
ℹ Temporary decrypted key path: /tmp/...
✓ Temporary key cleaned up

==> Step 9: Creating test seal with YubiKey-encrypted key
ℹ Fingerprint: abc123...
✓ Seal created successfully
✓ Seal written to disk

==> Step 10: Verifying the seal
✓ Seal verification passed!
ℹ Sealed by: test-user
ℹ Sealed at: 2026-01-24T...

================================================================================
✓ All tests passed!
================================================================================

==> Cleanup: Removing test artifacts
✓ Deleted encrypted key file
✓ Removed temporary project
```

**Troubleshooting:**

- **"ykman not found"**: Install YubiKey Manager
  - macOS: `brew install ykman`
  - Linux: `pip install yubikey-manager`
  - Windows: Download from https://www.yubico.com/support/download/yubikey-manager/

- **"Slot 2 not configured"**: Configure slot 2 with:

  ```bash
  ykman otp chalresp --generate 2
  ```

  ⚠️ Warning: This will overwrite any existing configuration in slot 2

- **"No YubiKey detected"**:
  - Ensure YubiKey is physically connected
  - Try unplugging and reconnecting
  - Check USB port/connection
  - Verify with: `ykman list`

- **Multiple YubiKeys**: The script will prompt you to select which one to use

### `visual-verification.ts`

Visual verification test wrapper that runs the manual-test-runner.ts with pre-flight and post-verification checklists.

**Prerequisites:**

- Terminal with at least 80 columns width
- Color-capable terminal
- Time to complete visual verification (10-15 minutes)

**Usage:**

```bash
# Run from workspace root
pnpm --filter @attest-it/cli test:manual:visual

# Or directly with tsx
pnpm tsx packages/cli/test/manual/scripts/visual-verification.ts

# Run specific scenario
pnpm tsx packages/cli/test/manual/scripts/visual-verification.ts all-missing
```

**Available scenarios:**

- `multi-suite` (default) - Project with 5 suites in various states
- `all-missing` - All suites missing attestations
- `complex` - Complex groups structure with 6 suites
- `failing` - Project with failing test suite
- `all` - Run all scenarios in sequence

**What it does:**

1. Displays pre-flight checklist for terminal requirements
2. Prompts user to confirm readiness to proceed
3. Runs the manual-test-runner.ts with the selected scenario
4. User interacts with the CLI to test various commands
5. Displays post-verification checklist of items to verify
6. Prompts user to confirm all visual checks passed
7. Exits with code 0 if passed, non-zero if failed

**Exit codes:**

- `0` - User confirmed all visual verification checks passed
- `1` - User indicated tests failed, cancelled, or script error

**Items verified:**

- Status badges display correctly (VALID, MISSING, EXPIRED, CHANGED)
- Colors render properly (green, yellow, red)
- No visual artifacts or rendering glitches
- Interactive keyboard controls work (arrows, space, enter)
- Suite selection UI is clear and functional
- Progress indicators display properly
- Error messages are readable and well-formatted
- All test scenarios completed without crashes

**Expected flow:**

```
================================================================================
Visual Verification Test - Pre-Flight Checklist
================================================================================

Before running the visual verification, please ensure:

  1. Terminal has sufficient width (at least 80 columns recommended)
  2. Terminal supports color output
  3. You have time to complete the visual verification (approximately 10-15 minutes)
  4. You are familiar with the expected CLI behavior

================================================================================
? Are you ready to proceed with visual verification? › (Y/n)

[Manual test runner launches and user tests interactively]

================================================================================
Visual Verification Test - Post-Verification Checklist
================================================================================

Please confirm that you verified the following:

  1. Status badges display correctly (VALID, MISSING, EXPIRED, CHANGED)
  2. Colors render properly (green for valid, yellow for warnings, red for errors)
  3. No visual artifacts or rendering glitches
  4. Interactive keyboard controls work (arrow keys, space, enter)
  5. Suite selection UI is clear and functional
  6. Progress indicators display properly
  7. Error messages are readable and well-formatted
  8. All test scenarios completed without crashes

================================================================================
? Did all visual verification checks pass? › (y/N)

✓ Visual verification completed successfully!
```

## Development

These scripts use:

- `@inquirer/prompts` for interactive prompts
- `@attest-it/core` for crypto and seal operations
- `execa` for running CLI commands
- `fixturify-project` for creating temporary test projects
- Built-in Node.js ANSI color codes for terminal output

## Adding New Scripts

When adding a new manual test script:

1. Create the script in this directory with a `.ts` extension
2. Make it executable: `chmod +x script-name.ts`
3. Add a shebang: `#!/usr/bin/env tsx`
4. Add a script entry in `packages/cli/package.json`:
   ```json
   "test:manual:scriptname": "tsx test/manual/scripts/script-name.ts"
   ```
5. Document the script in this README
6. Follow the pattern of interactive prompts, clear step-by-step output, and thorough cleanup

## Troubleshooting

### 1Password CLI not found

If you get "1Password CLI (op) is not installed", ensure:

- The `op` CLI is installed
- It's in your PATH
- You can run `op --version` successfully

### No accounts found

If you get "No 1Password accounts found":

- Sign in with: `op account add`
- Verify with: `op account list`

### Permission errors

If you get permission errors accessing 1Password:

- Ensure you're signed in: `op signin`
- Check vault access permissions
- Try using a different vault

### Test failures

If the integration test fails:

- Use `--no-cleanup` to inspect artifacts
- Check the 1Password item was created
- Verify the temporary project structure
- Look at the seal verification error message
