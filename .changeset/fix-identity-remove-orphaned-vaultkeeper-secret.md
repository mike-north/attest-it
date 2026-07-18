---
'@attest-it/cli': minor
'@attest-it/core': minor
'attest-it': minor
---

**Fixed `identity remove` leaving orphaned private-key material in VaultKeeper (security P1, issue #101).**

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
