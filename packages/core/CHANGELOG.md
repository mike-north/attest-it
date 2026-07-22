# @attest-it/core

## 0.11.0

### Minor Changes

- 1cfa5f7: Eliminate legacy config generations: enforce a single canonical split-config model.

  attest-it is still in the 0.x series, where breaking changes are expected and are shipped as
  `minor` — see CONTRIBUTING.md. This one removes every remaining path around trust-anchored,
  split configuration:
  - **Silent unified-config fallback removed.** `loadSplitConfig`/`loadSplitConfigSync` no longer transparently load a legacy unified `config.yaml` when `policy.yaml` is absent. A repo with only a unified config now fails to load with an explicit error pointing at the migration path, instead of silently behaving as if it had already migrated.
  - **`attest-it init --migrate` added.** A one-shot, migrex-driven migration converts an existing unified `config.yaml` into split `policy.yaml` + `config.yaml` (operational), reusing the existing migration graph infrastructure.
  - **Legacy `packages`-only suite format removed.** `gate` is now a required field on every suite; the schema no longer accepts a suite shaped as `{ packages: string[] }` with no `gate` reference.
  - **Validation bypass removed.** The `if (gateName === undefined) continue` skip branch in `validateSuiteGateReferences` is deleted — every suite's authorized signers are now validated against `policy.yaml`'s `team`/`gates` unconditionally. Previously a schema-legal `packages`-only suite could add authorized signers that were never checked against trusted policy data.
  - **Generation-1 attestation code paths removed.** `attestation.ts`, `verify.ts`, `config.ts` (`AttestItConfig`/`toAttestItConfig`), and the `Attestation`/`AttestationsFile`/`VerificationStatus`/`SuiteVerificationResult` types are deleted. The seal model (`seal/`) is now the only attestation/verification code path; `prune` is rewired onto it.

  Repos still on the unified `config.yaml` format must run the new migration path before upgrading. Repos with a `packages`-only suite must add a `gate` reference — such suites were never validated against policy and should be treated as a gap to close, not a format to preserve.

- 9e9c12a: Add a stable, versioned embeddable API surface.

  `@attest-it/core` now exports six path-keyed operations for embedders to code
  against — `listGates`, `status`, `fingerprint`, `seal`, `verifyOne`, and
  `verifyAll` — that compose the existing gate-keyed primitives into a coherent
  facade. Every operation returns a discriminated result carrying a `schemaVersion`
  and, on failure, a class from a documented taxonomy (`unsealed`,
  `fingerprint-mismatch`, `unauthorized-signer`, `untrusted-config`, `expired`,
  `malformed`). Expected failures are returned as values, not thrown. The surface
  is non-interactive apart from a key backend's own unlock.

  The `attest-it seal` CLI command gains a `--json` flag for non-interactive,
  machine-readable sealing, matching `status`/`verify`.

  Schema versioning policy: `API_SCHEMA_VERSION` is stamped on every result.
  Changing the shape of any result type or the failure-taxonomy set is a
  **breaking** release and must bump the major version and this constant.

  Also fixes a latent aliasing bug where `readSeals`/`readSealsSync` returned a
  shared mutable empty-seals object; each read now returns a fresh object.

  The `untrusted-config` taxonomy class is shipped as a documented stub: its shape
  and wiring are in place, but the underlying root-gate trust check is not yet
  implemented, so the class is not returned at runtime until that work lands. The
  contract shape will not change when it does.

- 466a11b: Enforce the root gate in the embeddable API (`verifyOne`/`verifyAll`).

  Previously the embeddable `@attest-it/core` surface performed only per-gate seal
  verification and skipped root-gate trust anchoring entirely — so an embedder
  (the surface used for custom / non-GitHub CI) got no protection against a policy
  that self-authorizes by rewriting `rootGate.authorizedSigners`/`team` and
  self-sealing. Only the CLI `verify` and the GitHub Action wired in the root-gate
  pre-step.

  `verifyOne`/`verifyAll` now run the same mandatory root-gate pre-step before
  evaluating any gate: they verify the working-tree policy's own root seal against
  a caller-supplied **trusted** policy source and fail closed with an
  `untrusted-config` result when that seal does not verify (e.g. a self-added root
  signer → `UNKNOWN_SIGNER`; an unsealed policy change → `FINGERPRINT_MISMATCH`).
  - New `VerifyOptions` (a superset of `ApiOptions`) carries the trusted source:
    `trustedConfig` (a pre-loaded base-branch `AttestItConfig`, takes precedence)
    or `trustedPolicyPath` (a path to a trusted policy file). `verifyOne`/
    `verifyAll` now accept `VerifyOptions`.
  - **Fail closed:** if the working-tree policy defines a `rootGate` but no trusted
    source is supplied, verification returns `untrusted-config` rather than
    silently trusting the working-tree anchor.
  - Un-anchored repositories (no `rootGate`) verify unchanged — no trusted source
    is required (backward compatible).

  Additive and backward-compatible: `VerifyOptions` extends `ApiOptions`, so
  existing `{ baseDir }` callers keep working. The `untrusted-config` failure class
  (previously a documented stub) is now returned at runtime.

