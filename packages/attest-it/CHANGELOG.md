# attest-it

## 0.11.0

### Minor Changes

- 67d966a: Wire `kind: pattern` gates through the full CLI surface (`seal`, `verify`, `status`, `run`).

  Per-file pattern gates already existed in `@attest-it/core` (per-file fingerprinting and per-file seal storage), but the CLI never called that path — a gate declared `kind: pattern` silently degraded to single-gate behavior (one combined fingerprint, one seal per gate, no per-file rows or per-file invalidation). The CLI now honors pattern gates end-to-end:
  - **`seal`** fingerprints and seals **each matched file independently**, writing one standalone seal per file at `.attest-it/seals/<gate>/<artifact>/<signer>.seal` through the low-level per-file writer (never the aggregate writer, which would prune the sibling per-file seals). A file that already has a valid per-file seal is skipped unless `--force`.
  - **`status`** and **`verify`** report **one row per matched file** (deterministically ordered by path) in both the table and `--json`. A newly-added matching file shows up as unsealed with no `policy.yaml` edit; changing one byte of a sealed file flips only that file to invalid while its siblings stay valid.
  - **`run --suite`** over a pattern gate seals each matched file independently, consistent with `seal`.
  - Single (non-pattern) gates are completely unaffected — the change is additive.

  The `status`/`verify` table's label column, which shows gate-level (or per-file) data, is relabeled from `Suite` to `Gate`.

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

- e41cf4f: Fix an unhandled `ECONNRESET` that could crash `generateKeyPair` when called with an empty-string passphrase (`passphrase: ''`). The internal `runOpenSSL` helper decided whether to open an extra stdio pipe (fd 3) for the passphrase using `passphrase !== undefined`, while `generateKeyPair` decided whether to reference that fd in OpenSSL's arguments (`-pass fd:3` / `-passin fd:3`) using `if (passphrase)`. Since `''` is not `undefined` but is falsy, an empty passphrase opened fd 3 without any OpenSSL argument reading it — an unconsumed pipe that could raise an unhandled error when the OpenSSL child process exited. Both checks now consistently treat an empty string the same as no passphrase, and the passphrase pipe now has a defensive `'error'` listener.
- e41cf4f: Fix passphrase-encrypted key generation and signing failing under OpenSSL 3.6.x when the passphrase is piped via Node's `spawn` stdio. `generateKeyPair`'s public-key extraction step and `sign`'s `dgst` step now supply the passphrase through a dedicated pipe on file descriptor 3 (`-passin fd:3` / `-pass fd:3`) with stdin left as `'ignore'`, instead of `-passin stdin` / `-pass stdin`. OpenSSL 3.6.x's passphrase-reading UI routine falls back to an interactive console prompt (fatal outside a TTY) whenever fd 0 is a Node-created pipe, regardless of which fd actually carries the passphrase — this sidesteps that fallback.
- cb21b14: Fix `team join`/`team add`/`team remove` silently stripping every human-authored comment (including the `# yaml-language-server: $schema=...` directive `init` scaffolds) from `.attest-it/policy.yaml` on write.

  These commands now round-trip through a comment-preserving YAML `Document` edit (`@attest-it/core`'s new `loadEditablePolicy`/`serializeEditablePolicy`) that only replaces the specific fields that actually changed, instead of parsing to a plain object and re-serializing the whole file. Untouched comments -- including the schema directive, trust-model header, and commented onboarding examples -- as well as untouched sibling fields on a partially-changed section (e.g. an unrelated gate's `name`/`fingerprint` when only its `authorizedSigners` changed), now survive every write.

