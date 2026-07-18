---
'@attest-it/core': patch
'@attest-it/cli': patch
'attest-it': patch
---

Fix `team join`/`team add`/`team remove` silently stripping every human-authored comment (including the `# yaml-language-server: $schema=...` directive `init` scaffolds) from `.attest-it/policy.yaml` on write.

These commands now round-trip through a comment-preserving YAML `Document` edit (`@attest-it/core`'s new `loadEditablePolicy`/`serializeEditablePolicy`) that only replaces the specific fields that actually changed, instead of parsing to a plain object and re-serializing the whole file. Untouched comments -- including the schema directive, trust-model header, and commented onboarding examples -- as well as untouched sibling fields on a partially-changed section (e.g. an unrelated gate's `name`/`fingerprint` when only its `authorizedSigners` changed), now survive every write.
