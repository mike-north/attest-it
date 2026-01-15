---
'@attest-it/cli': minor
'@attest-it/core': patch
---

Add shell completion support and improve configuration documentation

**CLI Package:**

- Add shell completion for bash, zsh, and fish shells
- Auto-detect user's shell from `$SHELL` environment variable
- Support both `attest-it` and `attest` command aliases
- Offer shell completion installation during `init` and `identity create` commands
- Remember user's preference if they decline completion installation
- Fix escape sequence corruption in fish shell completions

**Core Package:**

- Add user preferences system for CLI experience settings
- Add JSON schema generation from Zod schemas (`pnpm generate:schemas`)
- Schemas in `schemas/policy.schema.json` and `schemas/config.schema.json` now stay in sync with validation logic

**Documentation:**

- Simplify README configuration example with clearer gate setup
- Rewrite docs/configuration.md as comprehensive reference with:
  - Complete field reference tables with types, defaults, and required status
  - Duration string format reference
  - Glob pattern examples
  - All key provider options documented
  - JSON schema integration instructions for VS Code
  - Troubleshooting section
- Add documentation sync reminder comments to Zod schema files
