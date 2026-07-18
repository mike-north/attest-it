---
'@attest-it/core': minor
'attest-it': minor
---

Add per-artifact **pattern gates** and make gate `maxAge` optional (default: never expires).

- **Pattern gates.** A gate may now declare `kind: pattern` (the default remains `single`). Under a pattern gate each file matched by the gate's fingerprint globs is fingerprinted and sealed **independently**: sealing `tools/a.sh` says nothing about `tools/b.sh`, a new file matching the pattern shows up as unsealed with **no `policy.yaml` edit** (and therefore no re-seal of unrelated files), and changing one byte of a sealed file flips only that file to invalid while its siblings stay valid. `status` and `verify` report one deterministically ordered (lexicographic by path) result per matched file.
- **Optional `maxAge`.** `maxAge` is no longer required on a gate. When omitted, the gate is **indefinite** — `verify`/`status` never report a `STALE`/age-based failure for it regardless of seal age (indefinite is the genuine default, not a large-number sentinel).
- **New exports.** `computeFingerprintsPerFile` / `computeFingerprintsPerFileSync` (one `PerFileFingerprint` per matched file, path-bound so symlink aliases cannot share a fingerprint), `verifyPatternArtifactSeal`, and the low-level per-file seal primitives `writeSealFile` / `listStoredSeals`.
- **Additive `Seal.artifactPath`.** Per-file seals carry an optional `artifactPath` identifying which file within a pattern gate they cover, and are stored under an artifact path segment (`<gate>/<artifact>/<signer>.seal`) reusing the existing collision-safe slug. They are written and read via the low-level per-file API and are deliberately excluded from — and never pruned by — the aggregate one-per-gate seals path, so per-file and single-gate seals coexist without clobbering each other.

This change is fully additive: existing single-fingerprint gates and their seals behave exactly as before.
