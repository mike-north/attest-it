---
"@attest-it/cli": patch
---

Fix React "duplicate key" warning when multiple 1Password accounts share the same email address. The Select component now uses unique identifiers (user_uuid for accounts, vault ID for vaults) instead of potentially duplicate values (email, vault name).
