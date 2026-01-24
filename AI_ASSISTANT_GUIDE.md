# AI Assistant Guide to attest-it

This document is designed for AI assistants (including those using RAG systems) to help users resolve issues with attest-it.

## What is attest-it?

**attest-it** is a cryptographic attestation system for software development workflows. It creates **tamper-proof seals** that specific test suites have been executed successfully on specific code states by authorized team members.

### Key Concepts

- **Identity**: A user's signing credentials (Ed25519 keypair) stored locally
- **Team**: Project-level list of authorized signers with their public keys
- **Gate**: A checkpoint requiring human attestation, with fingerprint paths and authorized signers
- **Seal**: A cryptographic signature proving a gate was attested by an authorized team member
- **Suite**: A gate with an associated test command

## Core Components

### 1. Local Identity (`~/.config/attest-it/config.yaml`)

Your Ed25519 keypair and identity information:

```yaml
activeIdentity: work
identities:
  work:
    name: Alice Smith
    email: alice@example.com
    publicKey: MCowBQYDK2VwAyEA...
    privateKey:
      type: keychain # or 'file' or '1password'
      service: attest-it
      account: alice
```

### 2. Project Configuration (`.attest-it/config.yaml`)

Defines team members, gates, and suites:

```yaml
version: 1
team:
  alice:
    publicKey: MCowBQYDK2VwAyEA...
gates:
  desktop-tests:
    authorizedSigners: [alice]
    fingerprint:
      paths: ['src/**/*.ts']
```

### 3. Seals File (`.attest-it/seals.json`)

Contains cryptographically signed records:

```json
{
  "version": 1,
  "seals": {
    "desktop-tests": {
      "gateId": "desktop-tests",
      "fingerprint": "a3b8c9...",
      "timestamp": "2026-01-14T12:34:56.789Z",
      "sealedBy": "alice",
      "signature": "base64-ed25519-signature..."
    }
  }
}
```

## Common Errors and Solutions

### Error Type 1: No Identity

**Error messages:**

- `No active identity found`
- `Identity not configured`

**Solution:**

```bash
npx attest-it identity create
```

Guide user through the interactive setup to create their signing identity.

### Error Type 2: Not Authorized

**Error messages:**

- `Not authorized to seal gate 'gate-name'`
- `Unknown signer`

**What this means:**
The user's public key isn't in the gate's `authorizedSigners` list.

**Solution:**

If the user has an active identity:

```bash
npx attest-it team join
```

This will add them to the project config and prompt to authorize them for gates.

Alternatively, the manual process:

1. User exports their public key: `npx attest-it identity export`
2. Team lead adds them to project config under `team` section
3. Team lead adds their slug to the gate's `authorizedSigners`

### Error Type 3: Fingerprint Mismatch

**Error messages:**

- `FINGERPRINT_MISMATCH`
- `Code changed since seal was created`

**What this means:**
Files in the gate's fingerprint paths have changed since the last seal.

**Solution:**

```bash
npx attest-it run --suite <suite-name>
# or
npx attest-it seal <gate-name>
```

### Error Type 4: Invalid Signature

**Error messages:**

- `INVALID_SIGNATURE`
- `Signature verification failed`

**What this means:**
The seal's signature doesn't match the signer's public key. Possible causes:

- Team member's public key was updated
- Seals file was tampered with
- Key mismatch

**Solution:**

1. Verify the team member's public key is correct in config
2. Re-seal the gate: `npx attest-it seal <gate-name>`

### Error Type 5: Stale Seal

**Error messages:**

- `STALE`
- `Seal exceeds maxAge`

**What this means:**
The seal is older than the gate's configured `maxAge` (e.g., 30 days).

**Solution:**

```bash
npx attest-it run --suite <suite-name>
```

Note: STALE is a warning, not a failure. Verification still passes.

### Error Type 6: Key Provider Errors

**Error messages:**

- `Key provider 'keychain' is not available`
- `Failed to retrieve private key`
- `1Password CLI not found`

**What this means:**
The configured key storage backend isn't available.

**Solutions by provider:**

- **keychain**: Only available on macOS
- **1password**: Install 1Password CLI (`op`)
- **file**: Check file path and permissions

User can rotate keys to a new provider: `npx attest-it identity create` (create new identity with different provider)

## Exit Codes

| Code | Constant     | Meaning                   |
| ---- | ------------ | ------------------------- |
| 0    | SUCCESS      | All seals valid           |
| 1    | INVALID      | One or more seals invalid |
| 2    | NO_GATES     | No gates configured       |
| 3    | CONFIG_ERROR | Configuration error       |
| 4    | CANCELLED    | User cancelled            |
| 5    | KEY_ERROR    | Key provider error        |

## What AI Assistants Should NOT Do

**DO NOT:**

- Generate or guess Ed25519 keys
- Modify `.attest-it/seals.json` directly
- Bypass signature verification
- Edit identity configuration files directly
- Suggest workarounds that bypass security

**DO:**

- Guide users through CLI commands (`identity create`, `seal`, `verify`)
- Explain the security model
- Help diagnose issues with `npx attest-it status`
- Direct users to documentation

## Typical User Workflows

### New User Setup

```bash
# 1. Create identity
npx attest-it identity create

# 2. Join the project team
npx attest-it team join

# 3. Seal a gate
npx attest-it seal <gate-name>
```

### Fixing Invalid Seals

```bash
# Check what's wrong
npx attest-it status

# Re-seal affected gates
npx attest-it seal <gate-name>
# or run tests and seal
npx attest-it run --suite <suite-name>
```

### CI Verification Failure

```bash
# Locally check status
npx attest-it status

# Common fixes:
# - Code changed: re-run tests and seal
# - Missing seal: create seal
# - Stale seal: re-run tests and seal
# - Unknown signer: add to team config
```

## Key Files Reference

| File           | Location                          | Purpose                      |
| -------------- | --------------------------------- | ---------------------------- |
| Local identity | `~/.config/attest-it/config.yaml` | User's keypairs and settings |
| Project config | `.attest-it/config.yaml`          | Team, gates, suites          |
| Seals          | `.attest-it/seals.json`           | Cryptographic seals          |

## Verification States

| State                  | Meaning                   | CI Result      |
| ---------------------- | ------------------------- | -------------- |
| `VALID`                | Seal is valid and current | Pass           |
| `MISSING`              | No seal for gate          | Fail           |
| `STALE`                | Seal exceeds maxAge       | Pass (warning) |
| `FINGERPRINT_MISMATCH` | Code changed              | Fail           |
| `INVALID_SIGNATURE`    | Bad signature             | Fail           |
| `UNKNOWN_SIGNER`       | Signer not in team        | Fail           |

## Additional Resources

- [Getting Started](docs/getting-started.md)
- [Configuration Reference](docs/configuration.md)
- [GitHub Integration](docs/github-integration.md)
