# @attest-it/cli

## 0.11.0

### Minor Changes

- 67d966a: Wire `kind: pattern` gates through the full CLI surface (`seal`, `verify`, `status`, `run`).

  Per-file pattern gates already existed in `@attest-it/core` (per-file fingerprinting and per-file seal storage), but the CLI never called that path — a gate declared `kind: pattern` silently degraded to single-gate behavior (one combined fingerprint, one seal per gate, no per-file rows or per-file invalidation). The CLI now honors pattern gates end-to-end:
  - **`seal`** fingerprints and seals **each matched file independently**, writing one standalone seal per file at `.attest-it/seals/<gate>/<artifact>/<signer>.seal` through the low-level per-file writer (never the aggregate writer, which would prune the sibling per-file seals). A file that already has a valid per-file seal is skipped unless `--force`.
  - **`status`** and **`verify`** report **one row per matched file** (deterministically ordered by path) in both the table and `--json`. A newly-added matching file shows up as unsealed with no `policy.yaml` edit; changing one byte of a sealed file flips only that file to invalid while its siblings stay valid.
  - **`run --suite`** over a pattern gate seals each matched file independently, consistent with `seal`.
  - Single (non-pattern) gates are completely unaffected — the change is additive.

  The `status`/`verify` table's label column, which shows gate-level (or per-file) data, is relabeled from `Suite` to `Gate`.

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

