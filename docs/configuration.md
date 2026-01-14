# Configuration Reference

Complete guide to configuring attest-it for your project.

## Overview

attest-it uses two configuration files:

1. **Project configuration** (`.attest-it/config.yaml`) - Defines team members, gates, and suites for your repository
2. **Local identity configuration** (`~/.config/attest-it/config.yaml`) - Your personal signing identity and key storage

## Project Configuration

The project configuration file is located at `.attest-it/config.yaml` in your repository root.

### Basic Structure

```yaml
version: 1

settings:
  sealsPath: .attest-it/seals.json
  keyProvider:
    type: file
    options:
      privateKeyPath: ~/.config/attest-it/key.pem

team:
  alice:
    name: Alice Smith
    email: alice@example.com
    publicKey: MCowBQYDK2VwAyEA...

gates:
  unit-tests:
    name: Unit Tests
    description: All unit tests pass
    authorizedSigners: [alice]
    fingerprint:
      paths: ['src/**/*.ts']
    maxAge: 30d

suites:
  unit-tests:
    gate: unit-tests
    command: pnpm test
```

## Settings

Global settings that apply to all gates and suites.

### `version` (required)

Schema version for forward compatibility.

```yaml
version: 1
```

**Type**: `1` (literal)
**Required**: Yes

### `settings.sealsPath`

Path to the seals file.

```yaml
settings:
  sealsPath: .attest-it/seals.json
```

**Type**: String (relative or absolute path)
**Default**: `.attest-it/seals.json`
**Required**: No

### `settings.keyProvider`

Key provider configuration for signing operations.

```yaml
settings:
  keyProvider:
    type: file
    options:
      privateKeyPath: ~/.config/attest-it/key.pem
```

