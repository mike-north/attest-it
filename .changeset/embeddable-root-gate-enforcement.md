---
'@attest-it/core': minor
'attest-it': minor
---

Enforce the root gate in the embeddable API (`verifyOne`/`verifyAll`).

Previously the embeddable `@attest-it/core` surface performed only per-gate seal
verification and skipped root-gate trust anchoring entirely — so an embedder
(the surface used for custom / non-GitHub CI) got no protection against a policy
that self-authorizes by rewriting `rootGate.authorizedSigners`/`team` and
self-sealing. Only the CLI `verify` and the GitHub Action wired in the root-gate
pre-step.

`verifyOne`/`verifyAll` now run the same mandatory root-gate pre-step before
evaluating any gate: they verify the working-tree policy's own root seal against
a caller-supplied **trusted** policy source and fail closed with an
`untrusted-config` result when that seal does not verify (e.g. a self-added root
signer → `UNKNOWN_SIGNER`; an unsealed policy change → `FINGERPRINT_MISMATCH`).

- New `VerifyOptions` (a superset of `ApiOptions`) carries the trusted source:
  `trustedConfig` (a pre-loaded base-branch `AttestItConfig`, takes precedence)
  or `trustedPolicyPath` (a path to a trusted policy file). `verifyOne`/
  `verifyAll` now accept `VerifyOptions`.
- **Fail closed:** if the working-tree policy defines a `rootGate` but no trusted
  source is supplied, verification returns `untrusted-config` rather than
  silently trusting the working-tree anchor.
- Un-anchored repositories (no `rootGate`) verify unchanged — no trusted source
  is required (backward compatible).

Additive and backward-compatible: `VerifyOptions` extends `ApiOptions`, so
existing `{ baseDir }` callers keep working. The `untrusted-config` failure class
(previously a documented stub) is now returned at runtime.
