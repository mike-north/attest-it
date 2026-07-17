---
'@attest-it/cli': minor
'attest-it': minor
---

**Headless `identity remove`, non-interactive `seal`, and a corrected exit-code contract.**

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
  across every command that prompts (`identity create`/`remove`, `init`, `team
add`/`join`/`remove`, `run`). A force-closed prompt also now reports a clean `Cancelled` message
  instead of `@inquirer/core`'s raw `User force closed the prompt with 0 null`.
- `run`'s dirty-working-tree refusal now exits a new dedicated code, **`DIRTY_WORKING_TREE` (6)**,
  instead of `CONFIG_ERROR` (3) — a dirty tree is a precondition failure, not a configuration
  problem, and automation consuming exit codes needs to tell the two apart.
- `CONFIG_ERROR` (3) is unchanged for its original, documented meaning: no discoverable
  configuration, an unreadable `--config` path, or invalid configuration.

See the updated exit-code tables in `AI_ASSISTANT_GUIDE.md` and `docs/configuration.md`.
