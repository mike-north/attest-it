# Getting Started with attest-it

This guide will walk you through setting up attest-it for your project.

## Prerequisites

Before you begin, ensure you have:

- **Node.js 20+**: Check with `node --version`
- **OpenSSL**: Required for key generation. Check with `openssl version`
- **Git**: For fingerprinting and change detection. Check with `git --version`
- **Package manager**: npm, pnpm, or yarn

## Installation

Add attest-it to your project:

```bash
npm install attest-it
# or
pnpm add attest-it
# or
yarn add attest-it
```

For monorepos, install at the workspace root.

## Step 1: Initialize Configuration

Run the interactive setup wizard:

```bash
npx attest-it init
```

You'll be prompted to configure:

1. **Maximum attestation age** (default: 30 days)
   - How long before attestations expire
   - Set based on your release cadence

2. **Signing algorithm** (recommended: Ed25519)
   - Ed25519: Fast, modern, secure
   - RSA: Broader compatibility with older systems

3. **Test suites** (can add multiple)
   - Suite name (e.g., "desktop-tests")
   - Description (optional)
   - Package paths (comma-separated)
   - Test command

### Example Configuration Session

```
Welcome to attest-it!
This will create a configuration file for human-gated test attestations.

? Maximum attestation age (days): 30
? Signing algorithm: Ed25519 (Recommended)

Now configure your test suites.
Suites are groups of tests that require human verification.

? Suite name: desktop-integration
? Description (optional): Tests requiring VS Code desktop app
? Package paths (comma-separated): packages/vscode-extension
? Test command: pnpm vitest packages/vscode-extension --project desktop
? Add another suite? No

✓ Configuration created at .attest-it/config.yaml

Next steps:
  1. Review and edit the configuration as needed
  2. Run: attest-it keygen
  3. Run: attest-it run --suite desktop-integration
  4. Commit the attestation file
```

This creates `.attest-it/config.yaml`:

```yaml
version: 1
settings:
  maxAgeDays: 30
  publicKeyPath: .attest-it/pubkey.pem
  attestationsPath: .attest-it/attestations.json
  algorithm: ed25519
suites:
  desktop-integration:
    description: Tests requiring VS Code desktop app
    packages:
      - packages/vscode-extension
    command: pnpm vitest packages/vscode-extension --project desktop
```

## Step 2: Generate Signing Keys

Generate a keypair for signing attestations:

```bash
npx attest-it keygen
```

Output:

```
Checking OpenSSL...
ℹ OpenSSL: OpenSSL 3.1.0 14 Mar 2023

Private key: /Users/yourname/.config/attest-it/privkey.pem
Public key: .attest-it/pubkey.pem

Generating ED25519 keypair...

✓ Keypair generated successfully!

Private key (KEEP SECRET):
  /Users/yourname/.config/attest-it/privkey.pem

Public key (commit to repo):
  .attest-it/pubkey.pem

ℹ Important: Back up your private key securely!

Next steps:
  1. git add .attest-it/pubkey.pem
  2. Update .attest-it/config.yaml publicKeyPath if needed
  3. attest-it run --suite desktop-integration
```

### Key Storage

- **Private key**: Stored in `~/.config/attest-it/privkey.pem` (outside repo)
  - Automatically set to 0600 permissions
  - Back this up securely
  - Never commit to version control

- **Public key**: Stored in `.attest-it/pubkey.pem` (in repo)
  - Commit this to your repository
  - Used by CI to verify signatures

### Custom Key Paths

You can specify custom paths:

```bash
npx attest-it keygen --output ~/my-keys/privkey.pem --public .attest-it/pubkey.pem
```

## Step 3: Commit the Public Key

Add the public key to version control:

```bash
git add .attest-it/pubkey.pem .attest-it/config.yaml
git commit -m "Add attest-it configuration and public key"
```

The `.attest-it/` directory structure should be:

```
.attest-it/
├── config.yaml       # Configuration (commit)
├── pubkey.pem        # Public key (commit)
└── attestations.json # Attestations (commit after creating)
```

## Step 4: Run Tests and Create Attestation

Run your test suite with attestation:

```bash
npx attest-it run --suite desktop-integration
```

The workflow:

1. **Fingerprint computation**: Calculates SHA-256 hash of all test files
2. **Test execution**: Runs your test command
3. **Confirmation prompt**: Asks if you want to create attestation
4. **Signature**: Signs the attestation with your private key
5. **File update**: Updates `.attest-it/attestations.json`

Example output:

```
=== Running suite: desktop-integration ===

Running: pnpm vitest packages/vscode-extension --project desktop

 ✓ packages/vscode-extension/test/integration.test.ts (3 tests)

Test Files  1 passed (1)
     Tests  3 passed (3)

✓ Tests passed!
? Create attestation? Yes

✓ Attestation created for desktop-integration
  Fingerprint: sha256:a3b8c9...
  Attested by: yourname
  Attested at: 2026-01-08T12:34:56.789Z

✓ All suites completed!

To commit: git add .attest-it/attestations.json && git commit -m "Update attestations"
```

### Skip Confirmation

To skip the confirmation prompt:

```bash
npx attest-it run --suite desktop-integration --yes
```

### Run All Suites

To run and attest all configured suites:

```bash
npx attest-it run --all
```

