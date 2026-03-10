# Configuration Reference

Complete reference for configuring attest-it.

## Overview

attest-it uses two types of configuration:

1. **Project configuration** (`.attest-it/config.yaml`) - Team members, gates, and suites for your repository
2. **Local identity configuration** (`~/.config/attest-it/config.yaml`) - Your personal signing identity

## Quick Start Example

```yaml
# .attest-it/config.yaml
version: 1

team:
  alice:
    name: Alice Smith
    publicKey: MCowBQYDK2VwAyEA...

gates:
  desktop-tests:
    name: Desktop Tests
    description: Tests requiring the desktop application
    authorizedSigners: [alice]
    fingerprint:
      paths:
        - src/**/*.ts
    maxAge: 30d

suites:
  desktop-tests:
    gate: desktop-tests
    command: pnpm test:desktop
```

---

## Project Configuration Schema

### Root Fields

| Field        | Type   | Required | Default | Description                                       |
| ------------ | ------ | -------- | ------- | ------------------------------------------------- |
| `version`    | `1`    | Yes      | -       | Schema version (must be `1`)                      |
| `minVersion` | string | No       | -       | Minimum attest-it version required (e.g. "0.9.0") |
| `settings`   | object | No       | `{}`    | Global settings                                   |
| `team`       | object | No       | `{}`    | Team member definitions                           |
| `gates`      | object | No       | `{}`    | Gate definitions                                  |
| `suites`     | object | Yes      | -       | Suite definitions (min 1 suite)                   |
| `groups`     | object | No       | `{}`    | Named groups of suites                            |

---

## Settings

Global settings that apply to the project.

```yaml
settings:
  maxAgeDays: 30
  publicKeyPath: .attest-it/pubkey.pem
  attestationsPath: .attest-it/attestations.json
  defaultCommand: pnpm test
  keyProvider:
    type: filesystem
    options:
      privateKeyPath: ~/.config/attest-it/key.pem
```

### Settings Fields

| Field              | Type    | Required | Default                        | Description                      |
| ------------------ | ------- | -------- | ------------------------------ | -------------------------------- |
| `maxAgeDays`       | integer | No       | `30`                           | Default maximum seal age in days |
| `publicKeyPath`    | string  | No       | `.attest-it/pubkey.pem`        | Path to public key file          |
| `attestationsPath` | string  | No       | `.attest-it/attestations.json` | Path to seals/attestations file  |
| `defaultCommand`   | string  | No       | -                              | Default command for suites       |
| `keyProvider`      | object  | No       | -                              | Key provider configuration       |

### Key Provider Configuration

```yaml
keyProvider:
  type: filesystem # or '1password'
  options:
    privateKeyPath: ~/.config/attest-it/key.pem
```

| Field     | Type   | Required | Description                              |
| --------- | ------ | -------- | ---------------------------------------- |
| `type`    | string | Yes      | Provider type: `filesystem`, `1password` |
| `options` | object | No       | Provider-specific options                |

**Filesystem options:**

| Option           | Type   | Description              |
| ---------------- | ------ | ------------------------ |
| `privateKeyPath` | string | Path to private key file |

**1Password options:**

| Option     | Type   | Description                     |
| ---------- | ------ | ------------------------------- |
| `account`  | string | 1Password account (if multiple) |
| `vault`    | string | Vault name                      |
| `itemName` | string | Item name in vault              |

---

## Minimum Version Requirement

You can specify a minimum version of attest-it required to use your configuration:

```yaml
version: 1
minVersion: '0.9.0'
```

### When to Use

- When you adopt new configuration features that older versions don't support
- To ensure team members have a compatible CLI version
- To prevent cryptic errors from version mismatches

### What Happens

If someone runs an older version of attest-it with this config, they'll see a clear error:

```
Error: This configuration requires attest-it version 0.9.0 or newer, but you are running 0.8.5.

To upgrade:
  pnpm add -D @attest-it/cli@^0.9.0
  # then run: pnpm install
```

### Local CLI Resolution

