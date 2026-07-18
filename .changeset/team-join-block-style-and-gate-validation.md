---
'@attest-it/core': minor
'@attest-it/cli': minor
'attest-it': minor
---

Fix two `team join` write-path bugs in the trust-critical `.attest-it/policy.yaml`:

- `team join`/`team add` now emit block-style YAML for the `team:` section (matching the scaffold and every doc example) instead of rewriting it into flow-style, JSON-like YAML (`team: {alice: {...}}`) the moment a member is added to the scaffolded, empty `team: {}`. Untouched sections stay byte-for-byte unchanged.
- `team join --gates <name>` / `team add --gates <name>` now validate each named gate against the gates defined in `policy.yaml` and hard-fail naming the missing gate when it isn't defined, instead of silently succeeding with the authorization as a no-op.