- 39b3f22: Migrate seal storage to a file-per-seal layout for conflict-free parallel PRs.

  Seals are now stored **one file per (gate, signer)** under a deterministic,
  collision-safe path (`.attest-it/seals/<gate-slug>/<signer-slug>.seal`) instead
  of a single monolithic `seals.json`/`seals.yaml`. Two proposal PRs that each add
  one tool and one seal now land in disjoint files and merge without seal-storage
  conflicts. The path scheme leaves room for one file per (gate, artifact, signer),
  so m-of-n quorum sealing is not precluded.

  Behavior / migration notes:
  - The `sealsPath` setting now denotes the seals **directory** (default
    `.attest-it/seals/`). A legacy value still pointing at `.attest-it/seals.json`
    is transparently treated as the sibling directory, so an existing
    root-gate-sealed `policy.yaml` never needs rewriting.
  - Both retired monolithic formats (`seals.yaml` and legacy `seals.json`) are
    migrated automatically to the file-per-seal layout on the first seal
    operation, and the old monolith is deleted. No monolithic read path remains
    afterward; no manual migration step is required.
  - `SealsFile.version` is now `1 | 2` (`2` marks the file-per-seal era). The
    `readSeals`/`readSealsSync`/`writeSeals`/`writeSealsSync` signatures are
    unchanged; new `slugifySegment`, `resolveSealsRoot`, `writeSealFileSync`,
    `listStoredSealsSync`, `StoredSeal`, and `CURRENT_SEALS_VERSION` are exported
    for direct file-per-seal access.