The CLI automatically prefers locally installed versions over global installations. This ensures projects use their pinned version even if a global CLI is invoked. Set `ATTEST_IT_SKIP_LOCAL_RESOLUTION=1` to disable this behavior.

### Version Synchronization

The `@attest-it/core` and `@attest-it/cli` packages should be kept at the same version. When upgrading, update both packages together.

### Pre-release Versions

The `minVersion` field supports semantic versioning including pre-release tags (e.g., "1.0.0-beta.1"). Note that per semver rules, `1.0.0-beta.1 < 1.0.0`, so a config requiring `minVersion: "1.0.0"` will reject pre-release versions.

---

## Team

Team members who can create seals. Each member has a unique slug identifier (the key).

```yaml
team:
  alice:
    name: Alice Smith
    email: alice@example.com
    github: alicedev
    publicKey: MCowBQYDK2VwAyEAabc123...

  bob:
    name: Bob Jones
    publicKey: MCowBQYDK2VwAyEAxyz789...
```

### Team Member Fields

| Field       | Type   | Required | Description                          |
| ----------- | ------ | -------- | ------------------------------------ |
| `name`      | string | Yes      | Display name (min 1 character)       |
| `email`     | string | No       | Email address (must be valid format) |
| `github`    | string | No       | GitHub username                      |
| `publicKey` | string | Yes      | Base64-encoded Ed25519 public key    |

### Getting Public Keys

Team members export their public key:

```bash
npx attest-it identity export
```

Or add members interactively:

```bash
npx attest-it team add
```

---

## Gates

Gates define checkpoints that require human attestation. A gate specifies which code is covered and who can sign.

```yaml
gates:
  desktop-tests:
    name: Desktop Tests
    description: Tests requiring VS Code desktop application
    authorizedSigners:
      - alice
      - bob
    fingerprint:
      paths:
        - packages/vscode-extension/**/*.ts
        - packages/shared/**/*.ts
      exclude:
        - '**/*.test.ts'
        - '**/*.d.ts'
    maxAge: 30d
```

### Gate Fields

| Field               | Type     | Required | Default | Description                                  |
| ------------------- | -------- | -------- | ------- | -------------------------------------------- |
| `name`              | string   | Yes      | -       | Display name (min 1 character)               |
| `description`       | string   | Yes      | -       | Human-readable description (min 1 character) |
| `authorizedSigners` | string[] | Yes      | -       | Team member slugs who can seal (min 1)       |
| `fingerprint`       | object   | Yes      | -       | Fingerprint configuration                    |
| `maxAge`            | string   | Yes      | -       | Maximum seal age (duration string)           |

### Fingerprint Configuration

The fingerprint determines which files are hashed. When any fingerprinted file changes, the seal becomes invalid.

```yaml
fingerprint:
  paths:
    - src/**/*.ts
    - lib/**/*.js
  exclude:
    - '**/*.test.ts'
    - '**/*.d.ts'
    - '**/dist/**'
```

| Field     | Type     | Required | Description                                |
| --------- | -------- | -------- | ------------------------------------------ |
| `paths`   | string[] | Yes      | Glob patterns for files to include (min 1) |
| `exclude` | string[] | No       | Glob patterns for files to exclude         |

**Glob pattern examples:**

| Pattern               | Matches                                    |
| --------------------- | ------------------------------------------ |
| `src/**/*.ts`         | All `.ts` files in `src/` recursively      |
| `packages/*/src/**`   | All files in any package's `src/` folder   |
| `**/*.test.ts`        | All test files anywhere                    |
| `!**/node_modules/**` | Exclude node_modules (use `exclude` field) |

### Duration Strings

The `maxAge` field accepts duration strings:

| Format  | Example | Description |
| ------- | ------- | ----------- |
| Days    | `30d`   | 30 days     |
| Weeks   | `2w`    | 2 weeks     |
| Hours   | `24h`   | 24 hours    |
| Minutes | `30m`   | 30 minutes  |

---

## Suites

