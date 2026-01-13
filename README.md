# attest-it

Human-gated test attestation system with CI-friendly automated verification

## Why attest-it?

Some tests can't run in CI:

- Tests requiring desktop applications (Cursor, VS Code)
- Tests requiring OAuth flows with real browsers
- Tests requiring AI assistants (Claude Code, GitHub Copilot)
- Tests requiring human verification of visual correctness

These tests still need to be on the critical path. `attest-it` enforces that a human ran them by requiring cryptographically signed attestations.

## Quick Start

```bash
# Install
npm install attest-it

# Initialize configuration
npx attest-it init

# Generate signing keys
npx attest-it keygen

# Run tests and create attestation
npx attest-it run --suite my-suite

# Verify attestations (in CI)
npx attest-it verify
```

## How It Works

1. **Configure suites** - Define which packages and tests need human attestation
2. **Generate keys** - Create a keypair; private key stays local, public key goes in repo
3. **Run and attest** - Execute tests locally, confirm they passed, sign the attestation
4. **Verify in CI** - CI checks the signature and fingerprint match current code

## Security Model

### Threat Model

The primary threat is a well-meaning AI assistant that sees "attestation missing" and tries to help by generating a fake attestation. Asymmetric cryptography prevents this:

- Private key stored outside repo (`~/.config/attest-it/`)
- Only the signature (not the key) is in the repo
- AI can't sign without the private key

### Key Management

**Private Key:**

- Stored in `~/.config/attest-it/key.pem` (outside repository)
- File permissions automatically set to 0600 (owner read/write only)
- Never commit to version control
- Back up securely (password manager, encrypted backup)

**Public Key:**

- Stored in repository (e.g., `.attest-it/pubkey.pem`)
- Safe to share and commit
- Used by CI to verify attestations

### What attest-it Protects Against

- AI assistants creating fake attestations
- Attestation tampering (signature verification fails)
- Outdated attestations (maxAgeDays expiration)
- Code changes without re-attestation (fingerprint verification)

### What attest-it Does NOT Protect Against

- Compromised private keys
- Malicious developers with legitimate access
- Attackers with write access to both code and private key

## Installation

```bash
npm install attest-it
# or
pnpm add attest-it
# or
yarn add attest-it
```

## Configuration

Create `.attest-it/config.yaml`:

```yaml
version: 1

settings:
  maxAgeDays: 30
  algorithm: ed25519
  publicKeyPath: .attest-it/pubkey.pem
  attestationsPath: .attest-it/attestations.json

suites:
  desktop-tests:
    description: Tests requiring desktop application
    packages:
      - packages/my-app
    command: pnpm vitest --project desktop
```

See [Configuration Guide](docs/configuration.md) for full options.

## CLI Commands

| Command  | Description                      |
| -------- | -------------------------------- |
| `init`   | Initialize configuration         |
| `keygen` | Generate signing keypair         |
| `status` | Show attestation status          |
| `run`    | Run tests and create attestation |
| `verify` | Verify attestations (for CI)     |
| `prune`  | Remove stale attestations        |

Run `npx attest-it <command> --help` for detailed usage.

## GitHub Action

```yaml
- uses: attest-it/github-action@v1
  with:
    fail-on-missing: 'true'
```

See [GitHub Integration Guide](docs/github-integration.md) for more details.

## Documentation

- [Getting Started](docs/getting-started.md) - Complete setup guide
- [Configuration](docs/configuration.md) - All configuration options
- [GitHub Integration](docs/github-integration.md) - CI setup and workflows
- [Writing Desktop Tests](docs/writing-desktop-tests.md) - Test patterns and examples

## Example Use Cases

### Desktop Application Tests

Test Electron apps, VS Code extensions, or any desktop application:

```typescript
import { confirm } from '@inquirer/prompts'

it('verifies UI layout in app', async () => {
  const app = await launchApp()
  const correct = await confirm({
    message: 'Does the settings dialog appear correctly?',
  })
  expect(correct).toBe(true)
}, 300000)
```

### AI Assistant Integration Tests

Verify AI assistants work correctly with your tools:

```typescript
it('claude can use our custom tool', async () => {
  const result = await runClaudeWithTool(myToolDefinition)
  const success = await confirm({
    message: 'Did Claude successfully use the tool?',
  })
  expect(success).toBe(true)
})
```

### Visual Regression Tests

Manual visual verification when automated pixel comparison isn't enough:

```typescript
it('renders complex chart correctly', async () => {
  await renderChart(complexData)
  const looksGood = await confirm({
    message: 'Does the chart render all data points correctly?',
  })
  expect(looksGood).toBe(true)
})
```

## How Attestations Work

1. **Fingerprinting**: Compute SHA-256 hash of all test files and dependencies
2. **Execution**: Run the test suite locally
3. **Attestation**: Create signed record of fingerprint + timestamp + user
4. **Verification**: CI verifies signature and checks fingerprint matches current code

## Fingerprint Invalidation

Attestations become invalid when:

- Test files change (fingerprint mismatch)
- Dependencies change (if included in packages)
- Attestation expires (exceeds maxAgeDays)
- Parent suite changes (via invalidates property)

## Security Features

- **Ed25519 signatures**: Fast, modern elliptic curve cryptography
- **Canonical JSON**: Deterministic serialization prevents tampering
- **File permissions**: Private keys automatically set to 0600
- **Git integration**: Detects uncommitted changes before attesting

## Requirements

- Node.js 20+
- OpenSSL (for key generation)
- Git (for fingerprinting and detecting changes)

## Contributing

We welcome contributions! Please see our contributing guidelines.

## License

MIT

## Support

- Issues: [GitHub Issues](https://github.com/attest-it/attest-it/issues)
- Discussions: [GitHub Discussions](https://github.com/attest-it/attest-it/discussions)
