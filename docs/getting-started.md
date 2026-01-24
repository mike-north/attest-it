# Getting Started with attest-it

This guide walks you through setting up attest-it for your project.

## Prerequisites

- **Node.js 20+**: Check with `node --version`
- **Git**: For fingerprinting. Check with `git --version`
- **Package manager**: npm, pnpm, or yarn

**Optional** (for secure key storage):

- 1Password CLI (`op`) for 1Password storage
- macOS for Keychain storage

## Installation

Add attest-it to your project:

```bash
npm install attest-it
# or
pnpm add attest-it
# or
yarn add attest-it
```

## Step 1: Create Your Identity

Your identity is your signing credentials. Run the interactive setup:

```bash
npx attest-it identity create
```

You'll configure:

1. **Identity slug** (e.g., "work", "personal")
2. **Display name and email**
3. **Key storage** - Choose where to store your private key:
   - **macOS Keychain** (recommended on macOS)
   - **1Password** (recommended for cross-device)
   - **File** (simple, less secure)

Example output:

```
Creating new identity...

? Identity slug: work
? Display name: Alice Smith
? Email: alice@example.com
? Key storage backend: macOS Keychain

Generating Ed25519 keypair...

✓ Identity 'work' created successfully!

Public key (share with team):
  MCowBQYDK2VwAyEAabc123...

Private key stored in: macOS Keychain (attest-it/work)

Next steps:
  1. Share your public key with your team lead
  2. Run: npx attest-it init (in your project)
```

Your identity is stored locally at `~/.config/attest-it/config.yaml`.

### Multiple Identities

You can have multiple identities (e.g., work and personal):

```bash
npx attest-it identity create    # Create another identity
npx attest-it identity list      # List all identities
npx attest-it identity use work  # Switch active identity
npx attest-it whoami             # Show current identity
```

## Step 2: Initialize Project

In your repository, run:

```bash
npx attest-it init
```

This creates `.attest-it/config.yaml` with your first gate.

### Example Configuration Session

```
Welcome to attest-it!

? Gate name: desktop-tests
? Description: Tests requiring VS Code desktop app
? Fingerprint paths (comma-separated): packages/vscode-extension/**/*.ts
? Exclude patterns (comma-separated): **/*.test.ts
? Maximum seal age: 30d

✓ Configuration created at .attest-it/config.yaml

Next steps:
  1. Add yourself to the team: npx attest-it team join
  2. Run tests and seal: npx attest-it run --suite desktop-tests
```

### Understanding the Config

```yaml
version: 1

settings:
  sealsPath: .attest-it/seals.json

team:
  alice:
    name: Alice Smith
    email: alice@example.com
    publicKey: MCowBQYDK2VwAyEAabc123...

gates:
  desktop-tests:
    name: Desktop Tests
    description: Tests requiring VS Code desktop app
    authorizedSigners: [alice]
    fingerprint:
      paths:
        - packages/vscode-extension/**/*.ts
      exclude:
        - '**/*.test.ts'
    maxAge: 30d

suites:
  desktop-tests:
    gate: desktop-tests
    command: pnpm vitest --project desktop
```

Key concepts:

- **Team**: People who can create seals, with their public keys
- **Gates**: What code needs attestation and who can sign
- **Suites**: Gates with associated test commands

## Step 3: Add Yourself to the Team

Add your identity to the project's team:

```bash
npx attest-it team join
```

This will:

1. Load your active identity
2. Add your public key to `.attest-it/config.yaml` under the team section
3. Prompt you to authorize yourself for gates

You can also add yourself manually by editing `.attest-it/config.yaml`:

```yaml
team:
  alice:
    name: Alice Smith
    email: alice@example.com
    publicKey: MCowBQYDK2VwAyEAabc123... # From identity export
```

To get your public key for manual addition:

```bash
npx attest-it identity export
```

## Step 4: Run Tests and Create Seal

Run your test suite and create a seal:

```bash
npx attest-it run --suite desktop-tests
```

The workflow:

1. **Fingerprint**: Computes SHA-256 hash of files in the gate's paths
2. **Execute**: Runs the test command
3. **Confirm**: Asks if tests passed and you want to seal
4. **Sign**: Creates Ed25519 signature with your private key
5. **Save**: Updates `.attest-it/seals.json`

Example output:

```
=== Running suite: desktop-tests ===

Running: pnpm vitest --project desktop

 ✓ extension/test/integration.test.ts (3 tests)

Test Files  1 passed (1)
     Tests  3 passed (3)

✓ Tests passed!
? Create seal for gate 'desktop-tests'? Yes

✓ Seal created for desktop-tests
  Fingerprint: a3b8c9d2...
  Sealed by: alice
  Sealed at: 2026-01-14T12:34:56.789Z

Commit: git add .attest-it/seals.json && git commit -m "Seal desktop-tests"
```

