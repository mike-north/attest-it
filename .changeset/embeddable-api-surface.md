---
'@attest-it/core': minor
'@attest-it/cli': minor
---

Add a stable, versioned embeddable API surface.

`@attest-it/core` now exports six path-keyed operations for embedders to code
against — `listGates`, `status`, `fingerprint`, `seal`, `verifyOne`, and
`verifyAll` — that compose the existing gate-keyed primitives into a coherent
facade. Every operation returns a discriminated result carrying a `schemaVersion`
and, on failure, a class from a documented taxonomy (`unsealed`,
`fingerprint-mismatch`, `unauthorized-signer`, `untrusted-config`, `expired`,
`malformed`). Expected failures are returned as values, not thrown. The surface
is non-interactive apart from a key backend's own unlock.

The `attest-it seal` CLI command gains a `--json` flag for non-interactive,
machine-readable sealing, matching `status`/`verify`.

Schema versioning policy: `API_SCHEMA_VERSION` is stamped on every result.
Changing the shape of any result type or the failure-taxonomy set is a
**breaking** release and must bump the major version and this constant.

Also fixes a latent aliasing bug where `readSeals`/`readSealsSync` returned a
shared mutable empty-seals object; each read now returns a fresh object.

The `untrusted-config` taxonomy class is shipped as a documented stub: its shape
and wiring are in place, but the underlying root-gate trust check is not yet
implemented, so the class is not returned at runtime until that work lands. The
contract shape will not change when it does.
