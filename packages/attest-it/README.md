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
# Create your signing identity
npx attest-it identity create

# Initialize project configuration
npx attest-it init

# Add yourself to the project team
npx attest-it team join

# Run tests and create seal
npx attest-it run --suite my-suite

# Verify seals (in CI)
npx attest-it verify
```

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

For identity and team management commands, see the [main README](../../README.md#cli-commands).

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
  publicKeyPath: .attest-it/pubkey.pem
  sealsPath: .attest-it/seals.json

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

## Documentation

- [Getting Started](../../docs/getting-started.md) - Complete setup guide
- [Configuration](../../docs/configuration.md) - All configuration options
- [GitHub Integration](../../docs/github-integration.md) - CI setup
- [API Documentation](../../docs/api/attest-it.md) - Full API reference

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
