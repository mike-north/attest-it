# GitHub Integration Guide

Complete guide to integrating attest-it with GitHub Actions and workflows.

## Quick Start

Add seal verification to your CI pipeline:

```yaml
# .github/workflows/ci.yml
name: CI

on: [push, pull_request]

jobs:
  verify-seals:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Install dependencies
        run: npm install

      - name: Verify seals
        run: npx attest-it verify
```

## GitHub Action

Use the official GitHub Action for streamlined integration:

```yaml
- uses: attest-it/github-action@v1
  with:
    fail-on-missing: 'true'
```

### Action Inputs

| Input               | Description                                                                         | Required | Default                    |
| ------------------- | ----------------------------------------------------------------------------------- | -------- | -------------------------- |
| `working-directory` | Directory to run attest-it from                                                     | No       | `.`                        |
| `config-path`       | Path to operational config file (relative to `working-directory`)                   | No       | `.attest-it/config.yaml`   |
| `policy-path`       | Path to policy file (relative to repo root)                                         | No       | `.attest-it/policy.yaml`   |
| `policy-ref`        | Git ref to fetch policy from. Defaults to the PR base branch, or filesystem on push | No       | (PR base branch, or local) |
| `github-token`      | GitHub token for fetching policy from the base branch (required for PRs)            | No       | `${{ github.token }}`      |
| `suite`             | Verify specific suite only                                                          | No       | (all suites)               |
| `fail-on-missing`   | Fail if any suite lacks a seal                                                      | No       | `true`                     |
| `strict`            | Fail on warnings (approaching expiry)                                               | No       | `false`                    |

Because policy is trust-critical, the action always loads `policy.yaml` from the PR's base branch by default (via the GitHub API), never from the PR branch itself — this is what prevents a PR from editing its own gates or team roster to bypass verification. Use `policy-ref` to pin policy to a specific branch (e.g. `production`) regardless of PR target.

### Action Outputs

| Output   | Description                       | Type              |
| -------- | --------------------------------- | ----------------- |
| `valid`  | Whether all seals are valid       | `true` or `false` |
| `suites` | JSON object with per-suite status | JSON string       |

### Full Example

```yaml
name: Verify Seals

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Verify seals
        id: verify
        uses: attest-it/github-action@v1
        with:
          fail-on-missing: 'true'
          strict: 'false'

      - name: Check verification result
        if: steps.verify.outputs.valid == 'false'
        run: |
          echo "Seal verification failed!"
          echo "${{ steps.verify.outputs.gates }}"
          exit 1
```

## Workflow Strategies

### Strategy 1: Block on Missing Seals

Fail CI if seals are missing or invalid:

```yaml
- name: Verify seals
  run: npx attest-it verify
  # CI fails if exit code is non-zero
```

**Use when**:

- Seals are critical to your release process
- All PRs must have valid seals
- No exceptions allowed

### Strategy 2: Warn on Missing Seals

Allow CI to pass but report status:

```yaml
- name: Verify seals
  id: verify
  run: npx attest-it verify || echo "SEAL_FAILED=true" >> $GITHUB_OUTPUT
  continue-on-error: true

- name: Comment on PR
  if: steps.verify.outputs.SEAL_FAILED == 'true'
  uses: actions/github-script@v7
  with:
    script: |
      github.rest.issues.createComment({
        issue_number: context.issue.number,
        owner: context.repo.owner,
        repo: context.repo.repo,
        body: '⚠️ Seals are missing or invalid. Please run `npx attest-it seal <gate>` or `npx attest-it run --suite <suite>`'
      })
```

**Use when**:

- You're gradually adopting seals
- Some PRs legitimately don't need seals
- You want visibility without blocking

### Strategy 3: Verify Specific Gates

Only verify critical gates in PR checks:

```yaml
# Verify desktop tests in PRs
- name: Verify desktop tests
  run: npx attest-it verify desktop-tests

# Verify all gates before deploy
- name: Verify all seals
  run: npx attest-it verify
  if: github.ref == 'refs/heads/main'
```

**Use when**:

- Some gates are more critical than others
- Deploy has stricter requirements than PR
- Want fast PR feedback

## PR-Level vs Deploy-Level Gating

### PR-Level Gating

Check seals on every PR:

```yaml
name: PR Checks

on:
  pull_request:
    branches: [main]

jobs:
  verify-seals:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: npm ci
      - run: npx attest-it verify
```

**Advantages**:

- Catch missing seals early
- Enforce policy before merge
- Clear feedback to developers

**Disadvantages**:

- May block PRs unnecessarily
- Requires sealing before review
- Can slow down development

### Deploy-Level Gating

Only check on main branch or deploy:

```yaml
name: Deploy

on:
  push:
    branches: [main]

jobs:
  verify-and-deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
      - run: npm ci

      # Block deploy if seals invalid
      - name: Verify seals
        run: npx attest-it verify

      - name: Deploy
        run: npm run deploy
        if: success()
```

**Advantages**:

- Don't block development
- Catch issues before production
- Clear release gate

**Disadvantages**:

- May catch issues late
- Could block releases
- Less visibility during development

### Hybrid Approach (Recommended)

Warn in PRs, block on deploy:

```yaml
# .github/workflows/pr.yml
name: PR Checks
on: pull_request

jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
      - run: npm ci

      # Warn but don't fail
      - name: Verify seals
        run: npx attest-it verify
        continue-on-error: true
```

```yaml
# .github/workflows/deploy.yml
name: Deploy
on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
      - run: npm ci

      # Must pass to deploy
      - name: Verify seals
        run: npx attest-it verify

      - name: Deploy
        run: npm run deploy
```

