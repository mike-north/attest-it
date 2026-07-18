---
'@attest-it/cli': minor
'attest-it': minor
---

Fix `CANCELLED` (4) exit code being unreachable, and reconcile the exit-code docs with reality.

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
