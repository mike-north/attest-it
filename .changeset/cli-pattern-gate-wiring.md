---
'@attest-it/cli': minor
'attest-it': minor
---

Wire `kind: pattern` gates through the full CLI surface (`seal`, `verify`, `status`, `run`).

Per-file pattern gates already existed in `@attest-it/core` (per-file fingerprinting and per-file seal storage), but the CLI never called that path — a gate declared `kind: pattern` silently degraded to single-gate behavior (one combined fingerprint, one seal per gate, no per-file rows or per-file invalidation). The CLI now honors pattern gates end-to-end:

- **`seal`** fingerprints and seals **each matched file independently**, writing one standalone seal per file at `.attest-it/seals/<gate>/<artifact>/<signer>.seal` through the low-level per-file writer (never the aggregate writer, which would prune the sibling per-file seals). A file that already has a valid per-file seal is skipped unless `--force`.
- **`status`** and **`verify`** report **one row per matched file** (deterministically ordered by path) in both the table and `--json`. A newly-added matching file shows up as unsealed with no `policy.yaml` edit; changing one byte of a sealed file flips only that file to invalid while its siblings stay valid.
- **`run --suite`** over a pattern gate seals each matched file independently, consistent with `seal`.
- Single (non-pattern) gates are completely unaffected — the change is additive.

The `status`/`verify` table's label column, which shows gate-level (or per-file) data, is relabeled from `Suite` to `Gate`.
