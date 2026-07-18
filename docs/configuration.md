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
| `rootGate`   | object | No       | -       | Trust anchor over `policy.yaml` (see below)       |
| `team`       | object | No       | -       | Team member definitions                           |
| `gates`      | object | No       | -       | Gate definitions                                  |

### Root Gate (`rootGate`)

The `rootGate` section makes `policy.yaml` itself a sealed, gated artifact — the
**trust anchor**. It names the **root signers**: the only identities allowed to
authorize a change to the trust-critical policy. When present, `attest-it verify`
(and the GitHub Action) verify the root seal over `policy.yaml` **before**
evaluating any other gate; a gate is never evaluated against a policy whose own
root-gate seal did not verify.

```yaml
rootGate:
  authorizedSigners:
    - alice
  maxAge: 365d
  description: Trust anchor over .attest-it/policy.yaml
```

| Field               | Type            | Required | Default | Description                                                |
| ------------------- | --------------- | -------- | ------- | ---------------------------------------------------------- |
| `authorizedSigners` | array of string | Yes      | -       | Team member slugs allowed to seal changes to `policy.yaml` |
| `maxAge`            | duration        | No       | `365d`  | Maximum age before the root seal is considered stale       |
| `description`       | string          | No       | -       | Optional human-readable description                        |

Notes:

- `rootGate` is a dedicated top-level section, **not** an entry in `gates`. The
  gate id `__root__` is reserved and cannot be used as an ordinary gate, so a pull
  request cannot redefine which gate is root.
- The artifact the root gate covers is fixed to `policy.yaml` (there is no
  `fingerprint` field), so a branch cannot repoint it at empty content.
- Changing `authorizedSigners` changes the policy fingerprint and requires a fresh
  root seal from an **existing** root signer — a branch cannot bootstrap a new root
  of trust for itself.

**Bootstrap ceremony** (one human-run step establishes the trust anchor):

```bash
attest-it identity create --name "Alice" --slug alice   # once, general onboarding
attest-it init --root-signer alice                       # establishes + seals the root gate
```

After changing the trust-critical policy later, re-anchor it as a root signer:

```bash
attest-it seal --root
```

If a repository defines no `rootGate`, it is reported as "not trust-anchored" and
verification proceeds as before (backward compatible). See
[`threat-model.md`](./threat-model.md) for the full threat model and the
recommended repository posture.

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
  sealsPath: .attest-it/seals/