**Type**: Object with `type` and `options`
**Required**: No (uses identity's key provider if not specified)

See [Key Providers](#key-providers) for all options.

## Team

Team members who can create seals. Each team member has a unique slug identifier.

### Team Member Fields

```yaml
team:
  alice:
    name: Alice Smith
    email: alice@example.com
    github: alicedev
    publicKey: MCowBQYDK2VwAyEA...
```

| Field       | Type   | Required | Description                           |
| ----------- | ------ | -------- | ------------------------------------- |
| `name`      | string | Yes      | Display name                          |
| `email`     | string | No       | Email address                         |
| `github`    | string | No       | GitHub username                       |
| `publicKey` | string | Yes      | Base64-encoded Ed25519 public key     |

### Adding Team Members

Use the CLI to add team members interactively:

```bash
npx attest-it team add
```

Or have team members export their public key:

```bash
# Team member runs this and shares the output
npx attest-it identity export
```

## Gates

Gates define checkpoints that require human attestation.

### Gate Fields

```yaml
gates:
  desktop-tests:
    name: Desktop Tests
    description: Tests requiring VS Code desktop application
    authorizedSigners: [alice, bob]
    fingerprint:
      paths:
        - packages/vscode-extension/**/*.ts
        - packages/shared/**/*.ts
      exclude:
        - '**/*.test.ts'
        - '**/*.d.ts'
    maxAge: 30d
```

| Field               | Type     | Required | Description                                |
| ------------------- | -------- | -------- | ------------------------------------------ |
| `name`              | string   | Yes      | Display name for the gate                  |
| `description`       | string   | No       | Human-readable description                 |
| `authorizedSigners` | string[] | Yes      | Team member slugs who can seal this gate   |
| `fingerprint`       | object   | Yes      | Fingerprint configuration                  |
| `maxAge`            | string   | No       | Maximum seal age (e.g., `30d`, `7d`, `24h`)|

### Fingerprint Configuration

```yaml
fingerprint:
  paths:
    - src/**/*.ts
    - lib/**/*.ts
  exclude:
    - '**/*.test.ts'
    - '**/*.d.ts'
    - '**/dist/**'
```

| Field     | Type     | Required | Description                        |
| --------- | -------- | -------- | ---------------------------------- |
| `paths`   | string[] | Yes      | Glob patterns for files to include |
| `exclude` | string[] | No       | Glob patterns for files to exclude |

### Max Age Format

The `maxAge` field accepts duration strings:

- `30d` - 30 days
- `7d` - 7 days
- `24h` - 24 hours
- `1w` - 1 week

**Default**: `30d`

## Suites

Suites extend gates with test commands. They're optional - you can use gates directly with the `seal` command.

### Suite Fields

```yaml
suites:
  desktop-tests:
    gate: desktop-tests
    command: pnpm vitest --project desktop
    timeout: 300000
    interactive: true
```

| Field         | Type    | Required | Description                              |
| ------------- | ------- | -------- | ---------------------------------------- |
| `gate`        | string  | Yes      | Gate slug this suite is associated with  |
| `command`     | string  | Yes      | Command to execute                       |
| `timeout`     | number  | No       | Command timeout in milliseconds          |
| `interactive` | boolean | No       | Whether tests require user interaction   |

## Local Identity Configuration

Your identity is stored at `~/.config/attest-it/config.yaml` (or `~/Library/Application Support/attest-it/config.yaml` on macOS).

### Structure

```yaml
activeIdentity: work

identities:
  work:
    name: Alice Smith
    email: alice@example.com
    github: alicedev
    publicKey: MCowBQYDK2VwAyEA...
    privateKey:
      type: keychain
      service: attest-it
      account: alice-work

  personal:
    name: Alice Smith
    email: alice@personal.com
    publicKey: MCowBQYDK2VwAyEA...
    privateKey:
      type: file
      path: ~/.config/attest-it/personal-key.pem
```

### Identity Fields

| Field        | Type   | Required | Description                              |
| ------------ | ------ | -------- | ---------------------------------------- |
| `name`       | string | Yes      | Display name                             |
| `email`      | string | No       | Email address                            |
| `github`     | string | No       | GitHub username                          |
| `publicKey`  | string | Yes      | Base64-encoded Ed25519 public key        |
| `privateKey` | object | Yes      | Private key reference (see below)        |

## Key Providers

attest-it supports multiple key storage backends for private keys.

### Filesystem Provider

Store private key as a PEM file:

```yaml
privateKey:
  type: file
  path: ~/.config/attest-it/key.pem
```

**Options**:
| Field  | Type   | Required | Description           |
| ------ | ------ | -------- | --------------------- |
| `path` | string | Yes      | Path to PEM key file  |

### macOS Keychain Provider

Store private key in macOS Keychain:

```yaml
privateKey:
  type: keychain
  service: attest-it
  account: alice
```

**Options**:
| Field     | Type   | Required | Description              |
| --------- | ------ | -------- | ------------------------ |
| `service` | string | Yes      | Keychain service name    |
| `account` | string | Yes      | Keychain account name    |

**Requirements**: macOS only

### 1Password Provider

Store private key in 1Password:

```yaml
privateKey:
  type: 1password
  vault: Private
  item: attest-it-signing-key
  account: user@example.com  # optional
```

**Options**:
| Field     | Type   | Required | Description                    |
| --------- | ------ | -------- | ------------------------------ |
| `vault`   | string | Yes      | 1Password vault name           |
| `item`    | string | Yes      | Item name in vault             |
| `account` | string | No       | 1Password account (if multiple)|

**Requirements**: 1Password CLI (`op`) must be installed and configured

## Complete Example

### Project Configuration

```yaml
# .attest-it/config.yaml
version: 1

settings:
  sealsPath: .attest-it/seals.json

team:
  alice:
    name: Alice Smith
    email: alice@example.com
    github: alicedev
    publicKey: MCowBQYDK2VwAyEAabc123...

  bob:
    name: Bob Jones
    email: bob@example.com
    publicKey: MCowBQYDK2VwAyEAxyz789...

gates:
  # Desktop integration tests
  desktop-vscode:
    name: VS Code Extension Tests
    description: Tests requiring VS Code desktop application
    authorizedSigners: [alice, bob]
    fingerprint:
      paths:
        - packages/vscode-extension/**/*.ts
        - packages/shared-ui/**/*.ts
      exclude:
        - '**/*.test.ts'
        - '**/dist/**'
    maxAge: 30d

  # AI assistant tests
  claude-integration:
    name: Claude Integration Tests
    description: Tests verifying Claude Code integration
    authorizedSigners: [alice]
    fingerprint:
      paths:
        - packages/claude-tools/**/*.ts
        - test/fixtures/tool-schemas/**/*.json
    maxAge: 14d

  # Visual regression tests
  visual-tests:
    name: Visual Regression Tests
    description: Manual visual verification tests
    authorizedSigners: [alice, bob]
    fingerprint:
      paths:
        - packages/ui-components/**/*.tsx
    maxAge: 7d

suites:
  desktop-vscode:
    gate: desktop-vscode
    command: pnpm vitest --project desktop
    timeout: 300000
    interactive: true

  claude-integration:
    gate: claude-integration
    command: pnpm vitest --project ai-integration
    interactive: true

  visual-tests:
    gate: visual-tests
    command: pnpm test:visual
    interactive: true
```

### Local Identity Configuration

```yaml
# ~/.config/attest-it/config.yaml
activeIdentity: work

identities:
  work:
    name: Alice Smith
    email: alice@example.com
    github: alicedev
    publicKey: MCowBQYDK2VwAyEAabc123...
    privateKey:
      type: 1password
      vault: Work
      item: attest-it-signing-key
      account: alice@example.com

  personal:
    name: Alice Smith
    email: alice@personal.com
    publicKey: MCowBQYDK2VwAyEAdef456...
    privateKey:
      type: keychain
      service: attest-it-personal
      account: alice
```

## Verification Behavior

When `attest-it verify` runs, it checks each gate:

1. **VALID**: Seal exists, signature verifies, fingerprint matches, within maxAge
2. **MISSING**: No seal found for gate
3. **STALE**: Seal exceeds maxAge (warning only, not a failure)
4. **FINGERPRINT_MISMATCH**: Code changed since seal was created
5. **INVALID_SIGNATURE**: Signature verification failed
6. **UNKNOWN_SIGNER**: Signer not in team configuration

### Exit Codes

| Code | Meaning                            |
| ---- | ---------------------------------- |
| 0    | All gates valid (STALE is warning) |
| 1    | One or more gates invalid          |
| 2    | No gates defined                   |
| 3    | Configuration error                |

## CLI Configuration Commands

```bash
# Validate configuration
npx attest-it status

# Add team member interactively
npx attest-it team add

# List team members
npx attest-it team list

# Create new identity
npx attest-it identity create

# Switch active identity
npx attest-it identity use <slug>

# Show current identity
npx attest-it whoami
```

## Path Resolution

All paths in configuration are resolved relative to the repository root:

```yaml
settings:
  sealsPath: .attest-it/seals.json
  # Resolves to: /path/to/repo/.attest-it/seals.json
```

Paths starting with `~` are resolved to the user's home directory:

```yaml
privateKey:
  type: file
  path: ~/.config/attest-it/key.pem
  # Resolves to: /Users/alice/.config/attest-it/key.pem
```

## Schema Reference

JSON Schema is available at `/schemas/config.schema.json` for editor validation.

## Troubleshooting

### Configuration Not Found

```
Error: Configuration file not found
```

**Solution**: Run `npx attest-it init` or create `.attest-it/config.yaml` manually.

### No Identity Configured

```
Error: No active identity found
```

**Solution**: Run `npx attest-it identity create` to set up your identity.

### Not Authorized to Seal Gate

```
Error: Not authorized to seal gate 'my-gate'
```

**Solution**: Add your team member slug to the gate's `authorizedSigners` array, or have an authorized team member seal the gate.

### Key Provider Not Available

```
Error: Key provider 'keychain' is not available on this platform
```

**Solution**: Use a different key provider (e.g., `file` or `1password`).

## See Also

- [Getting Started](getting-started.md) - Initial setup guide
- [GitHub Integration](github-integration.md) - CI configuration
- [Writing Tests](writing-desktop-tests.md) - Test patterns