Suites extend gates with test commands. Use suites when you want to run tests before sealing.

```yaml
suites:
  desktop-tests:
    gate: desktop-tests
    description: Run desktop integration tests
    command: pnpm vitest --project desktop
    timeout: 5m
    interactive: true

  visual-tests:
    gate: visual-tests
    command: pnpm test:visual
    depends_on:
      - desktop-tests
```

### Suite Fields

| Field         | Type     | Required | Default | Description                                    |
| ------------- | -------- | -------- | ------- | ---------------------------------------------- |
| `gate`        | string   | Yes\*    | -       | Gate slug this suite references                |
| `description` | string   | No       | -       | Human-readable description                     |
| `command`     | string   | No       | -       | Command to execute                             |
| `timeout`     | string   | No       | -       | Command timeout (duration string)              |
| `interactive` | boolean  | No       | `false` | Whether tests require user interaction         |
| `invalidates` | string[] | No       | -       | Other suite slugs this invalidates when sealed |
| `depends_on`  | string[] | No       | -       | Suite slugs that must be sealed first          |

\*Or define `packages` for legacy fingerprint-based suites.

### Legacy Suite Format

For backward compatibility, suites can define their own fingerprint instead of referencing a gate:

```yaml
suites:
  unit-tests:
    packages:
      - '@myorg/core'
      - '@myorg/utils'
    files:
      - src/**/*.ts
    ignore:
      - '**/*.test.ts'
    command: pnpm test:unit
```

| Field      | Type     | Required | Description                  |
| ---------- | -------- | -------- | ---------------------------- |
| `packages` | string[] | Yes\*    | Package names to fingerprint |
| `files`    | string[] | No       | Additional file patterns     |
| `ignore`   | string[] | No       | Patterns to exclude          |

\*Required if `gate` is not specified.

---

## Groups

Groups organize suites for convenience.

```yaml
groups:
  fast:
    - unit-tests
    - lint
  slow:
    - integration-tests
    - visual-tests
  all:
    - unit-tests
    - lint
    - integration-tests
    - visual-tests
```

Groups are informational — use them to document which suites belong together. To run multiple suites, use `--all` with `--filter`:

```bash
npx attest-it run --all --filter "unit-*"
```

---

## Local Identity Configuration

Your identity is stored at `~/.config/attest-it/config.yaml`.

```yaml
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

### Identity Fields

| Field        | Type   | Required | Description                       |
| ------------ | ------ | -------- | --------------------------------- |
| `name`       | string | Yes      | Display name                      |
| `email`      | string | No       | Email address                     |
| `github`     | string | No       | GitHub username                   |
| `publicKey`  | string | Yes      | Base64-encoded Ed25519 public key |
| `privateKey` | object | Yes      | Private key storage configuration |

### Private Key Storage Options

#### Filesystem

```yaml
privateKey:
  type: file
  path: ~/.config/attest-it/key.pem
```

| Field  | Type   | Required | Description          |
| ------ | ------ | -------- | -------------------- |
| `type` | `file` | Yes      | Provider type        |
| `path` | string | Yes      | Path to PEM key file |

#### macOS Keychain

```yaml
privateKey:
  type: keychain
  service: attest-it
  account: alice
```

| Field     | Type       | Required | Description           |
| --------- | ---------- | -------- | --------------------- |
| `type`    | `keychain` | Yes      | Provider type         |
| `service` | string     | Yes      | Keychain service name |
| `account` | string     | Yes      | Keychain account name |

**Requirements:** macOS only

#### 1Password

```yaml
privateKey:
  type: 1password
  vault: Private
  item: attest-it-signing-key
  account: user@example.com # optional
