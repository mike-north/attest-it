---
'@attest-it/core': major
'@attest-it/cli': major
---

Eliminate legacy config generations: enforce a single canonical split-config model.

This is a breaking change that removes every remaining path around trust-anchored, split configuration:

- **Silent unified-config fallback removed.** `loadSplitConfig`/`loadSplitConfigSync` no longer transparently load a legacy unified `config.yaml` when `policy.yaml` is absent. A repo with only a unified config now fails to load with an explicit error pointing at the migration path, instead of silently behaving as if it had already migrated.
- **`attest-it init --migrate` added.** A one-shot, migrex-driven migration converts an existing unified `config.yaml` into split `policy.yaml` + `config.yaml` (operational), reusing the existing migration graph infrastructure.
- **Legacy `packages`-only suite format removed.** `gate` is now a required field on every suite; the schema no longer accepts a suite shaped as `{ packages: string[] }` with no `gate` reference.
- **Validation bypass removed.** The `if (gateName === undefined) continue` skip branch in `validateSuiteGateReferences` is deleted — every suite's authorized signers are now validated against `policy.yaml`'s `team`/`gates` unconditionally. Previously a schema-legal `packages`-only suite could add authorized signers that were never checked against trusted policy data.
- **Generation-1 attestation code paths removed.** `attestation.ts`, `verify.ts`, `config.ts` (`AttestItConfig`/`toAttestItConfig`), and the `Attestation`/`AttestationsFile`/`VerificationStatus`/`SuiteVerificationResult` types are deleted. The seal model (`seal/`) is now the only attestation/verification code path; `prune` is rewired onto it.

Repos still on the unified `config.yaml` format must run the new migration path before upgrading. Repos with a `packages`-only suite must add a `gate` reference — such suites were never validated against policy and should be treated as a gap to close, not a format to preserve.
