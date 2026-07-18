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

| Operation     | Signature                                      | Returns                             |
| ------------- | ---------------------------------------------- | ----------------------------------- |
| `listGates`   | `listGates(options?)`                          | `ListGatesResult \| ApiFailure`     |
| `status`      | `status(paths?, options?)`                     | `StatusResult \| ApiFailure`        |
| `fingerprint` | `fingerprint(path, options?)`                  | `FingerprintResultOk \| ApiFailure` |
| `seal`        | `seal(path, { identity }, options?)`           | `SealResult \| ApiFailure`          |
| `verifyOne`   | `verifyOne(path, verifyOptions?)`              | `VerificationSuccess \| ApiFailure` |
| `verifyAll`   | `verifyAll({ changedSince? }, verifyOptions?)` | `VerifyAllResult \| ApiFailure`     |

> `verifyOne`/`verifyAll` take a `VerifyOptions` (a superset of `ApiOptions`)
> that also carries the **trusted policy source** for root-gate enforcement — see
> [Root-gate trust anchoring](#root-gate-trust-anchoring-required-for-anchored-repos).

```ts
import { listGates, seal, verifyOne, loadSplitConfig } from '@attest-it/core'

const opts = { baseDir: '/path/to/repo' }

const gates = await listGates(opts)
const sealed = await seal('src/tool.ts', { identity: 'alice' }, opts)

// Trust-anchored verify: supply the TRUSTED policy source (see below) so the
// root gate is enforced. An embedder owns git, so it loads the base-branch
// policy however it likes and passes it as `trustedConfig`.
const trustedConfig = await loadSplitConfig({ baseDir: '/path/to/base-branch-checkout' })
const verdict = await verifyOne('src/tool.ts', { ...opts, trustedConfig })
if (verdict.ok) {
  // validly attested against a trust-anchored policy
} else {
  switch (verdict.failureClass) {
    case 'untrusted-config':
      // the working-tree policy's own root seal did not verify against the
      // trusted anchor (e.g. a branch self-added a root signer), OR a rootGate
      // is present but no trusted source was supplied. Fail closed.
      break
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

## Root-gate trust anchoring (required for anchored repos)

`verifyOne`/`verifyAll` enforce the **root gate** before evaluating any gate —
the same trust-anchored authorization the GitHub Action enforces. A repository
that has run the `attest-it init` bootstrap ceremony has a top-level `rootGate`
that seals `.attest-it/policy.yaml` itself: the trust-critical policy (team and
gate authorization) can only change under a seal from an existing **root
signer**. This is what stops a branch (or an agent) from self-authorizing by
rewriting `rootGate.authorizedSigners`/`team` to a key it controls and
self-sealing.

Unlike the Action, an in-process embedder has no implicit "base branch", so it
must name the **trusted policy source** the root gate is evaluated against, via
`VerifyOptions`:

| Field               | Meaning                                                                                                     |
| ------------------- | ----------------------------------------------------------------------------------------------------------- |
| `trustedConfig`     | A pre-loaded, trusted `AttestItConfig` (e.g. the base-branch policy the embedder loaded). Takes precedence. |
| `trustedPolicyPath` | Filesystem path to a trusted policy file (e.g. a base-branch checkout's `.attest-it/policy.yaml`).          |

The working-tree policy's root seal is verified against the trusted source's
`rootGate.authorizedSigners`/`team`. A branch that self-added a root signer is
rejected `untrusted-config` (`UNKNOWN_SIGNER` — the trusted anchor does not list
it); a policy changed without a fresh root seal is rejected `untrusted-config`
(`FINGERPRINT_MISMATCH`). Once the root seal verifies, gates evaluate against the
now-trusted working-tree config.

**The trusted anchor — not the working tree — decides whether the root gate is
enforced.** If the supplied trusted policy defines a `rootGate`, the pre-step runs
regardless of what the working-tree policy declares. A branch cannot escape
enforcement by **deleting** `rootGate` from its own `policy.yaml` and
self-authorizing a gate: with no matching root seal over the tampered policy, the
pre-step rejects it `untrusted-config` (`MISSING`/`FINGERPRINT_MISMATCH`).

**Fail closed:** if the working-tree policy defines a `rootGate` and **neither**
`trustedConfig` nor `trustedPolicyPath` is supplied, verification returns an
`untrusted-config` failure — it never silently trusts the working-tree anchor. A
repository with **no** `rootGate` and no trusted source (not yet bootstrapped)
needs no anchor and verifies unchanged (backward compatible).

```ts
import { verifyAll, loadSplitConfig } from '@attest-it/core'

// The embedder loads the trusted base-branch policy however it likes (it owns
// git); attest-it never shells out to git itself.
const trustedConfig = await loadSplitConfig({ baseDir: '/checkout/of/base' })

const result = await verifyAll({}, { baseDir: '/checkout/of/pr', trustedConfig })
if (!result.ok && result.failureClass === 'untrusted-config') {
  // The PR's policy is not authorized by a trusted root signer — reject.
}
```

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

| Class                  | Meaning                                                                                                                                                                                                                                             |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `unsealed`             | The artifact is governed by a gate, but no seal exists for it.                                                                                                                                                                                      |
| `fingerprint-mismatch` | A seal exists, but the artifact's content changed since it was sealed.                                                                                                                                                                              |
| `unauthorized-signer`  | The seal's signer is not authorized for the gate, or the signature does not verify against an authorized key.                                                                                                                                       |
| `untrusted-config`     | The working-tree policy defines a `rootGate` but its own root seal does not verify against the supplied trusted anchor, or no trusted source was supplied. See [Root-gate trust anchoring](#root-gate-trust-anchoring-required-for-anchored-repos). |
| `expired`              | A valid seal exists but is older than the gate's `maxAge`.                                                                                                                                                                                          |
| `malformed`            | The input or on-disk state cannot be interpreted: an unparseable config, a structurally-invalid seal, or a path governed by no gate (or several).                                                                                                   |

This reconciles the lower-level `VerificationState` enum
(`VALID`/`MISSING`/`STALE`/`FINGERPRINT_MISMATCH`/`INVALID_SIGNATURE`/`UNKNOWN_SIGNER`)
into the taxonomy: `MISSING → unsealed`, `STALE → expired`,
`FINGERPRINT_MISMATCH → fingerprint-mismatch`, and both `INVALID_SIGNATURE` and
`UNKNOWN_SIGNER → unauthorized-signer` (a signature that does not verify cannot
establish an authorized human signer). The original state is preserved on the
failure as `underlyingState`.

## Non-interactive by construction

The embeddable surface never prompts, pages, or assumes a TTY. The **only**
permitted human interaction is the key backend's own unlock, reached solely from
`seal(...)` (e.g. a YubiKey touch). Environmental failures that are not
attestation states — a key backend failing or being cancelled, or a filesystem
I/O error — are **thrown**, not returned as taxonomy failures; an embedder
treats those as an inability to decide and fails closed.

## Identity resolution and `ATTEST_IT_HOME`

`seal(path, { identity }, options?)` resolves `identity` (a local identity slug) against the
caller's **local identity configuration** -- the same `~/.config/attest-it/config.yaml` the CLI
reads (see [Local Identity Configuration](configuration.md#local-identity-configuration)). An
embedder running in an isolated process (tests, CI, a sandboxed worker) that must not read or
write a real user's identity config should set the `ATTEST_IT_HOME` environment variable, or call
`setAttestItHomeDir()` exported from `@attest-it/core`, before invoking `seal(...)`:

```ts
import { setAttestItHomeDir, seal } from '@attest-it/core'

setAttestItHomeDir('/tmp/isolated-attest-it-home')
await seal('src/tool.ts', { identity: 'ci-bot' }, { baseDir: '/path/to/repo' })
```

The environment variable takes precedence over the programmatic override -- see
[`ATTEST_IT_HOME`](configuration.md#attest_it_home) for full precedence rules. As with the CLI,
this also redirects where VaultKeeper stores the private key material for the **`file`**
key-storage backend, but not for `keychain`/`1password`/`yubikey` -- so a fully isolated
embedding test/CI environment today is only practical with the `file` backend. See the caveat in
[`ATTEST_IT_HOME`](configuration.md#attest_it_home) for the current state.

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
