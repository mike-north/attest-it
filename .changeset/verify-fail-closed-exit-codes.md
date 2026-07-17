---
'@attest-it/cli': minor
'attest-it': minor
---

Fix `verify`/`status` fail-open on missing configuration, and wire up `--config`.

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
