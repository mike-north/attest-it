# Action Testing with `act`

This directory contains workflow files for testing the GitHub Action using [act](https://github.com/nektos/act).

These tests run automatically in CI, so contributors without Docker installed locally don't need to run them manually.

## CI Integration

These tests run automatically on every push and PR via `.github/workflows/ci.yml`. The `test-action` job installs `act` and runs these workflows in a Docker-in-Docker setup.

## Local Testing (Optional)

If you have Docker installed, you can run these tests locally.

### Prerequisites

Install `act`:

```bash
# macOS (Homebrew)
brew install act

# Linux
curl -s https://raw.githubusercontent.com/nektos/act/master/install.sh | sudo bash

# Windows (Chocolatey)
choco install act-cli
```

### Running Tests

From the `packages/github-action` directory:

```bash
# Run all tests
pnpm test:act

# Or directly with act
act -W ./test/act-workflows push -P ubuntu-latest=catthehacker/ubuntu:act-latest
```

## Test Scenarios

### 1. Split Config - Valid Attestation

Tests that a valid attestation passes verification with the new split config model (policy.yaml + config.yaml).

### 2. Policy-ref Filesystem Fallback

Tests that in non-PR context without policy-ref, the action correctly loads config from the filesystem.

### 3. Missing Attestation

Tests that missing attestations correctly cause failure when `fail-on-missing: true`.

## Notes

- These tests run in Docker containers, simulating the GitHub Actions environment
- API-based policy fetching (policy-ref with GitHub API) cannot be fully tested locally without a valid token
- For full integration testing, use the actual GitHub Actions workflows in `.github/workflows/`

## Fixtures

Test fixtures are located in `../fixtures/`:

- `split-config-valid/` - Valid attestation with split config model
- `valid-attestation/` - Valid attestation (updated for split config)
- `missing-attestation/` - Missing attestation scenario (updated for split config)
