# @attest-it/github-action

GitHub Action for verifying human-gated test attestations with attest-it.

## Usage

```yaml
name: Verify Attestations

on:
  pull_request:
    branches: [main]

jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Verify attestations
        uses: ./packages/github-action # or your-org/attest-it-action@v1
        with:
          config-path: '.attest-it/config.yaml'
          fail-on-missing: 'true'
          strict: 'false'
```

## Inputs

### `config-path`

**Optional** Path to attest-it config file.

**Default:** `.attest-it/config.yaml`

### `suite`

**Optional** Verify specific suite only. If not provided, all suites are verified.

### `fail-on-missing`

**Optional** Fail if any suite lacks attestation.

**Default:** `true`

### `strict`

**Optional** Fail on warnings (attestations approaching expiry, > 23 days old).

**Default:** `false`

## Outputs

### `valid`

Boolean string (`'true'` or `'false'`) indicating whether all attestations are valid.

### `suites`

JSON string containing per-suite status information. Parse with `JSON.parse()`.

Example:

```json
[
  {
    "suite": "smoke-tests",
    "status": "VALID",
    "age": 5,
    "message": null
  },
  {
    "suite": "critical-flows",
    "status": "EXPIRED",
    "age": 31,
    "message": "Attestation expired"
  }
]
```

## Examples

### Basic usage

```yaml
- name: Verify attestations
  uses: ./packages/github-action
```

### Verify specific suite

```yaml
- name: Verify smoke tests
  uses: ./packages/github-action
  with:
    suite: 'smoke-tests'
```

### Strict mode (fail on old attestations)

```yaml
- name: Verify attestations (strict)
  uses: ./packages/github-action
  with:
    strict: 'true'
```

### Use outputs in subsequent steps

```yaml
- name: Verify attestations
  id: attest-it
  uses: ./packages/github-action
  with:
    fail-on-missing: 'false'

- name: Check results
  if: steps.attest-it.outputs.valid == 'false'
  run: |
    echo "Some attestations are invalid"
    echo "Details: ${{ steps.attest-it.outputs.suites }}"
```

## Local Testing with act

You can test the action locally using [nektos/act](https://github.com/nektos/act):

```bash
# Install act
brew install act

# Test the action locally
act -j verify --secret GITHUB_TOKEN=$GITHUB_TOKEN

# Or with a specific workflow file
act pull_request -W .github/workflows/test-attest-it.yml
```

## Development

### Build

```bash
pnpm run build
```

This bundles the action into a single file at `dist/index.js`.

### Test

```bash
pnpm run test
```

### Lint

```bash
pnpm run lint
```

### Type check

```bash
pnpm run typecheck
```

## License

MIT
