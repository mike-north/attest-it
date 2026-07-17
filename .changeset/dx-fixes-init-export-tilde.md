---
'@attest-it/core': patch
'@attest-it/cli': patch
'attest-it': patch
---

Small DX and correctness fixes:

- **`init` no longer duplicates `attest-it` into `devDependencies`** when it's already listed in `dependencies` or `devDependencies` (previously it unconditionally added/overwrote a `devDependencies` entry, which could conflict with an existing `dependencies` pin).
- **`identity export`'s guidance comments** now point at the current `.attest-it/policy.yaml` and its `team:` section, replacing stale references to a `.attest-it/team-config.yaml` file and `members:` section that don't exist in the current split-config model.
- **Legacy filesystem key paths (`type: 'filesystem'`) now expand a leading `~`** to the user's home directory before reading or deleting the key file. Node's `fs` APIs don't perform shell tilde expansion, so a hand-edited v1 config with a `~`-prefixed path previously failed silently (read) or deleted nothing (delete, via `identity remove`).
