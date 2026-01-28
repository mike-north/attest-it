---
'@attest-it/core': patch
---

Integrate migrex for versioned configuration management.

Adds migration graph infrastructure using `@migrex/core`, `@migrex/files`, and `@migrex/zod` for all configuration file types:

- **Identity config** (`~/.config/attest-it/config.yaml`): Supports legacy versionless files
- **Seals file** (`.attest-it/seals.json`): Schema-validated seal storage
- **Policy config** (`.attest-it/policy.yaml`): Trust and security settings
- **Operational config** (`.attest-it/config.yaml`): Suite definitions and CLI settings

Key features:

- Version coercion accepts both numeric (`1`) and string (`"1"`) version fields for backward compatibility
- Custom sync adapter for synchronous file operations
- Foundation for future schema migrations when config formats evolve

This is an internal refactoring with no breaking changes to the public API.
