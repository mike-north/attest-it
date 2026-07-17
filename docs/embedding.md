# Embedding attest-it

`@attest-it/core` exposes a stable, versioned **embeddable API**: a small set of
path-keyed operations that another program (an "embedder") calls to enumerate
gates, compute fingerprints, create seals, and verify artifacts — without
shelling out to the CLI and without any terminal interaction beyond a key
backend's own unlock.

This is the surface downstream integrations code against. Its **shape is a
contract**: see [Schema versioning](#schema-versioning-and-breaking-changes).

- Import surface: `@attest-it/core`
- Runnable sample: [`examples/embedder/embedder.ts`](../examples/embedder/embedder.ts)
- CI integration test: `packages/core/test/integration/embedder.test.ts`

## The operations

All operations are asynchronous and accept an optional `{ baseDir }` (defaulting
to `process.cwd()`) so an embedder can point them at a checked-out worktree.

| Operation     | Signature                                | Returns                             |
| ------------- | ---------------------------------------- | ----------------------------------- |
| `listGates`   | `listGates(options?)`                    | `ListGatesResult \| ApiFailure`     |
| `status`      | `status(paths?, options?)`               | `StatusResult \| ApiFailure`        |
| `fingerprint` | `fingerprint(path, options?)`            | `FingerprintResultOk \| ApiFailure` |
| `seal`        | `seal(path, { identity }, options?)`     | `SealResult \| ApiFailure`          |
| `verifyOne`   | `verifyOne(path, options?)`              | `VerificationSuccess \| ApiFailure` |
| `verifyAll`   | `verifyAll({ changedSince? }, options?)` | `VerifyAllResult \| ApiFailure`     |

```ts
import { listGates, seal, verifyOne } from '@attest-it/core'

const opts = { baseDir: '/path/to/repo' }

const gates = await listGates(opts)
const sealed = await seal('src/tool.ts', { identity: 'alice' }, opts)
const verdict = await verifyOne('src/tool.ts', opts)
if (verdict.ok) {
  // validly attested
} else {
  switch (verdict.failureClass) {
    case 'unsealed':
      /* … */ break
    // …
  }
}
```

### Path-keyed, gate-scoped

The operations are keyed by **artifact path**, but seals bind **gate**
fingerprints. Each path is resolved to the gate that governs it (the gate whose
fingerprint globs match the path), and the operation acts on that gate:

- `fingerprint(path)` returns the governing gate's current fingerprint — the one
  the seal/verify cycle binds — not a hash of the single file in isolation.
- `seal(path, …)` seals the governing gate.
- `verifyOne(path)` verifies the governing gate's seal.

A path governed by **no** gate, or by **more than one** gate, is reported as a
`malformed` failure (the request cannot be unambiguously satisfied). In a
well-formed configuration each governed artifact belongs to exactly one gate.

## The result envelope

Every result is a discriminated union on `ok`, and every result carries a
`schemaVersion`.

- **Success**: `ok: true` plus operation-specific fields.
- **Failure**: `ok: false`, a `failureClass` from the taxonomy below, a
  human-legible `message`, and (where applicable) `gateId`, `path`, and the
  lower-level `underlyingState`.

Expected failures are returned as **values**, never thrown. For `verifyOne`,
the returned failure _is_ the answer ("this artifact is `unsealed`"), so callers
pattern-match rather than catch.

## Failure taxonomy

| Class                  | Meaning                                                                                                                                           |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `unsealed`             | The artifact is governed by a gate, but no seal exists for it.                                                                                    |
| `fingerprint-mismatch` | A seal exists, but the artifact's content changed since it was sealed.                                                                            |
| `unauthorized-signer`  | The seal's signer is not authorized for the gate, or the signature does not verify against an authorized key.                                     |
| `untrusted-config`     | The policy/config defining trust is not itself anchored to a trusted root. _(See the stub note below.)_                                           |
| `expired`              | A valid seal exists but is older than the gate's `maxAge`.                                                                                        |
| `malformed`            | The input or on-disk state cannot be interpreted: an unparseable config, a structurally-invalid seal, or a path governed by no gate (or several). |

This reconciles the lower-level `VerificationState` enum
(`VALID`/`MISSING`/`STALE`/`FINGERPRINT_MISMATCH`/`INVALID_SIGNATURE`/`UNKNOWN_SIGNER`)
into the taxonomy: `MISSING → unsealed`, `STALE → expired`,
`FINGERPRINT_MISMATCH → fingerprint-mismatch`, and both `INVALID_SIGNATURE` and
`UNKNOWN_SIGNER → unauthorized-signer` (a signature that does not verify cannot
establish an authorized human signer). The original state is preserved on the
failure as `underlyingState`.

### `untrusted-config` is a documented stub

Root-gate trust anchoring is not yet implemented. The `untrusted-config` class,
its documented shape, and the wiring that would return it are in place now so
the contract is stable, but the underlying check currently treats every
successfully-loaded config as trusted, so the class is never returned at runtime
yet. Completing the trust-anchoring work fills in the check **without changing
this contract**.

## Non-interactive by construction

The embeddable surface never prompts, pages, or assumes a TTY. The **only**
permitted human interaction is the key backend's own unlock, reached solely from
`seal(...)` (e.g. a YubiKey touch). Environmental failures that are not
attestation states — a key backend failing or being cancelled, or a filesystem
I/O error — are **thrown**, not returned as taxonomy failures; an embedder
treats those as an inability to decide and fails closed.

## Schema versioning and breaking changes

`API_SCHEMA_VERSION` (currently `1`) is stamped onto every result. **Changing
the shape of any result type, or the set of `failureClass` values, is a breaking
release** and must bump both the package version (major) and this constant. Pin
against `API_SCHEMA_VERSION` and treat a bump as a required migration.

## CLI `--json` parity

Every relevant CLI command emits machine-readable output under `--json`,
including `attest-it seal --json`, which drives sealing non-interactively (apart
from the key backend unlock) and prints a versioned structured summary. Prefer
the library surface for embedding; the `--json` CLI is the equivalent for
shell-driven integrations.

## Coupling notes

- **Gate enumeration** (`listGates`, and the gate-keyed `status`/`verifyAll`)
  currently enumerates statically-configured gates. Pattern gates (computed gate
  sets) will extend enumeration; do not assume the returned list is the final,
  complete set of enforceable gates forever.
- **Seal storage** is read through `readSeals`; a future file-per-seal storage
  layout changes only how seals are read, not the operations' contract.
