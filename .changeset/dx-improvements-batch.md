---
'@attest-it/core': minor
'@attest-it/cli': minor
'attest-it': patch
---

Improve developer experience across core, CLI, and documentation.

**Breaking:** `FingerprintOptions` properties renamed: `packages` → `paths`, `ignore` → `exclude` to align with `GateConfig.fingerprint`. The `status` command now always exits 0 (use `verify` for CI enforcement).

**Fixes:**
- `seal` command uses full verification (not just fingerprint match) before skipping reseal
- `run` commit hint now includes both attestations and seals files
- `identity create` rejects partial non-interactive flags (`--slug` without `--name` or vice versa)
- WASM host `resolveGlobs` now expands directory paths and uses `dot`/`onlyFiles` options matching the TS implementation
- Export `configSchema` to resolve API Extractor `ae-forgotten-export` warning

**Docs:** Updated Getting Started guide, configuration reference, core README, and attest-it README to match current behavior. Removed stale OpenSSL requirement and nonexistent `--group` flag.
