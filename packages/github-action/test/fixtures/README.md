# Test Fixtures

This directory contains test fixtures for the GitHub Action end-to-end tests.

## Test Keys

The `.pem` files in these fixtures are **TEST KEYS ONLY**.

**DO NOT USE THESE KEYS FOR:**

- Production attestations
- Any real encryption or signing
- Anything outside of testing this GitHub Action

These keys are intentionally committed to Git for testing purposes. They have no security value and should be treated as public.

## Fixtures

### `valid-attestation/`

A project with a valid, signed attestation that should pass verification.

### `missing-attestation/`

A project with configuration but no attestations. Used to test that `fail-on-missing: true` correctly fails when attestations are missing.

### `sample-project/`

A minimal project for basic action functionality testing.

## Regenerating Fixtures

If you need to regenerate the fixtures (e.g., after changing the attestation format):

```bash
node packages/github-action/test/fixtures/generate-fixtures.mjs
```

This will recreate the `valid-attestation` and `missing-attestation` fixtures using the test keys from `packages/core/test/fixtures/test-keys/`.
