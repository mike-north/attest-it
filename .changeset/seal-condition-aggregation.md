---
'@attest-it/core': minor
'@attest-it/cli': minor
'attest-it': minor
---

Seal evaluation now reports every failing condition, not just the first one found.

`evaluateSeal` (`@attest-it/core`) previously short-circuited on the first failing check: a seal that was simultaneously `FINGERPRINT_MISMATCH` and `STALE` only ever reported the fingerprint mismatch, and the caller never learned it was also stale. This was discovered for real in this repo's own manual-attestation gates, where four gates were both fingerprint-invalidated and well past their `maxAge`, but only the fingerprint mismatch surfaced.

- **Independent conditions are now aggregated.** `FINGERPRINT_MISMATCH`, the signer-resolution outcome (`UNKNOWN_SIGNER`/`INVALID_SIGNATURE`), and `STALE` are each independently determined and, when more than one fails simultaneously, all are reported via a new `conditions` field on `SealVerificationResult` (core), `RootGateVerificationResult` (core), `GateStatus` (`status --json`), and `ApiFailure.underlyingConditions` (the embeddable API). `UNKNOWN_SIGNER` and `INVALID_SIGNATURE` remain mutually exclusive, since signature validity can only be checked once a signer has resolved.
- **Backward compatible by construction.** The primary `state`/`message` (and `failureClass` in the embeddable API) are unchanged, and `conditions` is present only when more than one condition failed — the common single-condition case has no shape change at all.
- **`verify`, `status`, and the GitHub Action's `suites` output** now render every concurrent condition, not just the primary one.
- **`verify --base <ref>` no longer silently skips the root-gate pre-step** when the trusted base policy has no `rootGate` section. The pre-step now always runs when a policy path resolves, producing an explicit `NOT_ANCHORED` entry in `--json` output (previously absent entirely) and, in `--base` mode specifically, a human-readable warning naming the gap. Plain local `verify` (no `--base`) stays silent for an un-bootstrapped repo, matching prior behavior.

`@attest-it/core`'s embeddable API schema (`API_SCHEMA_VERSION`) is bumped to `2`: `ApiFailure` gains the optional `underlyingConditions` field. Per this package's own contract in `types.ts`, any shape change to an exported result type is a breaking release of the schema version — this repo is still in the 0.x series, where such changes ship as `minor` (see CONTRIBUTING.md).