```

| Field              | Type    | Required | Default                        | Description                                                                                                                  |
| ------------------ | ------- | -------- | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| `maxAgeDays`       | integer | No       | `30`                           | Default maximum seal age in days                                                                                             |
| `publicKeyPath`    | string  | No       | `.attest-it/pubkey.pem`        | Accepted but not currently read                                                                                              |
| `attestationsPath` | string  | No       | `.attest-it/attestations.json` | Accepted but not currently read                                                                                              |
| `sealsPath`        | string  | No       | `.attest-it/seals/`            | Seal storage **directory** -- the only one of these four settings that actually governs where seals are read from/written to |

Only `sealsPath` currently has an effect: every command that reads or writes
seals (`seal`, `run`, `verify`, `status`, `prune`, `team remove`) resolves the
seal storage directory from `settings.sealsPath`. `publicKeyPath` and
`attestationsPath` are accepted by the schema (with defaults) but nothing in
the codebase reads them back -- setting either has no observable effect.

#### Seal storage layout (file-per-seal)

Seals are stored **one file per (gate, signer)** under the `sealsPath`
directory, using a deterministic, collision-safe path:

```text
.attest-it/seals/<gate-slug>/<signer-slug>.seal
```

Each `.seal` file holds a single seal. Because disjoint gates (and disjoint
signers of the same gate) live in separate files, two parallel proposal PRs that
each add one tool and one seal never touch a shared file and therefore **merge
without seal-storage conflicts**. The slug for each path segment is
`<readable>-<sha256-prefix>`, so two distinct identifiers can never collide on
disk (even on case-insensitive filesystems). The slug is purely organizational:
a seal's cryptographic content is bound to its artifact fingerprint, not to its
storage path. The root gate's seal is stored under the reserved `__root__` gate
directory alongside ordinary gate seals.

> **Migration from the monolithic format.** Earlier versions stored all seals in
> a single monolithic `.attest-it/seals.json` (or `seals.yaml`) file. On the
> first seal read/write, a repository still carrying such a file is migrated
> automatically to the file-per-seal layout and the old monolith is deleted — no
> manual step is required. A legacy `sealsPath` still pointing at
> `.attest-it/seals.json` is transparently treated as the `.attest-it/seals/`
> directory, so an existing (root-gate-sealed) `policy.yaml` never needs
> rewriting.

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

| Field               | Type                  | Required | Default    | Description                                                    |
| ------------------- | --------------------- | -------- | ---------- | -------------------------------------------------------------- |
| `name`              | string                | Yes      | -          | Display name (min 1 character)                                 |
| `description`       | string                | Yes      | -          | Human-readable description (min 1 character)                   |
| `kind`              | `single` \| `pattern` | No       | `single`   | How matched files map to seals (see [Gate Kinds](#gate-kinds)) |
| `authorizedSigners` | string[]              | Yes      | -          | Team member slugs who can seal (min 1)                         |
| `fingerprint`       | object                | Yes      | -          | Fingerprint configuration                                      |
| `maxAge`            | string                | No       | indefinite | Maximum seal age (duration string). Omit to never expire.      |

### Gate Kinds

A gate's `kind` controls how its matched files map to seals:

- **`single`** (the default when `kind` is omitted): every matched file is combined
  into **one** fingerprint covered by **one** seal. Changing any matched file
  invalidates the gate's single seal. This is the historical gate behavior.
- **`pattern`**: each matched file is fingerprinted and sealed **independently**.
  Sealing `tools/a.sh` says nothing about `tools/b.sh`, and a **new** file matching
  the gate's globs simply shows up as unsealed — no `policy.yaml` edit (and therefore
  no re-seal of unrelated files) is required. Changing one byte of a sealed file flips
  only that file to invalid; its siblings are unaffected.

```yaml
# .attest-it/policy.yaml — a pattern gate: one definition, per-file seals
gates:
  tools:
    name: Tool Scripts
    description: Each tool script is attested independently
    kind: pattern
    authorizedSigners:
      - alice
    fingerprint:
      paths:
        - tools/*.sh
    # maxAge omitted → these seals never expire (valid until content changes)
```

Under a pattern gate, `status` and `verify` report one row **per matched file**
(deterministically ordered by path), each with its own sealed/unsealed/invalid state.

### Optional `maxAge` (indefinite gates)

`maxAge` is optional. When omitted, the gate **never expires**: `verify` and `status`
never report an age-based (`STALE`) result for it, regardless of how old the seal is —
the seal stays valid until the covered content changes. Provide a duration string only
when you want seals to be considered stale after a fixed period.

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

Your identity is stored at `~/.config/attest-it/config.yaml`. This file uses the v2 schema:
a top-level `version: 2`, and a flat VaultKeeper `id` per identity's `privateKey` in place of
the old v1 per-provider identifier fields (`item`, `service`, `account`). One v1 field
survives in v2: the `1password` backend can still carry an optional `vault` name alongside
its opaque `id` (see [1Password](#1password) below). This is the actual shape `attest-it
identity create` writes — verified by generating a fresh identity, not hand-written:

```yaml
version: 2
activeIdentity: work

identities:
  work:
    name: Alice Smith
    email: alice@example.com
    github: alicedev
    publicKey: MCowBQYDK2VwAyEAabc123...
    privateKey:
      type: 1password
      id: attest-it-work-1a2b3c4d-5678-90ab-cdef-1234567890ab
      vault: Work

  personal:
    name: Alice Smith
    email: alice@personal.com
    publicKey: MCowBQYDK2VwAyEAdef456...
    privateKey:
      type: keychain
      id: attest-it-personal-2b3c4d5e-6789-01bc-def2-234567890abc
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

All backends store the private key itself via VaultKeeper, keyed by an opaque `id` that
`identity create` generates -- `config.yaml` never holds a keychain service string or
1Password item name directly (those were the old v1 per-provider fields). Two exceptions:
the `1password` variant can still carry an optional `vault` name (see below), and the legacy
`filesystem` variant produced by a v1-to-v2 migration still stores a raw `path` (see
[Path Resolution](#path-resolution)).

#### Filesystem

```yaml
privateKey:
  type: file
  id: attest-it-work-1a2b3c4d-5678-90ab-cdef-1234567890ab
```

| Field  | Type   | Required | Description                              |
| ------ | ------ | -------- | ---------------------------------------- |
| `type` | `file` | Yes      | Provider type                            |
| `id`   | string | Yes      | Opaque VaultKeeper secret ID for the key |

#### macOS Keychain

```yaml
privateKey:
  type: keychain
  id: attest-it-personal-2b3c4d5e-6789-01bc-def2-234567890abc
```

| Field  | Type       | Required | Description                              |
| ------ | ---------- | -------- | ---------------------------------------- |
| `type` | `keychain` | Yes      | Provider type                            |
| `id`   | string     | Yes      | Opaque VaultKeeper secret ID for the key |

**Requirements:** macOS only

#### 1Password

```yaml
privateKey:
  type: 1password
  id: attest-it-work-3c4d5e6f-7890-12cd-ef34-34567890abcd
  vault: Work
```

| Field   | Type        | Required | Description                              |
| ------- | ----------- | -------- | ---------------------------------------- |
| `type`  | `1password` | Yes      | Provider type                            |
| `id`    | string      | Yes      | Opaque VaultKeeper secret ID for the key |
| `vault` | string      | No       | 1Password vault name, for display/lookup |

**Requirements:** The VaultKeeper-backed 1Password backend uses the 1Password
SDK ([`@1password/sdk`](https://www.npmjs.com/package/@1password/sdk)) — a
`vaultkeeper` optional peer dependency that attest-it installs on your behalf
(it ships as a dependency of `@attest-it/core`). The legacy 1Password CLI (`op`)
is **no longer required** for this path. Authenticate the SDK with a 1Password
[service account token](https://developer.1password.com/docs/service-accounts/)
(`OP_SERVICE_ACCOUNT_TOKEN`) as documented by VaultKeeper.

### Migrating Legacy Identities

An identity whose `privateKey.type` is still the legacy `filesystem` shape (see
[Path Resolution](#path-resolution)) reads its private key directly off disk instead of through
VaultKeeper. Run `attest-it identity migrate` to import every legacy identity's key into
VaultKeeper and rewrite its config record to the v2 `file`/`keychain`/`1password`/`yubikey` shape:

```bash
attest-it identity migrate            # migrate every legacy identity, prompting for confirmation
attest-it identity migrate alice      # migrate only the "alice" identity
attest-it identity migrate --yes      # non-interactive: skip the confirmation prompt
attest-it identity migrate --storage keychain   # import into a backend other than the default `file`
attest-it identity migrate --keep-files         # keep the original key file(s) after migrating
```

For each identity, `migrate`:

1. Reads the legacy PEM file and, if it is passphrase-encrypted, resolves the passphrase the same
   way `run`/`seal` do (`ATTEST_IT_KEY_PASSPHRASE` env var, or an interactive prompt when one flag
   is missing and stdin is a TTY).
2. Imports the exact PEM into the target VaultKeeper backend (default: `file`) — the identity's
   public key never changes, since it's the same keypair, just relocated storage.
3. **Verifies a real sign/verify round-trip** against the identity's already-recorded public key
   using the newly-imported VaultKeeper-backed key.
4. Only after that verification succeeds does it update `config.yaml`'s `privateKey` field and
   delete the original legacy key file (unless `--keep-files` is passed).

If verification fails for any reason, the just-imported VaultKeeper secret is rolled back, the
legacy key file is left untouched, and `config.yaml` is not modified — migration is fail-closed. A
second run with nothing left to migrate exits `0` and reports there is nothing to do.

**Note:** the private key is imported via VaultKeeper's plain secret store (the same path
`identity create` uses today), not VaultKeeper's delegated-signing key namespace — enrolling into
that namespace (`generateSigningKey`) always mints a brand-new keypair, which would change the
identity's public key. This does not affect signing: the imported key still signs through the
same VaultKeeper-backed `getPrivateKey()` path used by every other non-delegated-signing key.
Migrated keys therefore do not yet get delegated signing's no-disk-write benefit; re-enrolling
them once VaultKeeper offers a public-key-preserving external-key import is tracked in
[#122](https://github.com/mike-north/attest-it/issues/122).

---

## Verification States

Both `attest-it verify` and `attest-it status` evaluate each gate to one of the same states
below and display it. The **Exit** column applies only to `verify` — it is the enforcement
command, and this is the exit code it returns when a gate is in that state. `status` is
purely informational: it always exits `0` (`SUCCESS`) after displaying these states,
including `MISSING`, `FINGERPRINT_MISMATCH`, `INVALID_SIGNATURE`, and `UNKNOWN_SIGNER`. See
[Exit Codes](#exit-codes) below.

| State                  | `verify` Exit | Description                             |
| ---------------------- | ------------- | --------------------------------------- |
| `VALID`                | 0             | Seal valid, signature verified, current |
| `MISSING`              | 1             | No seal found for gate                  |
| `STALE`                | 0             | Seal exceeds maxAge (warning only)      |
| `FINGERPRINT_MISMATCH` | 1             | Code changed since seal was created     |
| `INVALID_SIGNATURE`    | 1             | Signature verification failed           |
| `UNKNOWN_SIGNER`       | 1             | Signer not in team configuration        |

### Exit Codes

The exit codes below are defined once in `packages/cli/src/utils/exit-codes.ts` and used
across commands, but `verify` and `status` use them differently:

| Code | Constant           | Meaning                                                                                |
| ---- | ------------------ | -------------------------------------------------------------------------------------- |
| 0    | SUCCESS            | All gates valid (STALE is a warning only)                                              |
| 1    | FAILURE            | One or more gates invalid                                                              |
| 2    | NO_WORK            | Configuration loaded successfully, but zero gates are defined — nothing to verify      |
| 3    | CONFIG_ERROR       | No discoverable configuration, an unreadable `--config` path, or invalid configuration |
| 4    | CANCELLED          | User cancelled the operation (a declined or force-closed/interrupted prompt)           |
| 5    | MISSING_KEY        | Required private key file is missing                                                   |
| 6    | DIRTY_WORKING_TREE | `run` refused because the git working tree has uncommitted changes                     |

**A cancelled prompt is `CANCELLED` (4), never `CONFIG_ERROR`** — whether the user explicitly
declines a confirmation (e.g. types `n` at "Create seal for gate 'x'?"), presses Ctrl-C, or the
prompt is force-closed/interrupted another way (e.g. a piped stdin that closes mid-prompt).
Ctrl-C is `CANCELLED` (4) everywhere in the CLI, not the shell's conventional 130 — a process-wide
`SIGINT` handler (`registerSigintHandler` in `packages/cli/src/index.ts`) guarantees this for the
whole process lifetime, not just while `@inquirer/core`'s own force-close detection is active.

**A missing required flag with no interactive terminal available is `CONFIG_ERROR` (3), not
`CANCELLED`.** For example, `attest-it run --suite x < /dev/null` without `--yes` fails fast with
an error naming the missing flag _before_ any prompt starts — there's nothing to cancel, so it's
a usage/configuration error like any other, not a cancellation.

**A dirty working tree is `DIRTY_WORKING_TREE` (6), never `CONFIG_ERROR`.** `run` refuses to run
a suite when the working tree has uncommitted changes (unless `ATTEST_IT_ALLOW_DIRTY` is set) —
a precondition failure, not a configuration problem.

**`status` is informational and always exits `SUCCESS` on gate results -- use `verify` to
gate CI.** `status` reports gate states (`MISSING`, `FINGERPRINT_MISMATCH`,
`INVALID_SIGNATURE`, `UNKNOWN_SIGNER`, `STALE`, etc.) so you can see what's wrong, but it
never exits `FAILURE` for them -- it exits `SUCCESS` (0) as long as it successfully produced
a report. Only `verify` returns `FAILURE` (1) when a gate is invalid. **Do not wire `status`
into a CI gate expecting it to fail the build** -- it won't; wire `verify` instead. The one
case where `status` _does_ fail closed is a missing/unreadable **configuration** itself (see
below), which is a different concern from a gate's verification state.

**Missing configuration is fail-closed, not fail-open.** If no `.attest-it/policy.yaml` (or
`.yml`/`.json`) can be found — and no `--config <path>` override resolves either — both
`verify` and `status` exit `CONFIG_ERROR`, never `SUCCESS`. This applies even when the
directory has no `.attest-it/` at all: a CI job that forgot to check out its configuration
fails loudly instead of reporting a false green. Run `attest-it init` to scaffold one.

A configuration that loads successfully but defines zero gates is different from a missing
configuration — the config is valid, there is simply nothing to check. That case exits
`NO_WORK` (2) rather than `CONFIG_ERROR`, and rather than silently exiting `SUCCESS` (which
would make "verified" indistinguishable from "verified nothing"). This `NO_WORK` behavior is
also shared by both `verify` and `status`.

---

## Path Resolution

**Repository-relative paths** (default):

```yaml
# .attest-it/policy.yaml
settings:
  sealsPath: .attest-it/seals/
  # Resolves to: /path/to/repo/.attest-it/seals/
```

**Home directory paths** (`~`):

```yaml
privateKey:
  type: filesystem
  path: ~/.config/attest-it/key.pem
  # Resolves to: /Users/alice/.config/attest-it/key.pem
```

`type: filesystem` is the legacy shape that a v1-to-v2 migration produces for an old
path-based key; it still supports `~` expansion. A fresh `identity create` instead writes
`type: file` with an opaque VaultKeeper `id` (see [Local Identity
Configuration](#local-identity-configuration)) — there is no raw path to resolve for that
shape.

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
  sealsPath: .attest-it/seals/

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

### Working Tree Has Uncommitted Changes

```
✗ Working tree has uncommitted changes. Please commit or stash before attesting.
```

**Cause:** `attest-it run --suite` (and `run` in interactive mode) refuses to run and seal
against a dirty working tree -- this includes untracked files, so newly-created config or
source files that haven't been added and committed yet will trigger it, not just modified
tracked files. This precondition exists so the fingerprint a seal signs always corresponds
to a specific commit, not to working-tree state that could change or vanish afterward.

**Solution:** Commit (or stash) all pending changes -- including any `.attest-it/policy.yaml`
/ `.attest-it/config.yaml` edits from setup -- before running `attest-it run --suite`. See
[Step 3b of Getting Started](getting-started.md#step-3b-commit-your-configuration) for the
documented order. To opt out (e.g. for local dogfooding of this repo on itself), set
`ATTEST_IT_ALLOW_DIRTY=1`; this is not recommended for normal project use.

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
