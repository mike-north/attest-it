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

### Non-interactive identity creation

For CI, embedders, or agent-driven setups, pass flags instead of answering
prompts. `identity create` accepts `--name`, `--slug`, `--storage
<file|keychain|1password|yubikey>`, `--email`, and `--github`; when every
required value is supplied, it creates the identity with zero prompts:

```bash
npx attest-it identity create --name "CI Bot" --storage file --slug ci-bot < /dev/null
```

If stdin is not an interactive terminal and a required value (like `--name`
or `--storage`) is missing, the command fails fast with an error naming the
missing flag instead of hanging. `--slug` is optional even non-interactively
-- it is derived from `--name` when omitted.

To store an encrypted private key with the `file` backend, pipe a passphrase
in via `--passphrase-stdin` (never typed into a prompt):

```bash
echo "$CI_KEY_PASSPHRASE" | npx attest-it identity create \
  --name "CI Bot" --storage file --slug ci-bot --passphrase-stdin
```

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

This creates a **split configuration**: `.attest-it/policy.yaml` (trust-critical: team and gates) and `.attest-it/config.yaml` (operational: suites). Both start out empty (`team: {}`, `gates: {}`, `suites: {}`) -- see [What `init` Actually Does](#what-init-actually-does) below for defining your first gate and suite.

Already have an existing legacy unified `config.yaml` (one file holding `team`, `gates`, and `suites` together)? Run `npx attest-it init --migrate` instead to split it into the pair automatically.

`init` only prompts when `.attest-it/policy.yaml` or `config.yaml` already
exist and `--force` was not passed; pass `--force` to overwrite them
non-interactively (or run it in a fresh directory, which never prompts):

```bash
npx attest-it init --force < /dev/null
```

### What `init` Actually Does

`init` does not prompt you for gate or suite details -- it scaffolds both files
with `team: {}`, `gates: {}`, and `suites: {}` (each with commented examples)
and leaves defining your first gate and suite to you. Example output:

```
✓ Updated package.json with attest-it devDependency
✓ Configuration created:
  - .attest-it/policy.yaml (team, gates, security settings)
  - .attest-it/config.yaml (suites, command settings)

Next steps:
  1. Run: npm install
  2. Run: attest-it identity create  (if you haven't already)
  3. Run: attest-it team join
  4. Edit .attest-it/policy.yaml to define your gates, and .attest-it/config.yaml to define suites

Would you like to enable shell completions for zsh? (Y/n)
```

That last prompt is a one-time, optional offer to install shell completions
for your detected shell (`bash`, `zsh`, or `fish`) -- unrelated to
configuration, and safe to decline (or run `attest-it completion install`
later). It's skipped entirely in non-interactive contexts (no TTY on stdin).

So after `init`, define your first gate and suite by hand -- see
[Step 2b: Define Your First Gate and Suite](#step-2b-define-your-first-gate-and-suite)
below for the shape, or copy the commented example already in each scaffolded file.

### Step 2b: Define Your First Gate and Suite

Edit `.attest-it/policy.yaml` to add a gate, and `.attest-it/config.yaml` to
add a matching suite. Every gate requires at least one entry in
`authorizedSigners` -- list your own identity slug (the one from `identity
create`) here; `team join` (next step) adds that slug to the team so it
resolves. For example:

```yaml
# .attest-it/policy.yaml
version: 1

settings:
  sealsPath: .attest-it/seals.json

team: {}

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
```

```yaml
# .attest-it/config.yaml
version: 1

settings: {}

suites:
  desktop-tests:
    gate: desktop-tests
    command: pnpm vitest --project desktop
```

Key concepts:

- **Team** (`policy.yaml`): People who can create seals, with their public keys
- **Gates** (`policy.yaml`): What code needs attestation, who can sign, and the fingerprint config
- **Suites** (`config.yaml`): Test commands that reference a gate — every suite must specify `gate`

## Step 3: Add Yourself to the Team

Add your identity to the project's team:

```bash
npx attest-it team join
```

This will:

1. Load your active identity
2. Add your public key to `.attest-it/policy.yaml` under the team section
3. Prompt you to authorize yourself for gates

You can also add yourself manually by editing `.attest-it/policy.yaml`:

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

### Non-interactive team join / add

Pass `--gates` (comma-separated gate IDs) to authorize gates without the
checkbox prompt; omitting it authorizes no gates rather than prompting or
failing. `team join` also accepts `--slug` for the rare case where your
identity slug is already taken by another member:

```bash
npx attest-it team join --gates desktop-tests < /dev/null
```

`team add` (adding someone _else's_ public key) similarly accepts `--slug`,
`--name`, `--public-key`, `--email`, `--github`, and `--gates`:

```bash
npx attest-it team add --slug bob --name "Bob Jones" \
  --public-key "MCowBQYDK2VwAyEA..." --gates desktop-tests < /dev/null
```

## Step 3b: Commit Your Configuration

Before running tests, commit everything you've changed so far -- the `package.json` update
from `init`, and the `.attest-it/policy.yaml` / `.attest-it/config.yaml` edits from Steps 2b
and 3:

```bash
git add package.json .attest-it/
git commit -m "Configure attest-it: gate, suite, and team"
```

**This step must come before Step 4.** `attest-it run` refuses to seal against a dirty
working tree -- including newly-created, not-yet-committed files -- so if you run it with
the config edits above still uncommitted, it fails with:

```
✗ Working tree has uncommitted changes. Please commit or stash before attesting.
```

See [Working Tree Has Uncommitted Changes](configuration.md#working-tree-has-uncommitted-changes)
for why this precondition exists.

## Step 4: Run Tests and Create Seal

With a clean working tree (Step 3b), run your test suite and create a seal:

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

### Non-interactive sealing

Pass `--yes` to skip the "Create seal?" confirmation prompt:

```bash
npx attest-it run --suite desktop-tests --yes < /dev/null
```

Without `--yes`, a non-interactive run (no TTY on stdin) fails fast instead
of hanging, naming `--yes` as the flag needed to confirm sealing.

### Direct Sealing

If you run tests separately, seal directly (already non-interactive -- `seal`
takes no confirmation prompt):

```bash
npx attest-it seal desktop-tests
```

## Step 5: Commit the Seal

`policy.yaml` and `config.yaml` are already committed (Step 3b), so the only new file `run`
produced is the seal itself. Add it to version control:

```bash
git add .attest-it/seals.json
git commit -m "Add seal for desktop-tests"
git push
```

The `.attest-it/` directory structure:

```
.attest-it/
├── policy.yaml  # Trust-critical config: team, gates (commit; merge to default branch)
├── config.yaml  # Operational config: suites (commit)
└── seals.json   # Seals (commit after creating)
```

## Step 6: Set Up CI Verification

> [!IMPORTANT]
> **Plain `attest-it verify` is a local pre-check, not the CI trust boundary.** It
> trusts the working-tree `.attest-it/policy.yaml`, so a pull request that adds
> itself to `team`/`rootGate` and re-seals will still pass a bare `verify`. To
> enforce trust in CI you must anchor authorization to a **trusted base**:
>
> - **On GitHub:** use the GitHub Action below — it loads `policy.yaml` from the PR
>   **base branch** automatically.
> - **On other CI:** use `attest-it verify --base <ref>` — it loads
>   `rootGate`/`team`/`gates` from `<ref>` (e.g. `origin/main`) while fingerprinting
>   the working tree, so a self-added signer is rejected as `UNKNOWN_SIGNER`.
>
> See the [threat model](threat-model.md) for the full trust boundary.

On GitHub, enforce seals with the GitHub Action (the canonical, base-branch-anchored gate):

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
      # Loads policy from the PR base branch — the trusted source.
      - uses: attest-it/github-action@v1
        with:
          fail-on-missing: 'true'
```

On non-GitHub CI, use the CLI in trusted-ref mode. Fetch the base ref first (shallow
clones may not have it), then verify against it:

```yaml
# Example (non-GitHub CI)
- run: npm ci
- run: git fetch origin main
  # Anchors rootGate/team/gates to origin/main; a PR can't self-authorize.
- run: npx attest-it verify --base origin/main
```

A bare `npx attest-it verify` (no `--base`) is still useful as a fast **local**
pre-check before pushing, but must not be relied on as the CI gate.

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

**`status` is informational and exits `0` when it successfully reports gate results** --
even when a gate is `MISSING`, `FINGERPRINT_MISMATCH`, or otherwise invalid, it reports what
it finds rather than enforcing it. Don't wire `status` into CI expecting it to fail the build
on a bad gate; use the trusted CI gate for that — the GitHub Action or
`attest-it verify --base <ref>` (see [Step 6](#step-6-set-up-ci-verification)).
`status` still fails closed on the configuration itself, though: it exits `CONFIG_ERROR` on a
missing/unreadable config and `NO_WORK` when the config defines zero gates -- see
[Exit Codes](configuration.md#exit-codes).

## Common Workflows

### Adding a New Gate

1. Edit `.attest-it/policy.yaml` to add the gate
2. Edit `.attest-it/config.yaml` to add a suite referencing the gate (optional, if you want a runnable command)
3. Run `npx attest-it seal <gate-name>` or `npx attest-it run --suite <suite-name>`
4. Commit the updated seals

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
3. Add them to `policy.yaml`:

```yaml
# .attest-it/policy.yaml
team:
  bob:
    name: Bob Jones
    email: bob@example.com
    publicKey: MCowBQYDK2VwAyEAxyz789...
```

4. Add to gate's `authorizedSigners`:

```yaml
# .attest-it/policy.yaml
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