## Handling Verification Failures

### Example: Re-run Seals in CI

If seals are missing, provide clear instructions:

```yaml
- name: Verify seals
  id: verify
  run: npx attest-it verify
  continue-on-error: true

- name: Report failure
  if: steps.verify.outcome == 'failure'
  run: |
    echo "::error::Seals are invalid or missing"
    echo "To fix:"
    echo "  1. Run: npx attest-it status"
    echo "  2. Run: npx attest-it seal <gate-name>"
    echo "  3. Commit: git add .attest-it/seals.json"
    exit 1
```

### Example: Automatic Issue Creation

Create an issue when seals fail on main:

```yaml
- name: Verify seals
  id: verify
  run: npx attest-it verify || echo "failed=true" >> $GITHUB_OUTPUT

- name: Create issue on failure
  if: steps.verify.outputs.failed == 'true' && github.ref == 'refs/heads/main'
  uses: actions/github-script@v7
  with:
    script: |
      await github.rest.issues.create({
        owner: context.repo.owner,
        repo: context.repo.repo,
        title: 'Seals invalid on main branch',
        body: 'Seals are missing or invalid. Please run `npx attest-it status` to see details.',
        labels: ['ci', 'seal']
      })
```

## Automated Pruning

Automatically remove stale seals:

```yaml
name: Prune Stale Seals

on:
  schedule:
    # Run weekly on Sundays at 2am UTC
    - cron: '0 2 * * 0'
  workflow_dispatch: # Allow manual trigger

jobs:
  prune:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          token: ${{ secrets.GITHUB_TOKEN }}

      - uses: actions/setup-node@v4
        with:
          node-version: '20'

      - run: npm ci

      - name: Prune stale seals
        run: npx attest-it prune

      - name: Commit changes
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          git add .attest-it/seals.json
          git diff --staged --quiet || git commit -m "chore: prune stale seals"
          git push
```

## Monorepo Workflows

### Verify All Gates

```yaml
name: Verify All Seals

on: [push, pull_request]

jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
      - run: npm ci

      - name: Verify all gates
        run: npx attest-it verify
```

### Verify Per Package

Verify only changed packages:

```yaml
name: Verify Changed Packages

on: pull_request

jobs:
  changes:
    runs-on: ubuntu-latest
    outputs:
      packages: ${{ steps.filter.outputs.changes }}
    steps:
      - uses: actions/checkout@v4
      - uses: dorny/paths-filter@v2
        id: filter
        with:
          filters: |
            package-a:
              - 'packages/package-a/**'
            package-b:
              - 'packages/package-b/**'

  verify:
    needs: changes
    if: needs.changes.outputs.packages != '[]'
    runs-on: ubuntu-latest
    strategy:
      matrix:
        package: ${{ fromJson(needs.changes.outputs.packages) }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
      - run: npm ci

      - name: Verify ${{ matrix.package }}
        run: npx attest-it verify ${{ matrix.package }}
```

## Security Considerations

### Protect Seal Files

Require reviews for seal changes:

```yaml
# .github/CODEOWNERS
.attest-it/seals.json @your-team/security-reviewers
```

### Branch Protection

Ensure seals are verified before merge:

1. Go to repository Settings > Branches
2. Add branch protection rule for `main`
3. Require "Verify seals" status check

### Prevent Seal Bypass

`policy.yaml` is trust-critical (it defines team members, gates, and fingerprints), so require review for any change to it on the default branch:

```yaml
# .github/CODEOWNERS
.attest-it/policy.yaml @your-team/admins
```

`config.yaml` (suites) is operational and safe to allow through normal PR review — the action always verifies gates against the `policy.yaml` on the base branch, not the PR branch, so a PR can't grant itself new signers or loosen a gate's fingerprint by editing `config.yaml`.

## Troubleshooting

### Verification Fails After Rebase

After rebasing, re-seal if files in fingerprint paths changed:

```bash
git rebase main
npx attest-it status  # Check what changed
npx attest-it seal <gate-name>
git add .attest-it/seals.json
git rebase --continue
```

### Verification Fails on Fork PRs

Forks can't access secrets. For public repos:

```yaml
- name: Verify seals
  # Skip on forks
  if: github.event.pull_request.head.repo.full_name == github.repository
  run: npx attest-it verify
```

### Stale Seals

Update the gate's `maxAge` or re-seal:

```bash
# Option 1: Update policy.yaml to extend the gate's maxAge
vim .attest-it/policy.yaml

# Option 2: Re-seal
npx attest-it seal <gate-name>
```

## Complete CI Pipeline Example

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Run unit tests
        run: npm test

      - name: Run integration tests
        run: npm run test:integration

  verify-seals:
    runs-on: ubuntu-latest
    needs: test
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Verify seals
        uses: attest-it/github-action@v1
        with:
          fail-on-missing: 'true'

  deploy:
    if: github.ref == 'refs/heads/main'
    needs: [test, verify-seals]
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
      - run: npm ci
      - run: npm run deploy
```

## Best Practices

1. **Verify on all branches**: Ensure seals are valid everywhere
2. **Block deploys**: Always verify before production
3. **Automate pruning**: Remove stale seals regularly
4. **Protect files**: Use CODEOWNERS for seal files
5. **Clear failure messages**: Help developers fix issues quickly
6. **Monitor expiry**: Set up notifications for expiring seals
7. **Use branch protection**: Require verification before merge

## See Also

- [Getting Started](getting-started.md) - Initial setup
- [Configuration](configuration.md) - Config reference
- [Writing Tests](writing-desktop-tests.md) - Test patterns
