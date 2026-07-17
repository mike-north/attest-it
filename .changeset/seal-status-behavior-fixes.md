---
'@attest-it/cli': minor
'attest-it': minor
---

Fix two seal/status behavior issues:

- **`seal` now verifies before skipping a reseal.** Previously, `seal` skipped resealing a gate whenever _any_ seal already existed for it, regardless of validity — checking only presence, never correctness. A stale seal (fingerprint changed, signature invalid, signer no longer authorized, expired) would silently survive indefinitely without `--force`. `seal` now runs full verification (the same check `status`/`verify` use) before deciding to skip, and only skips when the existing seal is still `VALID`.
- **`status` now always exits `0`.** `status` is an informational command; it previously exited non-zero when any gate's seal was invalid, which is enforcement behavior that belongs to `verify`. CI pipelines and scripts that want to _gate_ on seal validity should use `attest-it verify`, not `attest-it status`'s exit code.