```

| Field     | Type        | Required | Description                     |
| --------- | ----------- | -------- | ------------------------------- |
| `type`    | `1password` | Yes      | Provider type                   |
| `vault`   | string      | Yes      | 1Password vault name            |
| `item`    | string      | Yes      | Item name in vault              |
| `account` | string      | No       | 1Password account (if multiple) |

**Requirements:** 1Password CLI (`op`) must be installed

---

## Verification States

When `attest-it verify` runs, each gate returns one of these states:

| State                  | Exit | Description                             |
| ---------------------- | ---- | --------------------------------------- |
| `VALID`                | 0    | Seal valid, signature verified, current |
| `MISSING`              | 1    | No seal found for gate                  |
| `STALE`                | 0    | Seal exceeds maxAge (warning only)      |
| `FINGERPRINT_MISMATCH` | 1    | Code changed since seal was created     |
| `INVALID_SIGNATURE`    | 1    | Signature verification failed           |
| `UNKNOWN_SIGNER`       | 1    | Signer not in team configuration        |

### Exit Codes

| Code | Meaning                            |
| ---- | ---------------------------------- |
| 0    | All gates valid (STALE is warning) |
| 1    | One or more gates invalid          |
| 2    | No gates defined                   |
| 3    | Configuration error                |

---

## Path Resolution

**Repository-relative paths** (default):

```yaml
settings:
  attestationsPath: .attest-it/seals.json
  # Resolves to: /path/to/repo/.attest-it/seals.json
```

**Home directory paths** (`~`):

```yaml
privateKey:
  type: file
  path: ~/.config/attest-it/key.pem
  # Resolves to: /Users/alice/.config/attest-it/key.pem
```

---

## JSON Schema

JSON Schema files are available for editor validation and autocompletion:

- **Policy/combined config:** `schemas/policy.schema.json`
- **Operational config:** `schemas/config.schema.json`

Configure your editor to use these schemas for `.attest-it/config.yaml` files.

### VS Code Example

Add to `.vscode/settings.json`:

```json
{
  "yaml.schemas": {
    "./schemas/policy.schema.json": ".attest-it/config.yaml"
  }
}
```

---

## Complete Example

### Project Configuration

```yaml
# .attest-it/config.yaml
version: 1

settings:
  maxAgeDays: 30
  attestationsPath: .attest-it/seals.json

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

  claude-integration:
    name: Claude Integration Tests
    description: Tests verifying Claude Code integration
    authorizedSigners: [alice]
    fingerprint:
      paths:
        - packages/claude-tools/**/*.ts
    maxAge: 14d

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
    timeout: 5m
    interactive: true

  claude-integration:
    gate: claude-integration
    command: pnpm vitest --project ai-integration
    interactive: true

  visual-tests:
    gate: visual-tests
    command: pnpm test:visual
    interactive: true

groups:
  desktop:
    - desktop-vscode
    - visual-tests
  ai:
    - claude-integration
```

---

## Troubleshooting

### Configuration Not Found

```
Error: Configuration file not found
```

**Solution:** Run `npx attest-it init` or create `.attest-it/config.yaml` manually.

### Version Incompatible Error

```
Error: This configuration requires attest-it version X.Y.Z or newer, but you are running A.B.C.
```

**Cause:** Your attest-it installation is older than what this project's configuration requires.

**Solution:**

1. Upgrade attest-it: `pnpm add -D @attest-it/cli@^X.Y.Z && pnpm install`
2. Or use the project's local installation: `pnpm exec attest-it <command>`

### No Identity Configured

```
Error: No active identity found
```

**Solution:** Run `npx attest-it identity create` to set up your identity.

### Not Authorized to Seal Gate

```
Error: Not authorized to seal gate 'my-gate'
```

**Solution:** Add your team member slug to the gate's `authorizedSigners` array.

### Key Provider Not Available

```
Error: Key provider 'keychain' is not available on this platform
```

**Solution:** Use a different key provider (`file` or `1password`).

### Invalid Duration

```
Error: Duration must be a valid duration string
```

**Solution:** Use formats like `30d`, `7d`, `24h`, `1w`.

---

## See Also

- [Getting Started](getting-started.md) - Initial setup guide
- [GitHub Integration](github-integration.md) - CI configuration
- [Writing Desktop Tests](writing-desktop-tests.md) - Test patterns
