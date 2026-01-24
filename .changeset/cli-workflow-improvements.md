---
'@attest-it/cli': minor
'@attest-it/core': minor
---

Streamline CLI workflow with improved commands and schema versioning

### New Features

- **`team join` command**: Easily add yourself as a project signer using your active identity
- **`init` improvements**: Automatically adds `attest-it` as a devDependency for version pinning
- **JSON Schema support**: YAML config files now include schema references for editor autocomplete and validation
- **Schema versioning**: Schemas are now versioned at `/schemas/v1/` to prevent breaking changes from affecting existing users

### Breaking Changes

- Removed deprecated `keygen` command (use `identity create` instead)
- Removed `identity edit` command (use `identity remove` + `identity create` instead)
- Removed `team edit` command (use `team remove` + `team add` instead)

### Internal Improvements

- Added `publicKeyAlgorithm` field to team member schema for future algorithm support
- Extracted shared utilities for config templates and version detection
- Added comprehensive schema contract tests (26 tests) to detect breaking schema changes
- Updated all documentation to reflect new command structure
