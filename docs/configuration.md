# Configuration Reference

Complete reference for configuring attest-it.

## Overview

attest-it uses three types of configuration, split by trust level:

1. **Policy configuration** (`.attest-it/policy.yaml`) - Trust-critical: team members and gates. Loaded from your repository's **default branch**, so pull requests cannot tamper with trust data.
2. **Operational configuration** (`.attest-it/config.yaml`) - Non-security-critical: suites (test commands) and groups. Every suite must reference a gate defined in `policy.yaml`. Safe to load from PR branches.
3. **Local identity configuration** (`~/.config/attest-it/config.yaml`) - Your personal signing identity.

Run `attest-it init` to scaffold both `policy.yaml` and `config.yaml`. If you have an existing legacy unified `config.yaml` (a single file that held `team`, `gates`, and `suites` together), run `attest-it init --migrate` to split it into the pair automatically.

## Quick Start Example

```yaml
# .attest-it/policy.yaml
version: 1

settings:
  maxAgeDays: 30

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
```

```yaml
# .attest-it/config.yaml
version: 1

settings: {}

suites:
  desktop-tests:
    gate: desktop-tests
    command: pnpm test:desktop
```

---

## Policy Configuration Schema (`policy.yaml`)

### Root Fields

| Field        | Type   | Required | Default | Description                                       |
| ------------ | ------ | -------- | ------- | ------------------------------------------------- |
| `version`    | `1`    | Yes      | -       | Schema version (must be `1`)                      |
| `minVersion` | string | No       | -       | Minimum attest-it version required (e.g. "0.9.0") |
| `settings`   | object | No       | `{}`    | Policy settings                                   |
| `team`       | object | No       | -       | Team member definitions                           |
| `gates`      | object | No       | -       | Gate definitions                                  |

## Operational Configuration Schema (`config.yaml`)

### Root Fields

| Field        | Type   | Required | Default | Description                                       |
| ------------ | ------ | -------- | ------- | ------------------------------------------------- |
| `version`    | `1`    | Yes      | -       | Schema version (must be `1`)                      |
| `minVersion` | string | No       | -       | Minimum attest-it version required (e.g. "0.9.0") |
| `settings`   | object | No       | `{}`    | Operational settings                              |
| `suites`     | object | Yes      | -       | Suite definitions (min 1 suite)                   |
| `groups`     | object | No       | -       | Named groups of suites                            |

---

## Settings

### Policy Settings (`policy.yaml`)

```yaml
settings:
  maxAgeDays: 30
  publicKeyPath: .attest-it/pubkey.pem
  attestationsPath: .attest-it/attestations.json
  sealsPath: .attest-it/seals.json
```

| Field              | Type    | Required | Default                        | Description                                                                                                              |
| ------------------ | ------- | -------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| `maxAgeDays`       | integer | No       | `30`                           | Default maximum seal age in days                                                                                         |
| `publicKeyPath`    | string  | No       | `.attest-it/pubkey.pem`        | Accepted but not currently read                                                                                          |
| `attestationsPath` | string  | No       | `.attest-it/attestations.json` | Accepted but not currently read                                                                                          |
| `sealsPath`        | string  | No       | `.attest-it/seals.json`        | Path to the seals file -- the only one of these four settings that actually governs where seals are read from/written to |

Only `sealsPath` currently has an effect: every command that reads or writes
seals (`seal`, `run`, `verify`, `status`, `prune`, `team remove`) resolves the
seals file location from `settings.sealsPath`. `publicKeyPath` and
`attestationsPath` are accepted by the schema (with defaults) but nothing in
the codebase reads them back -- setting either has no observable effect.

### Operational Settings (`config.yaml`)

```yaml
settings:
  defaultCommand: pnpm test
  keyProvider:
    type: filesystem
    options:
      privateKeyPath: ~/.config/attest-it/key.pem
```

| Field            | Type   | Required | Default | Description                |
| ---------------- | ------ | -------- | ------- | -------------------------- |
| `defaultCommand` | string | No       | -       | Default command for suites |
| `keyProvider`    | object | No       | -       | Key provider configuration |

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

Either `policy.yaml` or `config.yaml` can specify a minimum version of attest-it required to use it:

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

Defined in `policy.yaml`. Team members who can create seals. Each member has a unique slug identifier (the key).

```yaml
# .attest-it/policy.yaml
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

Defined in `policy.yaml`. Gates define checkpoints that require human attestation. A gate specifies which code is covered (via its fingerprint) and who can sign.

```yaml
# .attest-it/policy.yaml
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

The fingerprint determines which files are hashed. When any fingerprinted file changes, the seal becomes invalid. Fingerprint configuration always lives on the **gate** (in `policy.yaml`), never on a suite.

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

Defined in `config.yaml`. Suites bind a runnable command to a gate. Every suite **must** reference a gate defined in `policy.yaml` — the gate is the single source of truth for the suite's fingerprint configuration and authorized signers. There is no gate-less suite shape.