- eeb7721: **Fixed `identity remove` leaving orphaned private-key material in VaultKeeper (security P1, issue #101).**

  `identity remove <slug>` previously reported `✓ Identity "<slug>" removed` and exited `0` without
  deleting the underlying VaultKeeper-backed secret -- only the `config.yaml` entry was removed, so
  the encrypted private-key `.enc` file stayed on disk indefinitely.
  - `identity remove` now deletes the private key by default for backends attest-it exclusively
    owns (`file`, and the legacy `filesystem` type). A new `--keep-key` flag opts out and leaves the
    key material in place; this replaces the previous opt-in `--delete-key` flag, which is removed.
  - For backends attest-it does not delete from unilaterally (`1password`, macOS `keychain`,
    `yubikey`), the command now always prints an explicit, actionable warning naming the secret and
    how to remove it yourself -- it never silently reports full removal while key material remains.
  - `@attest-it/core` gains a new `deletePrivateKey(backendType, secretId)` export (mirroring
    `storePrivateKey`) that idempotently deletes a VaultKeeper-managed secret.

- 21f3181: Make the setup command surface (`identity create`, `init`, `team add`, `team join`, `run`) non-interactive-capable, so CI, embedders, and agent-driven callers no longer hang on a TTY prompt.
  - **`identity create`** accepts `--name`, `--slug` (derived from `--name` when omitted), `--email`, `--github`, `--storage <file|keychain|1password|yubikey>`, and backend-specific flags (`--keychain-path`/`--keychain-item`, `--op-account`/`--op-vault`/`--op-item`, `--yubikey-serial`/`--encrypted-key-name`). `--passphrase-stdin` encrypts a file-backed private key with a passphrase piped via stdin (never prompted).
  - **`init`** now fails fast naming `--force` when config already exists and stdin is not a TTY, instead of hanging on the overwrite-confirmation prompt.
  - **`team add`** and **`team join`** accept `--slug`, `--name`, `--email`, `--github`, `--public-key` (add only), and `--gates` (comma-separated gate IDs); gate authorization defaults to none rather than prompting when non-interactive.
  - **`run`** accepts `-y, --yes` to auto-confirm seal creation; without it, a non-interactive run fails fast instead of hanging. Running `run` with no `--suite`/`--all` and no TTY now fails fast instead of launching an interactive UI that can never receive input. Signing with a passphrase-encrypted identity key resolves the passphrase from the `ATTEST_IT_KEY_PASSPHRASE` environment variable, an interactive prompt, or fails fast.
  - The shell-completion offer shown after `init`/`identity create` is now skipped (rather than prompting unconditionally) when stdin is not an interactive TTY.
  - Interactive mode remains the default for every command above when stdin is a TTY and flags are omitted -- no behavior change for humans running these by hand.
  - `@attest-it/core`: `generateEd25519KeyPair`/`signEd25519` gained an optional passphrase parameter, `createSeal` gained an optional `passphrase` option, and a new `isEncryptedPrivateKeyPem` helper detects passphrase-encrypted keys.

- 7d07b76: Add per-artifact **pattern gates** and make gate `maxAge` optional (default: never expires).
  - **Pattern gates.** A gate may now declare `kind: pattern` (the default remains `single`). Under a pattern gate each file matched by the gate's fingerprint globs is fingerprinted and sealed **independently**: sealing `tools/a.sh` says nothing about `tools/b.sh`, a new file matching the pattern shows up as unsealed with **no `policy.yaml` edit** (and therefore no re-seal of unrelated files), and changing one byte of a sealed file flips only that file to invalid while its siblings stay valid. `status` and `verify` report one deterministically ordered (lexicographic by path) result per matched file.
  - **Optional `maxAge`.** `maxAge` is no longer required on a gate. When omitted, the gate is **indefinite** — `verify`/`status` never report a `STALE`/age-based failure for it regardless of seal age (indefinite is the genuine default, not a large-number sentinel).
  - **New exports.** `computeFingerprintsPerFile` / `computeFingerprintsPerFileSync` (one `PerFileFingerprint` per matched file, path-bound so symlink aliases cannot share a fingerprint), `verifyPatternArtifactSeal`, and the low-level per-file seal primitives `writeSealFile` / `listStoredSeals`.
  - **Additive `Seal.artifactPath`.** Per-file seals carry an optional `artifactPath` identifying which file within a pattern gate they cover, and are stored under an artifact path segment (`<gate>/<artifact>/<signer>.seal`) reusing the existing collision-safe slug. They are written and read via the low-level per-file API and are deliberately excluded from — and never pruned by — the aggregate one-per-gate seals path, so per-file and single-gate seals coexist without clobbering each other.

  This change is fully additive: existing single-fingerprint gates and their seals behave exactly as before.

- eaab541: Rename `FingerprintOptions` fields to align with `GateConfig.fingerprint`: `packages` → `paths`, `ignore` → `exclude`.

  attest-it is still in the 0.x series, where breaking changes are expected and are shipped as
  `minor` — see CONTRIBUTING.md.

  Previously `computeFingerprint`/`computeFingerprintSync` took `{ packages, ignore, baseDir }`, while a gate's own fingerprint configuration used `{ paths, exclude }` — every call site had to rename fields when passing a gate's fingerprint config into `computeFingerprint`. `FingerprintOptions` now matches:

  ```typescript
  // Before
  computeFingerprint({ packages: ['src'], ignore: ['**/*.test.ts'] })

  // After
  computeFingerprint({ paths: ['src'], exclude: ['**/*.test.ts'] })
  ```

  Consumers calling `computeFingerprint`/`computeFingerprintSync` directly (rather than only through the CLI) must update field names.

- f943021: Add a sealed **root gate** that trust-anchors `.attest-it/policy.yaml`.

  The policy file (which holds the trust-critical `team` and `gates`) is now itself
  a gated, sealed artifact. A reserved top-level `rootGate` section names the root
  signers — the only identities allowed to authorize a change to `policy.yaml` — and
  verification checks the policy's own seal chain **first**, before evaluating any
  other gate. A gate is never evaluated against a policy whose own root-gate seal
  did not verify. This closes the headline trust gap: a pull request can no longer
  add itself to `team`, authorize itself on a gate, and pass verification.

  **Behavior change — trust-critical:**
  - **New verification pre-step.** When `policy.yaml` defines a `rootGate`,
    `attest-it verify` (and the GitHub Action) verify the root seal over the policy
    before evaluating gates. If the policy was modified without a fresh root seal
    from an existing root signer, verification **fails**, naming
    `.attest-it/policy.yaml` as the untrusted change.
  - **Changing root signers requires an existing root signer.** Editing
    `rootGate.authorizedSigners` changes the policy fingerprint and requires a new
    root seal from a current root signer — a branch cannot bootstrap a new root of
    trust for itself. In a pull-request context the Action loads the root signer set
    from the base branch, so a self-added signer is rejected as `UNKNOWN_SIGNER`.
  - **Reserved gate id.** The slug `__root__` is reserved; it cannot be used as an
    ordinary gate in `gates`.
  - **The GitHub Action** performs the same root-gate pre-step (it re-verifies on
    the base branch). Configure the verification job as a required status check.

  **Migration for existing repositories.** This change is backward compatible: a
  repository that has not defined a `rootGate` is reported as "not trust-anchored"
  and continues to verify as before. To adopt the trust anchor, run the one-step
  bootstrap ceremony:

  ```
  attest-it identity create --name "…" --slug you   # if you haven't already
  attest-it init --root-signer you                   # establishes + seals the root
  ```

  After adopting it, re-seal the root gate with `attest-it seal --root` (as a root
  signer) whenever you change the trust-critical policy.

  See `docs/threat-model.md` for the full threat model, including the recommended
  repository posture (branch protection, base-branch policy loading, CODEOWNERS, and
  post-merge re-verification) for workflow-file tampering.

- 3af350a: Make suites optional for gate-only / read-only flows.

  The operational config (`.attest-it/config.yaml`) previously required at least
  one suite — a global precondition enforced at parse time. That rejected an empty
  `suites: {}`, which is exactly what `attest-it init` scaffolds, so gate-only
  "Direct Sealing" and read-only operations failed on a freshly-initialized repo:
  `listGates`, `fingerprint`, `verifyOne`, `verifyAll`, `seal`, `status`, and
  `verify` all returned a `malformed` failure ("At least one suite must be
  defined") even though they need only policy/gate data, never a suite.

  Suites are operational data, not a global precondition. An empty (or omitted)
  `suites` map is now a valid operational config, so those flows load cleanly
  against `suites: {}`. Suite-**dependent** operations are unchanged: `run --suite
<name>` still validates that the named suite exists and fails cleanly when it
  does not — this relaxes the global precondition, not per-operation suite
  resolution.

  The relaxation is purely additive: every previously-valid config remains valid,
  and root-gate trust anchoring is unaffected (a gate-only config can still be
  root-anchored and still enforces the root gate on verify).

- 866c519: Fix two `team join` write-path bugs in the trust-critical `.attest-it/policy.yaml`:
  - `team join`/`team add` now emit block-style YAML for the `team:` section (matching the scaffold and every doc example) instead of rewriting it into flow-style, JSON-like YAML (`team: {alice: {...}}`) the moment a member is added to the scaffolded, empty `team: {}`. Untouched sections stay byte-for-byte unchanged.
  - `team join --gates <name>` / `team add --gates <name>` now validate each named gate against the gates defined in `policy.yaml` and hard-fail naming the missing gate when it isn't defined, instead of silently succeeding with the authorization as a no-op.

- 593c1c0: Adopt VaultKeeper's delegated-signing (`SigningBackend`) and presence-capability surface.
  - **Delegated signing for signing-capable backends.** `VaultKeyProvider` now uses VaultKeeper's `SigningBackend` contract (`generateSigningKey` / `getPublicKey` / `signWithKey`) when the underlying backend implements it (guarded by `isSigningBackend`). For such backends the private key is generated and held inside the backend and signing is delegated — the raw key never reaches attest-it's process memory as a file, let alone disk. Backends that only implement the base `SecretBackend` contract keep the existing `getPrivateKey()` temp-file path unchanged (additive, not a removal).
  - **`KeyProvider` interface extension (additive, optional).** Three optional members were added: `signDirectly?(keyRef, data)`, `supportsDelegatedSigning?(keyRef)`, and `getPresenceCapability?()`. Existing implementers and callers are unaffected — hence a **minor** bump, not major.
  - **Presence capability surfaced.** `attest-it identity show` now reports whether the active identity's backend enforces a fresh per-use human-presence check, fail-closed for backends that cannot prove it. New helper `getIdentityPresenceCapability()` is exported from `@attest-it/core`.
  - **New seal-signing helpers.** `createSealWithProvider()` (prefers delegated signing, falls back to the temp-file PEM path) and `createSealWithSigner()` are exported; the `seal`/`run` commands and the embeddable `seal()` API route through them.
  - **Root gate anchors with delegated keys too.** `createRootSealWithProvider()` lets a root signer whose key lives in a signing backend anchor `policy.yaml` without ever materializing the raw key; `seal --root` and `init`'s bootstrap ceremony use it, so a delegated-key identity can be a root signer.
  - **`@1password/sdk` is now an explicit dependency of `@attest-it/core`.** VaultKeeper 0.7.0 made it an optional peer for the 1Password backend (replacing the `op` CLI); declaring it keeps the VaultKeeper-backed 1Password path resolvable. Documented in the README and `docs/configuration.md`.

- 96de2a2: Isolate VaultKeeper private-key material under `ATTEST_IT_HOME`.

  Previously, `ATTEST_IT_HOME` (and the programmatic home override / `--home-dir` flag) isolated only attest-it's own `config.yaml` and public keys. The encrypted private-key `.enc` blob was still written to the real, non-sandboxed `~/.config/vaultkeeper/file/` on every `identity create`, `identity migrate`, and any seal/sign operation — breaking the "isolated state for testing / CI-safe / embeddable" contract and accumulating orphaned key files outside the configured home.
  - **Home override now propagates into VaultKeeper's config-dir resolution.** A new public `getVaultKeeperConfigDir()` resolves a sandbox-relative `<home>/vaultkeeper` directory whenever a home override is in effect (and `undefined` otherwise, preserving VaultKeeper's own default for real installs). This directory is threaded through every `BackendRegistry.create('file', …)` call — store, delete, and the retrieve/sign provider path — so key material lands under the configured home consistently.
  - **Saved public-key `.pem` files now carry real PEM markers.** `savePublicKey`/`savePublicKeySync` write a standards-compliant SPKI `-----BEGIN PUBLIC KEY-----` document instead of bare base64.
  - **The 1Password/Keychain provider-prompt banner is suppressed under `--storage file`,** which touches no external security tool.

### Patch Changes

- eaab541: Small DX and correctness fixes:
  - **`init` no longer duplicates `attest-it` into `devDependencies`** when it's already listed in `dependencies` or `devDependencies` (previously it unconditionally added/overwrote a `devDependencies` entry, which could conflict with an existing `dependencies` pin).
  - **`identity export`'s guidance comments** now point at the current `.attest-it/policy.yaml` and its `team:` section, replacing stale references to a `.attest-it/team-config.yaml` file and `members:` section that don't exist in the current split-config model.
  - **Legacy filesystem key paths (`type: 'filesystem'`) now expand a leading `~`** to the user's home directory before reading or deleting the key file. Node's `fs` APIs don't perform shell tilde expansion, so a hand-edited v1 config with a `~`-prefixed path previously failed silently (read) or deleted nothing (delete, via `identity remove`).

- e41cf4f: Fix an unhandled `ECONNRESET` that could crash `generateKeyPair` when called with an empty-string passphrase (`passphrase: ''`). The internal `runOpenSSL` helper decided whether to open an extra stdio pipe (fd 3) for the passphrase using `passphrase !== undefined`, while `generateKeyPair` decided whether to reference that fd in OpenSSL's arguments (`-pass fd:3` / `-passin fd:3`) using `if (passphrase)`. Since `''` is not `undefined` but is falsy, an empty passphrase opened fd 3 without any OpenSSL argument reading it — an unconsumed pipe that could raise an unhandled error when the OpenSSL child process exited. Both checks now consistently treat an empty string the same as no passphrase, and the passphrase pipe now has a defensive `'error'` listener.
- e41cf4f: Fix passphrase-encrypted key generation and signing failing under OpenSSL 3.6.x when the passphrase is piped via Node's `spawn` stdio. `generateKeyPair`'s public-key extraction step and `sign`'s `dgst` step now supply the passphrase through a dedicated pipe on file descriptor 3 (`-passin fd:3` / `-pass fd:3`) with stdin left as `'ignore'`, instead of `-passin stdin` / `-pass stdin`. OpenSSL 3.6.x's passphrase-reading UI routine falls back to an interactive console prompt (fatal outside a TTY) whenever fd 0 is a Node-created pipe, regardless of which fd actually carries the passphrase — this sidesteps that fallback.
- cb21b14: Fix `team join`/`team add`/`team remove` silently stripping every human-authored comment (including the `# yaml-language-server: $schema=...` directive `init` scaffolds) from `.attest-it/policy.yaml` on write.

  These commands now round-trip through a comment-preserving YAML `Document` edit (`@attest-it/core`'s new `loadEditablePolicy`/`serializeEditablePolicy`) that only replaces the specific fields that actually changed, instead of parsing to a plain object and re-serializing the whole file. Untouched comments -- including the schema directive, trust-model header, and commented onboarding examples -- as well as untouched sibling fields on a partially-changed section (e.g. an unrelated gate's `name`/`fingerprint` when only its `authorizedSigners` changed), now survive every write.

## 0.10.1

### Patch Changes

- a2cd520: Integrate migrex for versioned configuration management.

  Adds migration graph infrastructure using `@migrex/core`, `@migrex/files`, and `@migrex/zod` for all configuration file types:
  - **Identity config** (`~/.config/attest-it/config.yaml`): Supports legacy versionless files
  - **Seals file** (`.attest-it/seals.json`): Schema-validated seal storage
  - **Policy config** (`.attest-it/policy.yaml`): Trust and security settings
  - **Operational config** (`.attest-it/config.yaml`): Suite definitions and CLI settings

  Key features:
  - Version coercion accepts both numeric (`1`) and string (`"1"`) version fields for backward compatibility
  - Custom sync adapter for synchronous file operations
  - Foundation for future schema migrations when config formats evolve

  This is an internal refactoring with no breaking changes to the public API.

- a2cd520: Unify configuration loading between CLI and GitHub Action.

  Previously, the CLI and GitHub Action used different code paths to load configuration, causing inconsistent assessments. The CLI would report "No gates defined" while CI showed fingerprint mismatches because they loaded different parts of the configuration.

  This change introduces `loadSplitConfig()` - a unified configuration loading function used by both CLI and GitHub Action:
  - **Split config support**: Loads `policy.yaml` (gates, team) and `config.yaml` (suites, settings) separately and merges them
  - **Backward compatibility**: Falls back to unified config format when `policy.yaml` is not found
  - **Flexible policy source**: Supports filesystem loading or content-based loading (for fetching policy from GitHub API in PR context)
  - **Cross-config validation**: Validates that suite gate references exist in the policy

  The CLI and GitHub Action now provide consistent assessments of seal status.

## 0.10.0

### Minor Changes

- a0291f8: BREAKING: Remove suite-level fingerprint configuration in favor of gates.
  - Remove `packages`, `files`, and `ignore` fields from suite configuration
  - Require `gate` field on all suites (must reference a defined gate)
  - Remove deprecated functions: `getProjectPublicKeysDir()`, `hasProjectConfig()`
  - Remove `projectPath` field from `SavePublicKeyResult`
  - Remove `projectRoot` parameter from `savePublicKey()` and `savePublicKeySync()`

  Migration: Replace suite-level `packages`/`files`/`ignore` with a `gate` reference to a named gate definition.

- a0291f8: Add security requirements for human interaction during signing operations:
  - YubiKey: Add `-t` flag to require physical touch for challenge-response operations
  - 1Password: Filter session tokens from environment to force re-authentication via Touch ID/password

  These changes prevent automated agents from using cached credentials to sign attestations.

### Patch Changes

- a0291f8: Add glob pattern support for fingerprint paths. Paths containing glob characters (`*`, `?`, `{}`, `[]`) are now expanded using tinyglobby instead of being validated as literal paths. Glob patterns that match no files will throw an error to catch typos early.

## 0.9.0

### Minor Changes

- 9c921d8: Streamline CLI workflow with improved commands and schema versioning

  ### New Features
  - **`team join` command**: Easily add yourself as a project signer using your active identity
  - **`init` improvements**: Automatically adds `attest-it` as a devDependency for version pinning
  - **JSON Schema support**: YAML config files now include schema references for editor autocomplete and validation
  - **Schema versioning**: Schemas are now versioned at `/schemas/v1/` to prevent breaking changes from affecting existing users

  ### Breaking Changes
  - Removed deprecated `keygen` command (use `identity create` instead)
  - Removed `identity edit` command (use `identity remove` + `identity create` instead)
  - Removed `team edit` command (use `team remove` + `team add` instead)

  ### Internal Improvements
  - Added `publicKeyAlgorithm` field to team member schema for future algorithm support
  - Extracted shared utilities for config templates and version detection
  - Added comprehensive schema contract tests (26 tests) to detect breaking schema changes
  - Updated all documentation to reflect new command structure

## 0.8.0

### Minor Changes

- 16ede3f: Add passphrase encryption option for filesystem-stored private keys

  Users can now optionally encrypt their private key with a passphrase when
  selecting "Local Filesystem" storage in `attest-it keygen`. This provides an
  additional layer of security for users who don't have access to macOS Keychain,
  1Password, or YubiKey.

  Features:
  - New encryption prompt after selecting filesystem storage
  - Passphrase confirmation step to prevent typos
  - AES-256 encryption via OpenSSL
  - Clear error message when wrong passphrase is provided during signing
  - Passphrase passed via stdin (not command line) for security
  - Minimum 8 character passphrase requirement

### Patch Changes

- 16ede3f: Fix three bugs discovered during dogfooding:

  **Bug 1: Gate-based suites skipped by run command**
  - The `run` command was skipping suites that reference gates via the `gate` property
  - Fixed `getAllSuiteStatuses` to look up gate config and use `fingerprint.paths` and `fingerprint.exclude`

  **Bug 2: Seal uses display name instead of identity slug**
  - The `seal` and `run` commands were using `identity.name` (display name) for `sealedBy`
  - Fixed to use `localConfig.activeIdentity` (the slug) which is the key used for team member lookup during verification

  **Bug 3: sealsPath config option not respected**
  - Seal read/write operations were hardcoded to `.attest-it/seals.json`
  - Added `sealsPath` to config schemas and updated all seal operations to accept an optional path override

  Also adds comprehensive regression tests for all three bugs to prevent future regressions.

## 0.7.0

### Minor Changes

- 1f8f8cd: Add YubiKey as a key storage option in interactive keygen flow

  Users can now select YubiKey as a private key storage provider when running
  `attest-it keygen`. The private key is encrypted using YubiKey's HMAC-SHA1
  challenge-response feature, requiring physical touch of the YubiKey to sign
  attestations.

  Features:
  - Auto-detects connected YubiKeys when ykman CLI is installed
  - Supports multiple YubiKey devices (prompts user to select)
  - Auto-selects slot if only one is configured for challenge-response
  - Offers to automatically configure HMAC-SHA1 on slot 2 if not set up

### Patch Changes

- fca2467: Fix 1Password account selection to show human-readable account names
  - Updated `listAccounts()` to fetch account details and include the human-readable name (e.g., "North Family")
  - Account selection now shows "Account Name (email)" format when available
  - Fixed crash when pressing Escape during account selection
  - Added test coverage for Escape key handling

## 0.6.0

### Minor Changes

- 9c55c10: Add split config model and policy-ref input for GitHub Action

  **Core Package:**
  - Add split config model separating policy.yaml (trust definitions) from config.yaml (operational settings)
  - Policy file contains: team members, gates, security settings (maxAgeDays, publicKeyPath, attestationsPath)
  - Operational file contains: suites, groups, non-security settings
  - Add `mergeConfigs()` to combine policy and operational configs
  - Add `validateSuiteGateReferences()` for cross-config validation
  - Export new functions: `parsePolicyContent`, `parseOperationalContent`, `mergeConfigs`, `validateSuiteGateReferences`

  **GitHub Action:**
  - Add `policy-ref` input to specify which branch/tag to fetch policy from (e.g., 'production')
  - Defaults to base branch for PRs, filesystem for pushes
  - Add `fetch-policy.ts` for fetching policy from GitHub API
  - Update to use split config model (policy.yaml + config.yaml)

  **CI:**
  - Add act-based testing for the GitHub Action in CI
  - Contributors without Docker can still run unit tests locally

### Patch Changes

- 745fedc: Add shell completion support and improve configuration documentation

  **CLI Package:**
  - Add shell completion for bash, zsh, and fish shells
  - Auto-detect user's shell from `$SHELL` environment variable
  - Support both `attest-it` and `attest` command aliases
  - Offer shell completion installation during `init` and `identity create` commands
  - Remember user's preference if they decline completion installation
  - Fix escape sequence corruption in fish shell completions

  **Core Package:**
  - Add user preferences system for CLI experience settings
  - Add JSON schema generation from Zod schemas (`pnpm generate:schemas`)
  - Schemas in `schemas/policy.schema.json` and `schemas/config.schema.json` now stay in sync with validation logic

  **Documentation:**
  - Simplify README configuration example with clearer gate setup
  - Rewrite docs/configuration.md as comprehensive reference with:
    - Complete field reference tables with types, defaults, and required status
    - Duration string format reference
    - Glob pattern examples
    - All key provider options documented
    - JSON schema integration instructions for VS Code
    - Troubleshooting section
  - Add documentation sync reminder comments to Zod schema files

- 4fc9cfa: Security hardening for YubiKey key provider

  **Core Package:**
  - Add Zod schema validation for encrypted key file structure with runtime type checking
  - Add Additional Authenticated Data (AAD) to AES-256-GCM encryption, binding metadata to ciphertext
  - Add path traversal protection - encrypted key paths must be within the config directory
  - Add serial number verification with security warnings when not specified
  - Add process exit handlers for temp file cleanup on SIGINT/SIGTERM
  - Remove TOCTOU (time-of-check/time-of-use) vulnerabilities in file operations
  - Sanitize error messages to prevent information leakage
  - Add buffer size validation for IV, auth tag, salt, and challenge
  - Document memory security limitations for JavaScript string handling in JSDoc

  **CLI Package:**
  - Integrate YubiKey provider into identity creation flow
  - Add YubiKey device selection when multiple keys are connected
  - Add challenge-response slot configuration guidance

## 0.5.0

### Minor Changes

- 27e9e08: Add shell completion support and testing improvements

  ### Shell Completion (`@attest-it/cli`)
  - Add `completion` command with `install`, `uninstall` subcommands for bash, zsh, and fish shells
  - Dynamic completions for identity names, gate names, and suite names from config files
  - Uses `@pnpm/tabtab` for cross-shell completion support

  ### Testing Infrastructure (`@attest-it/core`)
  - Add hidden `--home-dir` option for isolated testing without Docker
  - New `setAttestItHomeDir()`, `getAttestItHomeDir()`, and `getAttestItConfigDir()` functions for configuring the attest-it home directory at runtime

  ### Identity Management Improvements (`@attest-it/cli`)
  - Enhanced `whoami` command to show key storage location and truncated public key
  - Enhanced `identity remove` command to show key storage location before deletion
  - Improved 1Password integration with account and vault selection prompts
  - Improved macOS Keychain integration with keychain selection
  - Added input validation for identity slugs (whitespace trimming) and email addresses

  ### macOS Keychain Improvements (`@attest-it/core`)
  - Add `listKeychains()` static method to enumerate available keychains
  - Improved keychain item naming with identity slug prefix

## 0.4.0

### Minor Changes

- 2720f52: Add 1Password and macOS Keychain key providers for secure private key storage

  This release introduces support for storing private signing keys in 1Password or macOS Keychain, providing more secure alternatives to filesystem storage. Keys are retrieved on-demand with biometric authentication (Touch ID) when available.

  **New Features:**
  - **KeyProvider abstraction**: Extensible interface for pluggable key storage backends
  - **1Password provider**: Store and retrieve private keys from 1Password vaults via the `op` CLI
  - **macOS Keychain provider**: Store and retrieve private keys from the macOS login keychain
  - **Interactive keygen**: New interactive mode in `keygen` command for selecting storage provider and configuration
  - **Backward compatible**: Existing filesystem-based key storage continues to work unchanged

  **Usage:**

  ```bash
  # Interactive key generation (auto-detects available providers)
  attest-it keygen

  # Non-interactive with 1Password
  attest-it keygen --provider 1password --vault Private --item-name my-signing-key

  # Non-interactive with macOS Keychain
  attest-it keygen --provider macos-keychain --item-name my-signing-key
  ```

  **Configuration:**

  ```yaml
  # 1Password
  settings:
    publicKeyPath: .attest-it/pubkey.pem
    keyProvider:
      type: 1password
      options:
        vault: Private
        itemName: attest-it-private-key
        account: user@example.com  # optional, for multi-account setups

  # macOS Keychain
  settings:
    publicKeyPath: .attest-it/pubkey.pem
    keyProvider:
      type: macos-keychain
      options:
        itemName: attest-it-private-key
  ```

  **Requirements:**
  - 1Password: `op` CLI must be installed and authenticated
  - macOS Keychain: Only available on macOS (`process.platform === 'darwin'`)
  - Touch ID or password authentication when signing

- 462d0db: Implement attest-it v2.0 specification with identity system, Ed25519 cryptography, and gate-based seals

  This is a major release that introduces a new architecture for cryptographic attestation with breaking changes from v1.x.

  **Breaking Changes:**
  - Fingerprint algorithm separator changed from `\0` to `:` - existing attestations will not verify
  - CLI `verify` and `status` commands now work with gates/seals instead of suites/attestations
  - New local identity configuration required at `~/.config/attest-it/config.yaml`
  - Project configuration now uses `team` and `gates` sections

  **New Features:**
  - **Identity System**: Local identity management with support for multiple identities
    - Commands: `identity list`, `identity create`, `identity use`, `identity show`, `identity edit`, `identity remove`, `identity export`
    - `whoami` command to show active identity
    - Support for file, macOS Keychain, and 1Password key storage backends
  - **Ed25519 Cryptography**: Modern elliptic curve cryptography using Node.js native crypto
    - `generateEd25519KeyPair()`, `signEd25519()`, `verifyEd25519()`, `getPublicKeyFromPrivate()`
    - 32-byte public keys encoded as Base64
  - **Team and Authorization**: Per-gate authorization with team member public keys
    - Team members defined in project config with public keys
    - Gates specify `authorizedSigners` array of team member slugs
    - Authorization functions: `isAuthorizedSigner()`, `getAuthorizedSignersForGate()`, `findTeamMemberByPublicKey()`
  - **Seal System**: Cryptographic seals for gates replacing attestations
    - Verification states: `VALID`, `MISSING`, `STALE`, `FINGERPRINT_MISMATCH`, `INVALID_SIGNATURE`, `UNKNOWN_SIGNER`
    - `seal` command to create seals for gates
    - Updated `verify` and `status` commands for seal verification
  - **Team Management CLI**: Commands to manage team members in project config
    - Commands: `team list`, `team add`, `team edit`, `team remove`

  **Configuration:**

  ```yaml
  # Project config (.attest-it/config.yaml)
  version: 1

  team:
    alice:
      name: Alice Smith
      email: alice@example.com
      publicKey: <base64-ed25519-public-key>

  gates:
    unit-tests:
      name: Unit Tests
      description: All unit tests pass
      authorizedSigners: [alice]
      fingerprint:
        paths: ['src/**/*.ts', 'test/**/*.ts']
        exclude: ['**/*.d.ts']
      maxAge: 30d
  ```

  ```yaml
  # Local config (~/.config/attest-it/config.yaml)
  activeIdentity: work
  identities:
    work:
      name: Alice Smith
      email: alice@example.com
      publicKey: <base64-ed25519-public-key>
      privateKey:
        type: keychain
        service: attest-it-work
        account: alice
  ```

  **Migration:**

  Users upgrading from v1.x will need to:
  1. Create a local identity: `attest-it identity create`
  2. Add team members to project config with their public keys
  3. Define gates with authorized signers
  4. Re-seal all gates (existing attestations will not verify)

## 0.2.0

### Patch Changes

- b5e5769: Add interactive mode for `attest-it run` with suite selection

  **New Features:**
  - Interactive suite selection UI when `attest-it run` is invoked without `--suite` or `--all`
  - Status display with colored badges: MISSING, STALE, CHANGED, VALID
  - New CLI options: `--dry-run`, `--continue`, `--filter <pattern>`
  - Session persistence in `.attest-it/session.json` for resumable interrupted runs
  - Suite dependencies via `depends_on` config with automatic topological sorting
  - Suite groups for batch selection

  **Breaking Changes:**
  - **Default behavior change:** `attest-it run` without flags now enters interactive mode instead of erroring
  - Exit code 2 now means "no work needed" (all suites valid)
  - Exit code 3 is now CONFIG_ERROR (was 2)
  - Exit code 4 is now CANCELLED (was 3)
  - Exit code 5 is now MISSING_KEY (was 4)

  **Dependencies:**
  - Replaced `picocolors` with `chromaterm` for terminal colors
  - Added `ink` and `react` for interactive TUI components
  - Added `ink-testing-library` for component testing (dev)

## 0.0.2

### Patch Changes

- 2fde289: Fix package release so that pnpm workspaces references are replaced by actual semver version specifiers
- 2fde289: Fix dependency references