- c49e997: Fix `CANCELLED` (4) exit code being unreachable, and reconcile the exit-code docs with reality.

  **Behavior change — a declined seal or a Ctrl-C now exits `CANCELLED` (4) instead of `SUCCESS`
  (0) or an uncaught-signal termination.** `AI_ASSISTANT_GUIDE.md` and `docs/configuration.md`
  (from #98) documented `CANCELLED` (4) as reachable by declining a confirmation prompt or by
  Ctrl-C, but neither path actually produced it:
  - **Declining `attest-it run`'s seal prompt** (typing `n` at "Create seal for gate 'x'?") now
    exits `CANCELLED` (4). Previously it logged "Seal creation skipped" and fell through to the
    normal "Suite completed!" success path with an implicit exit `0` -- a CI script reading the
    exit code could not distinguish a declined seal from a successful one.
  - **Ctrl-C (`SIGINT`) now exits `CANCELLED` (4) everywhere in the CLI**, not just while
    `@inquirer/core`'s own force-close detection happens to be active. The CLI installs a
    process-wide `SIGINT` handler for its entire lifetime. Previously, a real SIGINT delivered
    outside that narrow window fell through to Node's default, uncaught-signal termination
    (observed by a parent shell as the conventional 130), not a clean `process.exit(4)`.
  - **Missing a required flag with no interactive terminal available (e.g.
    `run --suite x < /dev/null` without `--yes`) remains `CONFIG_ERROR` (3), unchanged.** No
    prompt ever starts in this case, so there's nothing to cancel -- the docs previously implied
    this was also `CANCELLED`; they now correctly describe it as a usage error, the same class as
    any other missing-required-input mistake.

  The exit-code docs-pin test (`packages/cli/test/exit-codes.test.ts`, from #81/#98) is extended
  to assert the prose itself, not just the table, so this can't silently drift again.

- 4e44725: **Fixed `identity remove` of the last identity leaving an orphaned config reference after deleting its private key (issue #133).**

  Removing the last identity in a repo is refused (`✗ Cannot remove last identity`, exit code 3) --
  but the command previously deleted the private key from storage _before_ checking whether the
  removal would be refused. A refused `identity remove <slug> -y` on the last identity left `whoami`
  reporting the identity as healthy while the underlying private key was already gone, so any
  operation needing it (e.g. `init --root-signer <slug>`) later failed with "Secret not found in
  file store".

  The last-identity guard (and other preconditions) now run before any destructive key deletion, so
  a refused removal never half-applies: the private key remains in place and fully usable. The
  last-identity policy itself is unchanged -- a repo must always retain at least one identity.

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

- 157585c: Fix `run`/`seal` reporting success for an unauthorized signer. An unauthorized-signer `attest-it run --suite ... --yes` previously printed `✓ Suite completed!`, exited `0`, and suggested a "To commit" hint for a seal that was never created; `attest-it seal --json` similarly reported `ok: true`. No seal was ever written in either case (verified: this was a reporting bug, not a trust hole — `verify` always correctly reported `MISSING` for the unsealed gate). Both commands now treat an unauthorized-signer attempt as a hard failure: a nonzero exit code, an unambiguous error banner with no `✓`, `ok: false` in `seal --json`, and no "To commit" hint. Authorized signers are unaffected.
- a2441fc: **Headless `identity remove`, non-interactive `seal`, and a corrected exit-code contract.**
  - **`identity remove <slug>` is now fully non-interactive** with a new `-y, --yes` flag that
    skips both confirmations (removing the identity, and — opt-in via the also-new `--delete-key`
    flag — deleting the private key file). Without `--yes`, a non-TTY stdin now **fails fast** with
    a legible message instead of ever handing that stdin to the interactive prompt library.
  - **Fixed a runaway prompt-render loop.** Piping input into `identity remove` (or `team remove`,
    which had the same gap despite already having `--force`) with no non-interactive flag previously
    produced an unbounded (~20MB+) terminal-escape-code render loop that never exited — a real
    hang/DoS risk in CI or agent automation. Every confirmation in the CLI is now gated behind an
    explicit TTY check before it ever reaches the prompt library.
  - **`seal` now supports passphrase-encrypted file-backed keys.** Previously `seal` had no
    passphrase handling at all, so a key created with `identity create --passphrase-stdin` simply
    failed to sign. `seal` now shares `run`'s existing passphrase resolution (env var
    `ATTEST_IT_KEY_PASSPHRASE` → interactive prompt → fail fast).

  **Exit-code contract correction (may affect scripts checking specific exit codes):**
  - A cancelled interactive prompt — declined, or force-closed/interrupted (Ctrl-C, or a piped
    stdin that closes mid-prompt) — now always exits `CANCELLED` (4), never `CONFIG_ERROR` (3),
    across every command that prompts (`identity create`/`remove`, `init`,
    `team add`/`join`/`remove`, `run`). A force-closed prompt also now reports a clean `Cancelled`
    message instead of `@inquirer/core`'s raw `User force closed the prompt with 0 null`.
  - `run`'s dirty-working-tree refusal now exits a new dedicated code, **`DIRTY_WORKING_TREE` (6)**,
    instead of `CONFIG_ERROR` (3) — a dirty tree is a precondition failure, not a configuration
    problem, and automation consuming exit codes needs to tell the two apart.
  - `CONFIG_ERROR` (3) is unchanged for its original, documented meaning: no discoverable
    configuration, an unreadable `--config` path, or invalid configuration.

  See the updated exit-code tables in `AI_ASSISTANT_GUIDE.md` and `docs/configuration.md`.

- e1ff13a: Add `attest-it identity migrate` to import legacy `filesystem`-backed identities (from a v1-to-v2
  config migration) into VaultKeeper. It imports each legacy PEM into the configured VaultKeeper
  backend (default `file`), resolves a passphrase for encrypted keys the same way `run`/`seal` do,
  verifies a real sign/verify round-trip against the identity's recorded public key, and only then
  rewrites the identity's config record and deletes the original key file (`--keep-files` to skip
  deletion). Fail-closed: a verification failure rolls back the imported secret and leaves the
  legacy file and config untouched. Non-interactive capable via `--yes`. Idempotent: a second run
  with nothing left to migrate exits `0`. Once migrated, `identity list`/`identity show` no longer
  display the identity as "(legacy)".
- 61d1d34: `init --root-signer` is now non-destructive, and `init --force` refuses to silently discard a populated config.

  Following the CLI's own printed "Next steps" could previously destroy configuration. After `init` → `team join`, the CLI recommends `attest-it init --root-signer <slug>`; if gates/suites already existed, the bare form failed ("Config already exists … Pass --force"), and the suggested `--force` then re-scaffolded `policy.yaml`/`config.yaml` from empty templates — wiping `gates:`/`suites:` and orphaning any existing seal — while still printing "Trust anchor established" and exiting 0.
  - **`init --root-signer <slug>` is now additive.** On an already-initialized repo it merges in only the `rootGate` (and the signer's `team` entry) and leaves existing `gates:`, `suites:`, `team:`, and seals untouched. It needs no `--force`.
  - **`init --force` (the full re-scaffold) refuses to silently empty a populated config.** When existing `gates:`/`suites:` would be discarded, it prints exactly what is at stake and requires an explicit confirmation; non-interactively it refuses rather than wiping.
  - **"Next steps" wording updated** so the recommended bootstrap sequence is safe and notes the root-signer step is non-destructive.

- 21f3181: Make the setup command surface (`identity create`, `init`, `team add`, `team join`, `run`) non-interactive-capable, so CI, embedders, and agent-driven callers no longer hang on a TTY prompt.
  - **`identity create`** accepts `--name`, `--slug` (derived from `--name` when omitted), `--email`, `--github`, `--storage <file|keychain|1password|yubikey>`, and backend-specific flags (`--keychain-path`/`--keychain-item`, `--op-account`/`--op-vault`/`--op-item`, `--yubikey-serial`/`--encrypted-key-name`). `--passphrase-stdin` encrypts a file-backed private key with a passphrase piped via stdin (never prompted).
  - **`init`** now fails fast naming `--force` when config already exists and stdin is not a TTY, instead of hanging on the overwrite-confirmation prompt.
  - **`team add`** and **`team join`** accept `--slug`, `--name`, `--email`, `--github`, `--public-key` (add only), and `--gates` (comma-separated gate IDs); gate authorization defaults to none rather than prompting when non-interactive.
  - **`run`** accepts `-y, --yes` to auto-confirm seal creation; without it, a non-interactive run fails fast instead of hanging. Running `run` with no `--suite`/`--all` and no TTY now fails fast instead of launching an interactive UI that can never receive input. Signing with a passphrase-encrypted identity key resolves the passphrase from the `ATTEST_IT_KEY_PASSPHRASE` environment variable, an interactive prompt, or fails fast.
  - The shell-completion offer shown after `init`/`identity create` is now skipped (rather than prompting unconditionally) when stdin is not an interactive TTY.
  - Interactive mode remains the default for every command above when stdin is a TTY and flags are omitted -- no behavior change for humans running these by hand.
  - `@attest-it/core`: `generateEd25519KeyPair`/`signEd25519` gained an optional passphrase parameter, `createSeal` gained an optional `passphrase` option, and a new `isEncryptedPrivateKeyPem` helper detects passphrase-encrypted keys.

- eaab541: Fix two seal/status behavior issues:
  - **`seal` now verifies before skipping a reseal.** Previously, `seal` skipped resealing a gate whenever _any_ seal already existed for it, regardless of validity — checking only presence, never correctness. A stale seal (fingerprint changed, signature invalid, signer no longer authorized, expired) would silently survive indefinitely without `--force`. `seal` now runs full verification (the same check `status`/`verify` use) before deciding to skip, and only skips when the existing seal is still `VALID`.
  - **`status` now always exits `0`.** `status` is an informational command; it previously exited non-zero when any gate's seal was invalid, which is enforcement behavior that belongs to `verify`. CI pipelines and scripts that want to _gate_ on seal validity should use `attest-it verify`, not `attest-it status`'s exit code.

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

- 94d3942: Add `attest-it verify --base <ref>`: a trusted-ref mode that makes the CLI a
  genuine CI trust boundary for non-GitHub CI.

  Without `--base`, `attest-it verify` trusts the working-tree `.attest-it/policy.yaml`
  (a fast local pre-check). A pull request could rewrite its own `rootGate`/`team`,
  re-seal, and still pass — only the GitHub Action caught this, because it loads
  authorization from the pull request's base branch.

  `verify --base <ref>` closes that gap. It sources `rootGate`, `team`, and `gates`
  from `<ref>`'s copy of `policy.yaml` (via `git show`) while computing fingerprints
  and reading seals from the working tree — the same base-vs-worktree check the
  Action performs. A branch that self-adds a root signer and re-seals is rejected as
  `UNKNOWN_SIGNER`, because the trusted ref does not list it. `--base` fails **closed**:
  an unreadable ref or a missing policy at the ref is a configuration error with
  actionable guidance, never a silent pass on the working-tree policy.

  Non-GitHub CI can now enforce the trust boundary directly:

  ```bash
  git fetch origin main
  npx attest-it verify --base origin/main
  ```

  Documentation is reconciled to match: README, getting-started, and the GitHub
  integration guide now state plainly that plain `verify` is a local pre-check, and
  that the CI trust boundary is the GitHub Action (base branch) or `verify --base <ref>`.

- 362532e: Fix `verify`/`status` fail-open on missing configuration, and wire up `--config`.

  **Behavior change — previously-green CI on missing config now fails.** `attest-it verify`
  and `attest-it status`, run in a directory with no `.attest-it/` configuration at all, now
  consistently exit `CONFIG_ERROR` (3) with a legible "no attest-it configuration found — run
  `attest-it init`" message. A CI job that forgot to check out `.attest-it/`, or that has a
  mis-pathed `--config`, will now fail loudly instead of silently reporting success on nothing.
  - **`--config <path>` now actually works.** The global `-c, --config <path>` flag existed in
    `--help` since the CLI's first release but was never wired to config loading — passing it
    was a silent no-op. It now overrides policy-file auto-detection for both `verify` and
    `status`. An unreadable or nonexistent `--config` path exits `CONFIG_ERROR` naming the path
    you gave, never exit 0.
  - **"Zero gates" is now `NO_WORK` (2), not `CONFIG_ERROR`.** A configuration that loads and
    validates successfully but defines zero gates is not an error — it's a valid config with
    nothing to check. `verify`/`status` previously treated this identically to a broken config
    (`CONFIG_ERROR`); it's now distinct (`NO_WORK`), and neither case silently exits `SUCCESS`
    (which would make "verified" indistinguishable from "verified nothing"). In practice this
    case is unreachable through real config files today — the operational schema requires at
    least one suite, and every suite must reference an existing gate — but the CLI layer and
    the embeddable API handle it correctly regardless of how the config was constructed.
  - **`status` now mirrors `verify`'s exit codes** instead of only `verify` failing closed —
    a report command silently printing an empty table on a broken config is the same class of
    false-green bug.
  - **Documentation reconciled with reality.** `AI_ASSISTANT_GUIDE.md` and
    `docs/configuration.md` described a `NO_GATES`/`KEY_ERROR` exit-code table that never
    existed in code. Both now match the actual `ExitCode` enum
    (`SUCCESS`/`FAILURE`/`NO_WORK`/`CONFIG_ERROR`/`CANCELLED`/`MISSING_KEY`) exactly, and a new
    test parses both docs tables and pins every row to the enum so they can't drift again.

### Patch Changes

- eaab541: Small DX and correctness fixes:
  - **`init` no longer duplicates `attest-it` into `devDependencies`** when it's already listed in `dependencies` or `devDependencies` (previously it unconditionally added/overwrote a `devDependencies` entry, which could conflict with an existing `dependencies` pin).
  - **`identity export`'s guidance comments** now point at the current `.attest-it/policy.yaml` and its `team:` section, replacing stale references to a `.attest-it/team-config.yaml` file and `members:` section that don't exist in the current split-config model.
  - **Legacy filesystem key paths (`type: 'filesystem'`) now expand a leading `~`** to the user's home directory before reading or deleting the key file. Node's `fs` APIs don't perform shell tilde expansion, so a hand-edited v1 config with a `~`-prefixed path previously failed silently (read) or deleted nothing (delete, via `identity remove`).

- 180521f: Fix the documented getting-started flow end-to-end:
  - **`init` no longer fails on a fresh project's `package.json`.** `npm install <pkg>` in a directory with no prior `package.json` (the README's own Quick Start step 1) leaves behind a file with no `name`/`version`. `init` previously rejected this with an internal-looking error; it now auto-populates the missing field(s) instead and reports which ones it patched.
  - **`identity export`'s onboarding guidance now names the real config file.** It used to tell users to add their key to `.attest-it/team-config.yaml` under a `members:` key -- neither of which exist. It now correctly points at `.attest-it/policy.yaml`'s `team:` key.

  Also corrects `docs/getting-started.md` to match `init`'s real behavior (an empty `team: {}` / `gates: {}` / `suites: {}` scaffold with commented examples, not an interactive gate/suite wizard), documents the previously-undocumented shell-completions prompt, and adds an explicit "define your first gate and suite" step so the documented command order (`init` → define gate/suite → `team join` → `run`/`seal`) actually works without a hand-added suite. `docs/configuration.md` now notes that `publicKeyPath`/`attestationsPath` are accepted by the schema but not currently read by any code path -- only `sealsPath` governs seal file location.

- cb21b14: Fix `team join`/`team add`/`team remove` silently stripping every human-authored comment (including the `# yaml-language-server: $schema=...` directive `init` scaffolds) from `.attest-it/policy.yaml` on write.

  These commands now round-trip through a comment-preserving YAML `Document` edit (`@attest-it/core`'s new `loadEditablePolicy`/`serializeEditablePolicy`) that only replaces the specific fields that actually changed, instead of parsing to a plain object and re-serializing the whole file. Untouched comments -- including the schema directive, trust-model header, and commented onboarding examples -- as well as untouched sibling fields on a partially-changed section (e.g. an unrelated gate's `name`/`fingerprint` when only its `authorizedSigners` changed), now survive every write.

- Updated dependencies [eaab541]
- Updated dependencies [1cfa5f7]
- Updated dependencies [9e9c12a]
- Updated dependencies [466a11b]
- Updated dependencies [39b3f22]
- Updated dependencies [e41cf4f]
- Updated dependencies [eeb7721]
- Updated dependencies [e41cf4f]
- Updated dependencies [21f3181]
- Updated dependencies [7d07b76]
- Updated dependencies [cb21b14]
- Updated dependencies [eaab541]
- Updated dependencies [f943021]
- Updated dependencies [3af350a]
- Updated dependencies [866c519]
- Updated dependencies [593c1c0]
- Updated dependencies [96de2a2]
  - @attest-it/core@0.11.0

## 0.10.1

### Patch Changes

- a2cd520: Unify configuration loading between CLI and GitHub Action.

  Previously, the CLI and GitHub Action used different code paths to load configuration, causing inconsistent assessments. The CLI would report "No gates defined" while CI showed fingerprint mismatches because they loaded different parts of the configuration.

  This change introduces `loadSplitConfig()` - a unified configuration loading function used by both CLI and GitHub Action:
  - **Split config support**: Loads `policy.yaml` (gates, team) and `config.yaml` (suites, settings) separately and merges them
  - **Backward compatibility**: Falls back to unified config format when `policy.yaml` is not found
  - **Flexible policy source**: Supports filesystem loading or content-based loading (for fetching policy from GitHub API in PR context)
  - **Cross-config validation**: Validates that suite gate references exist in the policy

  The CLI and GitHub Action now provide consistent assessments of seal status.

- Updated dependencies [a2cd520]
- Updated dependencies [a2cd520]
  - @attest-it/core@0.10.1

## 0.10.0

### Minor Changes

- a0291f8: Add manual attestation-gated tests that dogfood the project's own GitHub Action. This includes a new YubiKey integration test script and CI workflow that verifies manual test attestations on PRs to main. The system ensures humans have actually run and verified credential store integrations (1Password, macOS Keychain, YubiKey) work before code can be merged.

### Patch Changes

- aa25ddc: Add Docker-based containerized tests for home folder state testing. These tests verify CLI behavior with different home directory states (fresh user, existing identity, corrupted config) in isolated Docker containers, preventing interference with the host system.
- a0291f8: Fix interactive TUI interference with test output. The status bar was appearing multiple times on screen because Ink's re-renders were conflicting with child process stdout. The TestRunner component now returns null while tests are executing, preventing TUI interference while preserving React state.
- a0291f8: Improve suite selector UI:
  - Add cursor indicator (`>`) for keyboard navigation
  - Show keyboard shortcuts: `[Space]` for toggle, `[up/down]` for navigation
  - Display group descriptions explaining what each shortcut does
  - Rename "By number" to "Toggle by number" for clarity

- Updated dependencies [a0291f8]
- Updated dependencies [a0291f8]
- Updated dependencies [a0291f8]
  - @attest-it/core@0.10.0

## 0.9.1

### Patch Changes

- a9be483: Defer key pair generation until after all user prompts complete during identity creation. This prevents creating orphaned keys when users abort the process and minimizes how long private key material is held in memory.
- 5c3359a: Fix 1Password account name display when vault is locked. Previously showed confusing output like "my.1password.com (my.1password.com)" - now shows "[Could not read account name] (my.1password.com)" to clearly indicate when account details cannot be retrieved.
- ea65b2d: Improve UX for key provider selection in identity create: notify users before checking external providers (1Password, Keychain, YubiKey), and show account name in 1Password private key location display.
- ea65b2d: Improve YubiKey visibility in identity create: show YubiKey as a disabled option when ykman is not installed (with installation hint), and add verbose logging for provider detection.

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

### Patch Changes

- Updated dependencies [9c921d8]
  - @attest-it/core@0.9.0

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

- Updated dependencies [16ede3f]
- Updated dependencies [16ede3f]
  - @attest-it/core@0.8.0

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

- Updated dependencies [fca2467]
- Updated dependencies [1f8f8cd]
  - @attest-it/core@0.7.0

## 0.6.1

### Patch Changes

- e885162: Fix React "duplicate key" warning when multiple 1Password accounts share the same email address. The Select component now uses unique identifiers (user_uuid for accounts, vault ID for vaults) instead of potentially duplicate values (email, vault name).

## 0.6.0

### Minor Changes

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

### Patch Changes

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

- Updated dependencies [745fedc]
- Updated dependencies [9c55c10]
- Updated dependencies [4fc9cfa]
  - @attest-it/core@0.6.0

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

### Patch Changes

- Updated dependencies [27e9e08]
  - @attest-it/core@0.5.0

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

- be09e0b: Improve attestation prompt visibility and remove unsafe --yes flag

  **Visual Improvements:**
  - Add visually distinctive yellow box border around attestation confirmation prompt
  - Use box-drawing characters for clean, professional appearance
  - Makes attestation prompt stand out from test output

  **Security Enhancement:**
  - Remove `--yes` / `-y` flag that bypassed user confirmation
  - All attestations now require explicit user approval
  - Default answer changed to "No" - user must actively confirm with "y"
  - Prevents accidental or automated attestation creation

  The new prompt appears as:

  ```
  ┌────────────────────────────────────────┐
  │ Create attestation? (y/N)              │
  └────────────────────────────────────────┘
  ```

  This ensures that human verification - the core principle of attest-it - cannot be bypassed programmatically.

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

### Patch Changes

- Updated dependencies [2720f52]
- Updated dependencies [462d0db]
  - @attest-it/core@0.4.0

## 0.3.0

### Minor Changes

- 7f9d7fb: Add comprehensive interactive CLI testing infrastructure

  **New Testing Utilities:**
  - Fixture factory using fixturify-project for creating realistic test projects
  - Automated integration tests validating CLI behavior across user workflows
  - Manual test runner for visual validation and artifact detection
  - Pre-configured test scenarios (multi-suite, all-missing, complex groups, failing tests)

  **New Documentation:**
  - Complete testing guide (test/README.md) with fixture usage and debugging tips
  - Quick start guide (test/QUICKSTART.md) with step-by-step workflows
  - Interactive CLI testing guide with usage examples

  **Testing Coverage:**
  - Git working tree validation
  - Exit code handling (SUCCESS, FAILURE, NO_WORK, CONFIG_ERROR, CANCELLED, MISSING_KEY)
  - Suite filtering and selection
  - Dry run mode validation
  - User workflow scenarios (first-time use, re-attestation, nothing to do)

  This infrastructure enables systematic testing of the interactive CLI experience, including React/Ink UI components, keyboard shortcuts, status displays, and visual artifact detection.

  **AI-Friendly Error Detection:**
  - Added signature error detection wrapper to prevent AI assistants from looping on unfixable cryptographic issues
  - Wraps keygen and attestation operations with clear error messages when signature-related failures occur
  - Explicitly distinguishes signature issues (require human intervention) from other test failures (AI can help fix)
  - Prevents futile retry loops when private keys are missing, corrupted, or have permission issues
  - Created comprehensive AI Assistant Guide (`/AI_ASSISTANT_GUIDE.md`) optimized for RAG systems
  - Error messages link directly to the guide for AI assistants examining CI/CD logs

  **Fixes:**
  - Updated README exit codes table to match implementation (6 codes instead of 2)
  - Improved error handling in test helpers
  - Added project-local private key support in fixtures to avoid test conflicts
  - Enhanced `createRealAttestation()` with better error messages

## 0.2.0

### Minor Changes

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

### Patch Changes

- Updated dependencies [b5e5769]
  - @attest-it/core@0.2.0

## 0.1.0

### Minor Changes

- 49c778c: Simplified `attest-it init` command

## 0.0.2

### Patch Changes

- 2fde289: Fix package release so that pnpm workspaces references are replaced by actual semver version specifiers
- 2fde289: Fix dependency references
- Updated dependencies [2fde289]
- Updated dependencies [2fde289]
  - @attest-it/core@0.0.2
