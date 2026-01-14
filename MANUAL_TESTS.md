# Manual Testing Guide for Key Providers

This document describes manual testing procedures for key provider integrations that cannot be fully automated in CI due to their interaction with external systems (1Password, macOS Keychain).

## Prerequisites

### For 1Password Testing
- [ ] 1Password CLI (`op`) installed: `brew install --cask 1password-cli`
- [ ] 1Password desktop app installed and running
- [ ] CLI integration enabled in 1Password settings
- [ ] Signed in to at least one 1Password account

### For macOS Keychain Testing
- [ ] Running on macOS
- [ ] Access to the login keychain

---

## 1Password Key Provider Tests

### Test 1: Detect 1Password CLI Installation

**Steps:**
1. Run `attest-it keygen` in a test project
2. Verify that "1Password" appears as a storage option

**Expected Result:**
- 1Password should be listed if `op --version` succeeds
- If not installed, only "Local Filesystem" should appear

### Test 2: Interactive Key Generation with 1Password

**Steps:**
1. Create a test project with a basic `.attest-it/config.yaml`
2. Run `attest-it keygen`
3. Select "1Password" as the storage provider
4. Select an account (if multiple)
5. Select a vault
6. Enter an item name (e.g., "attest-it-test-key")
7. Verify Touch ID/password prompt appears

**Expected Result:**
- Public key created at `.attest-it/pubkey.pem`
- Private key stored in 1Password vault as a document
- Config updated with `keyProvider` settings
- No private key file on disk

**Verification:**
```bash
# Verify public key exists
ls -la .attest-it/pubkey.pem

# Verify no private key on disk
ls -la ~/.config/attest-it/private.pem  # Should not exist

# Verify key in 1Password
op document get "attest-it-test-key" --vault <your-vault>
```

### Test 3: Non-Interactive Key Generation

**Steps:**
```bash
attest-it keygen \
  --provider 1password \
  --vault "Private" \
  --item-name "attest-it-cli-test" \
  --output .attest-it/pubkey.pem \
  --force
```

**Expected Result:**
- Key generation completes without prompts
- Touch ID/password prompt for 1Password access
- Public key created, private key in 1Password

### Test 4: Signing with 1Password Provider

**Steps:**
1. Set up a test project with 1Password key provider configured
2. Create a simple test suite in config
3. Run `attest-it run --suite <suite-name> --yes`

**Expected Result:**
- Touch ID/password prompt appears when accessing private key
- Test runs successfully
- Attestation created and signed
- Signature verification passes

**Verification:**
```bash
attest-it verify --suite <suite-name>
```

### Test 5: Key Not Found Error

**Steps:**
1. Configure a non-existent key reference in config
2. Run `attest-it run --suite <suite-name>`

**Expected Result:**
- Clear error message: `Key not found in 1Password: "<key-name>" (vault: <vault>)`
- No crash or cryptic error

---

## macOS Keychain Key Provider Tests

### Test 1: Platform Detection

**Steps:**
1. Run on macOS: `attest-it keygen` should show "macOS Keychain" option
2. Run on Linux: "macOS Keychain" should NOT appear

**Expected Result:**
- Option only available on macOS (`process.platform === 'darwin'`)

### Test 2: Interactive Key Generation with Keychain

**Steps:**
1. Create a test project
2. Run `attest-it keygen`
3. Select "macOS Keychain" as the storage provider
4. Enter an item name (e.g., "attest-it-test-key")

**Expected Result:**
- Public key created at `.attest-it/pubkey.pem`
- Private key stored in login keychain
- May prompt for keychain access permission

**Verification:**
```bash
# Verify key exists in keychain
security find-generic-password -a "attest-it" -s "attest-it-test-key"
```

### Test 3: Non-Interactive Key Generation

**Steps:**
```bash
attest-it keygen \
  --provider macos-keychain \
  --item-name "attest-it-cli-test" \
  --output .attest-it/pubkey.pem \
  --force
```

**Expected Result:**
- Key generation completes
- May prompt for keychain access
- Public key created, private key in keychain

### Test 4: Signing with Keychain Provider

**Steps:**
1. Configure keychain provider in test project
2. Run `attest-it run --suite <suite-name> --yes`

**Expected Result:**
- May prompt for keychain access
- Test runs and attestation created
- Signature verifies correctly

### Test 5: Key Retrieval and Cleanup

**Steps:**
1. Enable debug logging
2. Run a signing operation
3. Check that no temp files remain after completion

**Expected Result:**
- Temp file created during signing
- Temp file deleted after signing completes
- No key material left on disk

---

## Cleanup After Testing

### Remove 1Password Test Keys
```bash
op document delete "attest-it-test-key" --vault <your-vault>
op document delete "attest-it-cli-test" --vault <your-vault>
```

### Remove Keychain Test Keys
```bash
security delete-generic-password -a "attest-it" -s "attest-it-test-key"
security delete-generic-password -a "attest-it" -s "attest-it-cli-test"
```

---

## When to Re-run Manual Tests

Manual tests should be re-run when:

1. **Code changes** to any of these files:
   - `packages/core/src/key-provider/one-password-provider.ts`
   - `packages/core/src/key-provider/macos-keychain-provider.ts`
   - `packages/cli/src/commands/keygen.ts`
   - `packages/cli/src/commands/keygen-interactive.tsx`

2. **Dependency updates** affecting:
   - Node.js version
   - 1Password CLI version
   - macOS version

3. **Before releases** that include key provider changes

---

## Reporting Issues

If manual tests fail, please file an issue with:

1. Operating system and version
2. 1Password CLI version (if applicable): `op --version`
3. Node.js version: `node --version`
4. Full error message and stack trace
5. Steps to reproduce
