---
'@attest-it/core': patch
'@attest-it/cli': patch
---

Fix 1Password account selection to show human-readable account names

- Updated `listAccounts()` to fetch account details and include the human-readable name (e.g., "North Family")
- Account selection now shows "Account Name (email)" format when available
- Fixed crash when pressing Escape during account selection
- Added test coverage for Escape key handling