```yaml
# .attest-it/config.yaml
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
| `gate`        | string   | Yes      | -       | Gate slug this suite references                |
| `description` | string   | No       | -       | Human-readable description                     |
| `command`     | string   | No       | -       | Command to execute                             |
| `timeout`     | string   | No       | -       | Command timeout (duration string)              |
| `interactive` | boolean  | No       | `false` | Whether tests require user interaction         |
| `invalidates` | string[] | No       | -       | Other suite slugs this invalidates when sealed |
| `depends_on`  | string[] | No       | -       | Suite slugs that must be sealed first          |

---

## Groups

Defined in `config.yaml`. Groups organize suites for convenience.

```yaml
# .attest-it/config.yaml
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

Groups are selectable in interactive mode (run `npx attest-it run` with no `--suite`/`--all`, then
press `g1`, `g2`, etc. to select all suites in a group). There is no `--group` flag for direct,
non-interactive runs; use `--filter <pattern>` to match suites by name instead:

```bash
npx attest-it run --filter 'unit-*'
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

`attest-it verify` and `attest-it status` share the same exit-code contract, defined in
`packages/cli/src/utils/exit-codes.ts`:

| Code | Constant           | Meaning                                                                                |
| ---- | ------------------ | -------------------------------------------------------------------------------------- |
| 0    | SUCCESS            | All gates valid (STALE is a warning only)                                              |
| 1    | FAILURE            | One or more gates invalid                                                              |
| 2    | NO_WORK            | Configuration loaded successfully, but zero gates are defined — nothing to verify      |
| 3    | CONFIG_ERROR       | No discoverable configuration, an unreadable `--config` path, or invalid configuration |
| 4    | CANCELLED          | User cancelled the operation (a declined or force-closed/interrupted prompt)           |
| 5    | MISSING_KEY        | Required private key file is missing                                                   |
| 6    | DIRTY_WORKING_TREE | `run`/`seal` refused because the git working tree has uncommitted changes              |

**A cancelled prompt is `CANCELLED` (4), never `CONFIG_ERROR`** — whether declined or
force-closed/interrupted (e.g. Ctrl-C, or a piped stdin that closes mid-prompt).

**A dirty working tree is `DIRTY_WORKING_TREE` (6), never `CONFIG_ERROR`.** `run` refuses to run
a suite when the working tree has uncommitted changes (unless `ATTEST_IT_ALLOW_DIRTY` is set) —
a precondition failure, not a configuration problem.

**Missing configuration is fail-closed, not fail-open.** If no `.attest-it/policy.yaml` (or
`.yml`/`.json`) can be found — and no `--config <path>` override resolves either — both
`verify` and `status` exit `CONFIG_ERROR`, never `SUCCESS`. This applies even when the
directory has no `.attest-it/` at all: a CI job that forgot to check out its configuration
fails loudly instead of reporting a false green. Run `attest-it init` to scaffold one.

A configuration that loads successfully but defines zero gates is different from a missing
configuration — the config is valid, there is simply nothing to check. That case exits
`NO_WORK` (2) rather than `CONFIG_ERROR`, and rather than silently exiting `SUCCESS` (which
would make "verified" indistinguishable from "verified nothing").

---

## Path Resolution

**Repository-relative paths** (default):

```yaml
# .attest-it/policy.yaml
settings:
  sealsPath: .attest-it/seals.json
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

- **Policy config:** `schemas/v1/policy.schema.json`
- **Operational config:** `schemas/v1/config.schema.json`

Configure your editor to use these schemas for `.attest-it/policy.yaml` and `.attest-it/config.yaml` respectively.

### VS Code Example

Add to `.vscode/settings.json`:

```json
{
  "yaml.schemas": {
    "./schemas/v1/policy.schema.json": ".attest-it/policy.yaml",
    "./schemas/v1/config.schema.json": ".attest-it/config.yaml"
  }
}
```

Or, since `attest-it init` writes a `# yaml-language-server: $schema=...` directive at the top of each generated file, most editors (including VS Code with the YAML extension) will pick up schema validation automatically without any additional settings.

---

## Complete Example

### Policy Configuration

```yaml
# .attest-it/policy.yaml
version: 1

settings:
  maxAgeDays: 30
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
```

### Operational Configuration

```yaml
# .attest-it/config.yaml
version: 1

settings: {}

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
✗ Policy file not found. Expected .attest-it/policy.yaml, .attest-it/policy.yml, or .attest-it/policy.json
Run `attest-it init` to create a configuration.
```

`verify` and `status` exit `CONFIG_ERROR` (3) in this case, not `SUCCESS` — a missing
configuration must never be reported as a passing verification.

**Solution:** Run `npx attest-it init` or create `.attest-it/policy.yaml` and `.attest-it/config.yaml` manually.

If you passed `--config <path>` explicitly and that path doesn't exist or can't be read, the
error names the path you gave instead of the auto-detected candidates.

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

**Solution:** Add your team member slug to the gate's `authorizedSigners` array in `policy.yaml`.

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

### Suite Missing Gate Reference

```
Error: Operational configuration validation failed:
  - suites.my-suite.gate: Required
```

**Cause:** Every suite must reference a gate; there is no gate-less suite shape.

**Solution:** Add a `gate: <gate-slug>` field to the suite, referencing a gate defined in `policy.yaml`.

---

## See Also

- [Getting Started](getting-started.md) - Initial setup guide
- [GitHub Integration](github-integration.md) - CI configuration
- [Writing Desktop Tests](writing-desktop-tests.md) - Test patterns
