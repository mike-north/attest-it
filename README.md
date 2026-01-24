# attest-it

Cryptographically signed attestations for tests that can't run in CI.

## Why?

Some tests require a human: desktop apps, OAuth flows, AI assistants, visual verification. `attest-it` lets you run these locally and create cryptographic proof that they passed.

## Quick Start

```bash
npm install attest-it

# One-time setup: create your signing identity
npx attest-it identity create

# Initialize project config
npx attest-it init

# Run tests and seal the gate
npx attest-it run --suite my-suite

# In CI: verify all seals
npx attest-it verify
```

## How It Works

1. **Identity** - Your Ed25519 keypair (stored in 1Password, Keychain, YubiKey, or filesystem)
2. **Gates** - Define what code needs attestation and who can sign
3. **Seals** - Run tests, confirm they passed, create cryptographic signature
4. **Verify** - CI checks signatures against team member public keys

## Security

The primary threat is an AI assistant creating a fake attestation. attest-it prevents this with:

- **Asymmetric crypto**: Private keys never enter the repo
- **Secure storage**: Keys stored in 1Password, macOS Keychain, YubiKey, or encrypted files
- **Team authorization**: Each gate specifies who can sign
- **Fingerprinting**: Code changes invalidate seals

## Configuration

Create `.attest-it/config.yaml` in your repository. Here's a minimal example:

```yaml
version: 1

# Team members authorized to create seals
team:
  alice:
    name: Alice Smith
    publicKey: MCowBQYDK2VwAyEA... # Ed25519 public key (base64)

# Gates define what code requires human attestation
gates:
  desktop-tests:
    name: Desktop Tests
    description: Tests requiring the desktop app
    authorizedSigners: [alice]
    fingerprint:
      paths:
        - src/**/*.ts
      exclude:
        - '**/*.test.ts'
    maxAge: 30d

# Suites add test commands to gates (optional)
suites:
  desktop-tests:
    gate: desktop-tests
    command: pnpm test:desktop
```

**Key concepts:**

- **Team** - People authorized to create seals, identified by their public key
- **Gates** - Define which files require attestation and who can sign
- **Fingerprint** - Files to hash; any change invalidates the seal
- **Suites** - Optional; add `command` to run tests before sealing

See [Configuration Reference](docs/configuration.md) for all options.

## CLI Commands

### Identity Management

| Command                  | Description                           |
| ------------------------ | ------------------------------------- |
| `identity create`        | Create a new identity with keypair    |
| `identity list`          | List all local identities             |
| `identity use <slug>`    | Switch active identity                |
| `identity show [slug]`   | Show identity details                 |
| `identity export [slug]` | Export public key for team onboarding |
| `identity remove <slug>` | Delete identity and associated key    |
| `whoami`                 | Show current active identity          |

### Team Management

| Command              | Description                                         |
| -------------------- | --------------------------------------------------- |
| `team list`          | List team members and gates                         |
| `team add`           | Add a team member                                   |
| `team join`          | Add yourself to the project team with active identity |
| `team remove <slug>` | Remove team member                                  |

### Sealing and Verification

| Command             | Description                      |
| ------------------- | -------------------------------- |
| `seal [gates...]`   | Create seals for specified gates |
| `verify [gates...]` | Verify seals (for CI)            |
| `status`            | Show seal status for all gates   |
| `run --suite`       | Run tests and optionally seal    |

### Project Setup

| Command | Description                      |
| ------- | -------------------------------- |
| `init`  | Initialize project configuration |
| `prune` | Remove stale seals               |

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

## How Seals Work

1. **Fingerprinting**: Compute SHA-256 hash of all files in gate's fingerprint paths
2. **Execution**: Run the test suite locally (if using `run` command)
3. **Sealing**: Create Ed25519 signature of fingerprint + timestamp + gate ID
4. **Verification**: CI verifies signature against team member's public key

### Verification States

| State                  | Description                                |
| ---------------------- | ------------------------------------------ |
| `VALID`                | Seal is valid and current                  |
| `MISSING`              | No seal found for gate                     |
| `STALE`                | Seal exceeds maxAge (warning, not failure) |
| `FINGERPRINT_MISMATCH` | Code changed since seal was created        |
| `INVALID_SIGNATURE`    | Signature verification failed              |
| `UNKNOWN_SIGNER`       | Signer not found in team configuration     |

### Seal Invalidation

Seals become invalid when:

- Files in fingerprint paths change (fingerprint mismatch)
- Seal expires (exceeds gate's maxAge)
- Signer is removed from team configuration
- Signer is removed from gate's authorizedSigners

## Key Storage Options

When you run `attest-it identity create`, you can choose where to store your private key:

### File System (Default)

Keys are stored as PEM files in `~/.attest-it/keys/`. Simple but requires you to protect the file.

### macOS Keychain

Keys are stored in your login keychain, protected by your system password. Available only on macOS.

### 1Password

Keys are stored as secure documents in your 1Password vault. Requires the 1Password CLI (`op`) to be installed and signed in.

### YubiKey (Hardware Security)

**Most secure option.** Your private key is encrypted using your YubiKey's HMAC-SHA1 challenge-response feature. The encrypted key is stored on disk, but can only be decrypted when your physical YubiKey is present.

**Setup requirements:**

1. Install YubiKey Manager: `brew install ykman`
2. Configure slot 2 for challenge-response: `ykman otp chalresp --generate 2`
3. Run `attest-it identity create` and select "YubiKey"

**How it works:**

- A random challenge is generated and sent to the YubiKey
- The YubiKey returns an HMAC-SHA1 response using its internal secret
- This response is used to derive an AES-256 encryption key
- Your Ed25519 private key is encrypted with AES-256-GCM
- The encrypted key file includes the challenge, so only your specific YubiKey can decrypt it

**Security benefits:**

- Private key cannot be extracted without physical possession of the YubiKey
- Even if your computer is compromised, attackers cannot sign attestations
- Optional serial number binding prevents use with different YubiKeys

## Requirements

- Node.js 20+
- Git (for fingerprinting and detecting changes)

**Optional** (for key storage):

- 1Password CLI (`op`) for 1Password key storage
- macOS for Keychain key storage
- YubiKey with `ykman` CLI for hardware-protected key storage

## Contributing

We welcome contributions! Please see our contributing guidelines.

## License

MIT

## Support

- Issues: [GitHub Issues](https://github.com/attest-it/attest-it/issues)
- Discussions: [GitHub Discussions](https://github.com/attest-it/attest-it/discussions)
