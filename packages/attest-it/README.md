# attest-it

Human-gated test attestation system with cryptographic signing.

## Why attest-it?

Some tests can't run in CI:

- Tests requiring desktop applications (Cursor, VS Code)
- Tests requiring OAuth flows with real browsers
- Tests requiring AI assistants (Claude Code, GitHub Copilot)
- Tests requiring human verification of visual correctness

These tests still need to be on the critical path. `attest-it` enforces that a human ran them by requiring cryptographically signed attestations.

## Installation

```bash
npm install attest-it
# or
pnpm add attest-it
# or
yarn add attest-it
```

## Quick Start

```bash
# Fresh project? Ignore node_modules first -- `attest-it run` refuses to seal
# against an uncommitted/dirty working tree.
echo "node_modules/" >> .gitignore

# Create your signing identity
npx attest-it identity create

# Initialize project configuration
npx attest-it init

# Define a gate and a suite that references it -- see Configuration below for
# the minimal shape, or copy the commented example already in each scaffolded
# file (.attest-it/policy.yaml and .attest-it/config.yaml).

# Add yourself to the project team and authorize the gate you just defined
npx attest-it team join --gates my-gate

# Commit before sealing (config edits + any new lockfile from installing)
git add -A && git commit -m "Configure attest-it"

# Run tests and create seal
npx attest-it run --suite my-suite

# Verify seals (in CI)
npx attest-it verify
```

See [Getting Started](https://github.com/mike-north/attest-it/blob/main/docs/getting-started.md)
for the fully worked walkthrough.

## Package Contents

This umbrella package includes:

- **CLI**: Full command-line interface (`npx attest-it <command>`)
- **Core API**: Programmatic access to all functionality via `@attest-it/core`

### CLI Commands

| Command  | Description               |
| -------- | ------------------------- |
| `init`   | Initialize configuration  |
| `status` | Show seal status          |
| `run`    | Run tests and create seal |
| `verify` | Verify seals (for CI)     |
| `prune`  | Remove stale seals        |

**Identity management:**

| Command                  | Description                           |
| ------------------------ | ------------------------------------- |
| `identity create`        | Create a new identity with keypair    |
| `identity list`          | List all local identities             |
| `identity use <slug>`    | Switch active identity                |
| `identity show [slug]`   | Show identity details                 |
| `identity export [slug]` | Export public key for team onboarding |
| `identity remove <slug>` | Delete identity and associated key    |
| `whoami`                 | Show current active identity          |

**Team management:**

| Command              | Description                                           |
| -------------------- | ----------------------------------------------------- |
| `team list`          | List team members and gates                           |
| `team add`           | Add a team member                                     |
| `team join`          | Add yourself to the project team with active identity |
| `team remove <slug>` | Remove team member                                    |

Run `npx attest-it <command> --help` for detailed usage.

### Programmatic API

```typescript
import { loadSplitConfig, computeFingerprint, readSeals, verifyAllSeals } from 'attest-it'

// Load the split configuration (policy.yaml + config.yaml)
const config = await loadSplitConfig({ baseDir: process.cwd() })

// Look up the gate explicitly -- a missing gate should fail with a clear
// error instead of silently falling through to computeFingerprint's generic
// "paths array must not be empty"
const gate = config.gates?.['my-gate']
if (!gate) {
  throw new Error('Gate "my-gate" not found in policy.yaml')
}

// Compute fingerprint for the gate
const result = await computeFingerprint({
  paths: gate.fingerprint.paths,
  baseDir: process.cwd(),
})

// Verify all gates' seals against their current fingerprints
const sealsFile = await readSeals(process.cwd(), config.settings.sealsPath)
const verification = verifyAllSeals(config, sealsFile, { 'my-gate': result.fingerprint })
```

## Configuration

Create `.attest-it/policy.yaml` (trust-critical: team + gates) and `.attest-it/config.yaml`
(operational: suites) — `attest-it init` scaffolds both:

```yaml
# .attest-it/policy.yaml
version: 1

settings:
  maxAgeDays: 30
  sealsPath: .attest-it/seals/

gates:
  desktop-tests:
    name: Desktop Tests
    description: Tests requiring desktop application
    authorizedSigners: [alice]
    fingerprint:
      paths:
        - packages/my-app
    maxAge: 30d
```

```yaml
# .attest-it/config.yaml
version: 1

suites:
  desktop-tests:
    gate: desktop-tests
    description: Tests requiring desktop application
    command: pnpm vitest --project desktop
```

Local identity configuration (your personal signing identity, distinct from the project's
`.attest-it/`) lives at `~/.config/attest-it/config.yaml` by default. Set `ATTEST_IT_HOME` to
redirect that directory (e.g. for isolated test runs); for the `file` key-storage backend this
also redirects where VaultKeeper stores the private key material, but **not** for `keychain`,
`1password`, or `yubikey` -- see
[`ATTEST_IT_HOME`](https://github.com/mike-north/attest-it/blob/main/docs/configuration.md#attest_it_home)
for details.

## Documentation

- [Getting Started](https://github.com/mike-north/attest-it/blob/main/docs/getting-started.md) - Complete setup guide
- [Configuration](https://github.com/mike-north/attest-it/blob/main/docs/configuration.md) - All configuration options
- [GitHub Integration](https://github.com/mike-north/attest-it/blob/main/docs/github-integration.md) - CI setup
- [Embedding attest-it](https://github.com/mike-north/attest-it/blob/main/docs/embedding.md) - The stable, versioned embeddable API

## Related Packages

| Package                    | Description                   |
| -------------------------- | ----------------------------- |
| `@attest-it/core`          | Core library (included)       |
| `@attest-it/cli`           | CLI implementation (included) |
| `@attest-it/github-action` | GitHub Actions integration    |

## Requirements

- Node.js 20+
- OpenSSL (for key generation and signing)

## License

MIT
