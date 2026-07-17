---
'@attest-it/core': major
'attest-it': major
---

Rename `FingerprintOptions` fields to align with `GateConfig.fingerprint`: `packages` → `paths`, `ignore` → `exclude`.

Previously `computeFingerprint`/`computeFingerprintSync` took `{ packages, ignore, baseDir }`, while a gate's own fingerprint configuration used `{ paths, exclude }` — every call site had to rename fields when passing a gate's fingerprint config into `computeFingerprint`. `FingerprintOptions` now matches:

```typescript
// Before
computeFingerprint({ packages: ['src'], ignore: ['**/*.test.ts'] })

// After
computeFingerprint({ paths: ['src'], exclude: ['**/*.test.ts'] })
```

Consumers calling `computeFingerprint`/`computeFingerprintSync` directly (rather than only through the CLI) must update field names.