### Direct Sealing

If you run tests separately, seal directly:

```bash
npx attest-it seal desktop-tests
```

## Step 5: Commit the Seal

Add the seal file to version control:

```bash
git add .attest-it/seals.json .attest-it/config.yaml
git commit -m "Add seal for desktop-tests"
git push
```

The `.attest-it/` directory structure:

```
.attest-it/
├── config.yaml  # Configuration (commit)
└── seals.json   # Seals (commit after creating)
```

## Step 6: Set Up CI Verification

Add verification to your CI pipeline:

```yaml
# .github/workflows/ci.yml
name: CI

on: [push, pull_request]

jobs:
  verify-seals:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: npm ci
      - run: npx attest-it verify
```

Or use the GitHub Action:

```yaml
- uses: attest-it/github-action@v1
  with:
    fail-on-missing: 'true'
```

See [GitHub Integration Guide](github-integration.md) for more options.

## Checking Status

View seal status for all gates:

```bash
npx attest-it status
```

Example output:

```
Gate Status
===========

Gate: desktop-tests
Status: ✓ VALID
Fingerprint: a3b8c9d2...
Sealed by: alice
Sealed at: 2026-01-14T12:34:56.789Z
Age: 2 days

Overall: All gates valid
```

## Common Workflows

### Adding a New Gate

1. Edit `.attest-it/config.yaml` to add the gate
2. Run `npx attest-it seal <gate-name>` or `npx attest-it run --suite <suite-name>`
3. Commit the updated seals

### Updating Tests

When you modify code in a gate's fingerprint paths:

1. Make your changes
2. Run `npx attest-it run --suite affected-suite`
3. Commit both code changes and new seal

### Adding Team Members

**Quick method:**

1. Team member creates identity: `npx attest-it identity create`
2. They join the team: `npx attest-it team join`
3. They follow the prompts to authorize themselves for gates

**Manual method:**

1. Team member creates identity: `npx attest-it identity create`
2. They export public key: `npx attest-it identity export`
3. Add them to project config:

```yaml
team:
  bob:
    name: Bob Jones
    email: bob@example.com
    publicKey: MCowBQYDK2VwAyEAxyz789...
```

4. Add to gate's `authorizedSigners`:

```yaml
gates:
  desktop-tests:
    authorizedSigners: [alice, bob]
```

## Troubleshooting

### "No active identity found"

Create an identity:

```bash
npx attest-it identity create
```

### "Not authorized to seal gate"

Your public key isn't in the gate's `authorizedSigners`. Either:

- Run `npx attest-it team join` to add yourself to the team and gates
- Manually add yourself to the team and gate configuration
- Have an authorized team member seal

### "Configuration file not found"

Run `npx attest-it init` to create the configuration.

### "Key provider not available"

The configured key storage isn't available on this platform. Create a new identity with a different provider:

```bash
npx attest-it identity create
npx attest-it identity use <new-slug>
```

### Verification Fails in CI

Common causes:

1. Seals file not committed
2. Code changed since seal was created (fingerprint mismatch)
3. Seal expired (exceeds maxAge)
4. Signer removed from team

Run `npx attest-it status` locally to diagnose.

### Verification States

| State                  | Meaning                       | Solution                    |
| ---------------------- | ----------------------------- | --------------------------- |
| `VALID`                | Seal is valid                 | None needed                 |
| `MISSING`              | No seal for gate              | Run `seal` or `run --suite` |
| `STALE`                | Seal exceeds maxAge           | Re-seal (warning only)      |
| `FINGERPRINT_MISMATCH` | Code changed since seal       | Re-run tests and seal       |
| `INVALID_SIGNATURE`    | Signature verification failed | Check keys, re-seal         |
| `UNKNOWN_SIGNER`       | Signer not in team config     | Add signer or re-seal       |

## Best Practices

1. **Seal frequently**: After every test change
2. **Commit together**: Code and seals in the same commit
3. **Set reasonable expiry**: Match maxAge to your release cadence
4. **Back up keys**: Especially if using file storage
5. **Monitor status**: Run `npx attest-it status` regularly
6. **CI enforcement**: Always verify in CI

## Security Considerations

- Private keys never enter the repository
- Use secure key storage (1Password or Keychain) when possible
- Each team member has their own keypair
- Rotate keys by creating a new identity and updating team config
- Ed25519 provides modern, efficient cryptography

## Next Steps

- [Configuration Reference](configuration.md) - All options
- [GitHub Integration](github-integration.md) - CI setup
- [Writing Desktop Tests](writing-desktop-tests.md) - Test patterns
