---
'@attest-it/core': minor
'@attest-it/cli': minor
'attest-it': minor
---

Migrate seal storage to a file-per-seal layout for conflict-free parallel PRs.

Seals are now stored **one file per (gate, signer)** under a deterministic,
collision-safe path (`.attest-it/seals/<gate-slug>/<signer-slug>.seal`) instead
of a single monolithic `seals.json`/`seals.yaml`. Two proposal PRs that each add
one tool and one seal now land in disjoint files and merge without seal-storage
conflicts. The path scheme leaves room for one file per (gate, artifact, signer),
so m-of-n quorum sealing is not precluded.

Behavior / migration notes:

- The `sealsPath` setting now denotes the seals **directory** (default
  `.attest-it/seals/`). A legacy value still pointing at `.attest-it/seals.json`
  is transparently treated as the sibling directory, so an existing
  root-gate-sealed `policy.yaml` never needs rewriting.
- Both retired monolithic formats (`seals.yaml` and legacy `seals.json`) are
  migrated automatically to the file-per-seal layout on the first seal
  operation, and the old monolith is deleted. No monolithic read path remains
  afterward; no manual migration step is required.
- `SealsFile.version` is now `1 | 2` (`2` marks the file-per-seal era). The
  `readSeals`/`readSealsSync`/`writeSeals`/`writeSealsSync` signatures are
  unchanged; new `slugifySegment`, `resolveSealsRoot`, `writeSealFileSync`,
  `listStoredSealsSync`, `StoredSeal`, and `CURRENT_SEALS_VERSION` are exported
  for direct file-per-seal access.
