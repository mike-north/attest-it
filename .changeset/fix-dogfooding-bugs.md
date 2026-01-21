---
"@attest-it/cli": patch
"@attest-it/core": patch
---

Fix three bugs discovered during dogfooding:

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