## Step 5: Commit the Attestation

Add the attestation file to your repository:

```bash
git add .attest-it/attestations.json
git commit -m "Add attestation for desktop-integration suite"
git push
```

## Step 6: Set Up CI Verification

Add verification to your CI pipeline. For GitHub Actions:

```yaml
# .github/workflows/ci.yml
name: CI

on: [push, pull_request]

jobs:
  verify-attestations:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Install dependencies
        run: npm install

      - name: Verify attestations
        run: npx attest-it verify
```

Or use the GitHub Action:

```yaml
- uses: attest-it/github-action@v1
  with:
    fail-on-missing: 'true'
```

See [GitHub Integration Guide](github-integration.md) for more details.

## Checking Status

View the status of all attestations:

```bash
npx attest-it status
```

Example output:

```
Attestation Status
==================

Suite: desktop-integration
Status: ✓ VALID
Fingerprint: sha256:a3b8c9...
Attested by: yourname
Attested at: 2026-01-08T12:34:56.789Z
Age: 2 days

Overall: All attestations valid
```

## Common Workflows

### Adding a New Suite

1. Edit `.attest-it/config.yaml` to add the suite
2. Run `npx attest-it run --suite new-suite-name`
3. Commit the updated attestations

### Updating Tests

When you modify test files:

1. Make your changes
2. Run `npx attest-it run --suite affected-suite`
3. Commit both code changes and new attestation

### Multiple Developers

There are two approaches for team use:

**Option A: Shared keypair (simpler)**

Share one private key among team members:

1. One developer runs `npx attest-it keygen`
2. Share the private key securely with team members (password manager, encrypted share)
3. Each developer copies the key to their `~/.config/attest-it/key.pem`
4. All attestations use the same signature

**Option B: Individual keypairs (more secure)**

Each developer has their own keypair:

1. Each developer runs `npx attest-it keygen --public .attest-it/pubkey-<username>.pem`
2. Commit all public keys to the repository
3. Configure verification to accept any valid signature (requires custom verification setup)

For most teams, Option A is recommended for simplicity. The private key should never be committed to the repository.

## Troubleshooting

### "Private key not found"

```bash
npx attest-it keygen
```

### "Working tree has uncommitted changes"

Commit or stash your changes before attesting:

```bash
git stash
npx attest-it run --suite my-suite
git stash pop
```

### "Configuration file not found"

Run `npx attest-it init` to create the configuration.

### "OpenSSL not found"

Install OpenSSL:

- macOS: `brew install openssl`
- Ubuntu: `apt-get install openssl`
- Windows: Download from [OpenSSL website](https://www.openssl.org/)

### Verification Fails in CI

Common causes:

1. Attestation file not committed
2. Public key not committed
3. Tests changed since last attestation
4. Attestation expired (exceeds maxAgeDays)

Run `npx attest-it status` locally to diagnose.

### "Signature verification failed"

The attestation file has been tampered with or signed with a different key:

1. Check that the correct public key is in the repository
2. Re-run `npx attest-it run --suite <suite>` to create a fresh attestation
3. Ensure no manual edits were made to the attestations file

### "Package path does not exist"

A configured package directory was not found:

1. Check that the paths in your config match actual directories
2. Paths are relative to the repository root
3. Run `ls` to verify the directory exists

### "Suite not found in config"

The specified suite name doesn't exist:

1. Check suite names in `.attest-it/config.yaml`
2. Suite names are case-sensitive
3. Run `npx attest-it status` to see available suites

### Error Codes Reference

| Status                | Meaning                              | Solution                           |
| --------------------- | ------------------------------------ | ---------------------------------- |
| `VALID`               | Attestation is current and verified  | No action needed                   |
| `NEEDS_ATTESTATION`   | No attestation exists for this suite | Run `attest-it run --suite <name>` |
| `FINGERPRINT_CHANGED` | Code changed since attestation       | Re-run tests and attest            |
| `EXPIRED`             | Attestation exceeds maxAgeDays       | Re-run tests and attest            |
| `SIGNATURE_INVALID`   | Signature verification failed        | Check keys, re-attest              |
| `INVALIDATED`         | Parent suite changed                 | Re-run tests and attest            |

## Next Steps

- Learn about all [configuration options](configuration.md)
- Set up [GitHub integration](github-integration.md)
- Explore [desktop test patterns](writing-desktop-tests.md)
- Configure [suite invalidation](configuration.md#suite-invalidation)

## Best Practices

1. **Attest frequently**: Run attestations after every test change
2. **Commit together**: Always commit code and attestations in the same commit
3. **Set reasonable expiry**: Match maxAgeDays to your release cadence
4. **Back up private key**: Store securely outside the repository
5. **Monitor status**: Run `npx attest-it status` regularly
6. **CI enforcement**: Always verify in CI to catch missing attestations

## Security Considerations

- Never commit the private key to version control
- Set private key permissions to 0600 (done automatically)
- Rotate keys periodically by generating new keypair
- Use Ed25519 for best security and performance
- Ensure OpenSSL is up to date

## Additional Resources

- [Configuration Reference](configuration.md)
- [CLI Command Reference](../README.md#cli-commands)
- [GitHub Integration](github-integration.md)
- [Example Tests](examples/README.md)
