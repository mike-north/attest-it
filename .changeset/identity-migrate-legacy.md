---
'@attest-it/cli': minor
'attest-it': minor
---

Add `attest-it identity migrate` to import legacy `filesystem`-backed identities (from a v1-to-v2
config migration) into VaultKeeper. It imports each legacy PEM into the configured VaultKeeper
backend (default `file`), resolves a passphrase for encrypted keys the same way `run`/`seal` do,
verifies a real sign/verify round-trip against the identity's recorded public key, and only then
rewrites the identity's config record and deletes the original key file (`--keep-files` to skip
deletion). Fail-closed: a verification failure rolls back the imported secret and leaves the
legacy file and config untouched. Non-interactive capable via `--yes`. Idempotent: a second run
with nothing left to migrate exits `0`. Once migrated, `identity list`/`identity show` no longer
display the identity as "(legacy)".