- Updated dependencies [67d966a]
- Updated dependencies [eaab541]
- Updated dependencies [1cfa5f7]
- Updated dependencies [9e9c12a]
- Updated dependencies [466a11b]
- Updated dependencies [39b3f22]
- Updated dependencies [c49e997]
- Updated dependencies [e41cf4f]
- Updated dependencies [180521f]
- Updated dependencies [4e44725]
- Updated dependencies [eeb7721]
- Updated dependencies [e41cf4f]
- Updated dependencies [157585c]
- Updated dependencies [a2441fc]
- Updated dependencies [e1ff13a]
- Updated dependencies [61d1d34]
- Updated dependencies [21f3181]
- Updated dependencies [7d07b76]
- Updated dependencies [cb21b14]
- Updated dependencies [eaab541]
- Updated dependencies [eaab541]
- Updated dependencies [f943021]
- Updated dependencies [3af350a]
- Updated dependencies [866c519]
- Updated dependencies [593c1c0]
- Updated dependencies [96de2a2]
- Updated dependencies [94d3942]
- Updated dependencies [362532e]
  - @attest-it/cli@0.11.0
  - @attest-it/core@0.11.0

## 0.10.1

### Patch Changes

- Updated dependencies [a2cd520]
- Updated dependencies [a2cd520]
  - @attest-it/core@0.10.1
  - @attest-it/cli@0.10.1

## 0.10.0

### Patch Changes

- Updated dependencies [aa25ddc]
- Updated dependencies [a0291f8]
- Updated dependencies [a0291f8]
- Updated dependencies [a0291f8]
- Updated dependencies [a0291f8]
- Updated dependencies [a0291f8]
- Updated dependencies [a0291f8]
  - @attest-it/cli@0.10.0
  - @attest-it/core@0.10.0

## 0.9.1

### Patch Changes

- Updated dependencies [a9be483]
- Updated dependencies [5c3359a]
- Updated dependencies [ea65b2d]
- Updated dependencies [ea65b2d]
  - @attest-it/cli@0.9.1

## 0.9.0

### Patch Changes

- Updated dependencies [9c921d8]
  - @attest-it/cli@0.9.0
  - @attest-it/core@0.9.0

## 0.8.0

### Patch Changes

- Updated dependencies [16ede3f]
- Updated dependencies [16ede3f]
  - @attest-it/cli@0.8.0
  - @attest-it/core@0.8.0

## 0.7.0

### Patch Changes

- e8f00c3: Add `attest` as a shorter CLI command alias

  Users can now run `attest` instead of `attest-it` for convenience. Both commands point to the same binary.

- Updated dependencies [fca2467]
- Updated dependencies [1f8f8cd]
  - @attest-it/core@0.7.0
  - @attest-it/cli@0.7.0

## 0.6.1

### Patch Changes

- Updated dependencies [e885162]
  - @attest-it/cli@0.6.1

## 0.6.0

### Patch Changes

- Updated dependencies [745fedc]
- Updated dependencies [9c55c10]
- Updated dependencies [4fc9cfa]
  - @attest-it/cli@0.6.0
  - @attest-it/core@0.6.0

## 0.5.0

### Patch Changes

- Updated dependencies [27e9e08]
  - @attest-it/cli@0.5.0
  - @attest-it/core@0.5.0

## 0.4.0

### Patch Changes

- Updated dependencies [2720f52]
- Updated dependencies [be09e0b]
- Updated dependencies [462d0db]
  - @attest-it/core@0.4.0
  - @attest-it/cli@0.4.0

## 0.3.0

### Patch Changes

- Updated dependencies [7f9d7fb]
  - @attest-it/cli@0.3.0

## 0.2.0

### Patch Changes

- Updated dependencies [b5e5769]
  - @attest-it/cli@0.2.0
  - @attest-it/core@0.2.0

## 0.1.0

### Minor Changes

- 49c778c: Simplified `attest-it init` command

### Patch Changes

- Updated dependencies [49c778c]
  - @attest-it/cli@0.1.0

## 0.0.2

### Patch Changes

- 2fde289: Fix package release so that pnpm workspaces references are replaced by actual semver version specifiers
- 2fde289: Fix dependency references
- Updated dependencies [2fde289]
- Updated dependencies [2fde289]
  - @attest-it/cli@0.0.2
  - @attest-it/core@0.0.2
