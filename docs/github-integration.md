# GitHub Integration Guide

Complete guide to integrating attest-it with GitHub Actions and workflows.

## Quick Start

Add attestation verification to your CI pipeline:

```yaml
# .github/workflows/ci.yml
name: CI

on: [push, pull_request]

jobs:
  verify-attestations:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Install dependencies
        run: npm install

      - name: Verify attestations
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

| Input             | Description                           | Required | Default                  |
| ----------------- | ------------------------------------- | -------- | ------------------------ |
| `config-path`     | Path to attest-it config file         | No       | `.attest-it/config.yaml` |
| `suite`           | Verify specific suite only            | No       | (all suites)             |
| `fail-on-missing` | Fail if any suite lacks attestation   | No       | `true`                   |
| `strict`          | Fail on warnings (approaching expiry) | No       | `false`                  |

### Action Outputs

| Output   | Description                        | Type              |
| -------- | ---------------------------------- | ----------------- |
| `valid`  | Whether all attestations are valid | `true` or `false` |
| `suites` | JSON object with per-suite status  | JSON string       |

### Full Example

```yaml
name: Verify Attestations

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

      - name: Verify attestations
        id: verify
        uses: attest-it/github-action@v1
        with:
          fail-on-missing: 'true'
          strict: 'false'

      - name: Check verification result
        if: steps.verify.outputs.valid == 'false'
        run: |
          echo "Attestation verification failed!"
          echo "${{ steps.verify.outputs.suites }}"
          exit 1
```

## Workflow Strategies

### Strategy 1: Block on Missing Attestations

Fail CI if attestations are missing or invalid:

```yaml
- name: Verify attestations
  run: npx attest-it verify
  # CI fails if exit code is non-zero
```

**Use when**:

- Attestations are critical to your release process
- All PRs must have valid attestations
- No exceptions allowed

### Strategy 2: Warn on Missing Attestations

Allow CI to pass but report status:

```yaml
- name: Verify attestations
  id: verify
  run: npx attest-it verify || echo "ATTESTATION_FAILED=true" >> $GITHUB_OUTPUT
  continue-on-error: true

- name: Comment on PR
  if: steps.verify.outputs.ATTESTATION_FAILED == 'true'
  uses: actions/github-script@v7
  with:
    script: |
      github.rest.issues.createComment({
        issue_number: context.issue.number,
        owner: context.repo.owner,
        repo: context.repo.repo,
        body: '⚠️ Attestations are missing or invalid. Please run `npx attest-it run --all`'
      })
```

**Use when**:

- You're gradually adopting attestations
- Some PRs legitimately don't need attestations
- You want visibility without blocking

### Strategy 3: Verify Specific Suites

Only verify critical suites in PR checks:

```yaml
# Verify desktop tests in PRs
- name: Verify desktop tests
  run: npx attest-it verify --suite desktop-tests

# Verify all tests before deploy
- name: Verify all attestations
  run: npx attest-it verify
  if: github.ref == 'refs/heads/main'
```

**Use when**:

- Some suites are more critical than others
- Deploy has stricter requirements than PR
- Want fast PR feedback

## PR-Level vs Deploy-Level Gating

### PR-Level Gating

Check attestations on every PR:

```yaml
name: PR Checks

on:
  pull_request:
    branches: [main]

jobs:
  verify-attestations:
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

- Catch missing attestations early
- Enforce policy before merge
- Clear feedback to developers

**Disadvantages**:

- May block PRs unnecessarily
- Requires attestation before review
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

      # Block deploy if attestations invalid
      - name: Verify attestations
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
      - name: Verify attestations
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
      - name: Verify attestations
        run: npx attest-it verify

      - name: Deploy
        run: npm run deploy
```

## Handling Verification Failures

### Example: Re-run Attestations in CI

If attestations are missing, provide clear instructions:

```yaml
- name: Verify attestations
  id: verify
  run: npx attest-it verify
  continue-on-error: true

- name: Report failure
  if: steps.verify.outcome == 'failure'
  run: |
    echo "::error::Attestations are invalid or missing"
    echo "To fix:"
    echo "  1. Run: npx attest-it status"
    echo "  2. Run: npx attest-it run --suite <suite-name>"
    echo "  3. Commit: git add .attest-it/attestations.json"
    exit 1
```

### Example: Automatic Issue Creation

Create an issue when attestations fail on main:

```yaml
- name: Verify attestations
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
        title: 'Attestations invalid on main branch',
        body: 'Attestations are missing or invalid. Please run `npx attest-it status` and update.',
        labels: ['ci', 'attestation']
      })
```

## Automated Pruning

Automatically remove stale attestations:

```yaml
name: Prune Stale Attestations

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

      - name: Prune stale attestations
        run: npx attest-it prune

      - name: Commit changes
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          git add .attest-it/attestations.json
          git diff --staged --quiet || git commit -m "chore: prune stale attestations"
          git push
```

## Status Badges

Display attestation status in your README:

### Using Shields.io

Create a workflow that outputs status:

```yaml
name: Attestation Status

on: [push]

jobs:
  status:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
      - run: npm ci

      - name: Check status
        id: status
        run: |
          if npx attest-it verify; then
            echo "status=passing" >> $GITHUB_OUTPUT
            echo "color=green" >> $GITHUB_OUTPUT
          else
            echo "status=failing" >> $GITHUB_OUTPUT
            echo "color=red" >> $GITHUB_OUTPUT
          fi

      - name: Create badge
        run: |
          echo "${{ steps.status.outputs.status }}" > attestation-status.txt
```

Add to README:

```markdown
![Attestation Status](https://img.shields.io/badge/attestations-passing-green)
```

## Monorepo Workflows

### Verify All Packages

```yaml
name: Verify All Attestations

on: [push, pull_request]

jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
      - run: npm ci

      - name: Verify all suites
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
        run: npx attest-it verify --suite ${{ matrix.package }}
```

## Security Considerations

### Protect Attestation Files

Require reviews for attestation changes:

```yaml
# .github/CODEOWNERS
.attest-it/attestations.json @your-team/security-reviewers
```

### Branch Protection

Ensure attestations are verified before merge:

1. Go to repository Settings > Branches
2. Add branch protection rule for `main`
3. Require "Verify attestations" status check

### Prevent Attestation Bypass

Block changes to public key without review:

```yaml
# .github/CODEOWNERS
.attest-it/pubkey.pem @your-team/admins
.attest-it/config.yaml @your-team/admins
```

## Troubleshooting

### "Private key not found" in CI

This is expected. CI only verifies with the public key:

```bash
# CI only needs:
.attest-it/pubkey.pem          # Public key (commit this)
.attest-it/attestations.json   # Attestations (commit this)
.attest-it/config.yaml          # Config (commit this)

# Developer machines need:
~/.config/attest-it/privkey.pem # Private key (DON'T commit)
```

### Verification Fails After Rebase

After rebasing, re-run attestations if test files changed:

```bash
git rebase main
npx attest-it status  # Check what changed
npx attest-it run --suite affected-suite
git add .attest-it/attestations.json
git rebase --continue
```

### Verification Fails on Fork PRs

Forks can't access secrets. For public repos:

```yaml
- name: Verify attestations
  # Skip on forks
  if: github.event.pull_request.head.repo.full_name == github.repository
  run: npx attest-it verify
```

### Expired Attestations

Update `maxAgeDays` or re-run tests:

```bash
# Option 1: Update config
vim .attest-it/config.yaml  # Increase maxAgeDays

# Option 2: Re-run tests
npx attest-it run --suite expired-suite
```

## Example Workflows

### Complete CI Pipeline

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

  verify-attestations:
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

      - name: Verify attestations
        uses: attest-it/github-action@v1
        with:
          fail-on-missing: 'true'

  deploy:
    if: github.ref == 'refs/heads/main'
    needs: [test, verify-attestations]
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
      - run: npm ci
      - run: npm run deploy
```

### Notification on Expiry

```yaml
name: Check Attestation Expiry

on:
  schedule:
    - cron: '0 9 * * MON' # Every Monday at 9am

jobs:
  check-expiry:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
      - run: npm ci

      - name: Check for expiring attestations
        id: check
        run: |
          # Check if any attestations expire in 7 days
          if npx attest-it verify --strict; then
            echo "status=ok" >> $GITHUB_OUTPUT
          else
            echo "status=expiring" >> $GITHUB_OUTPUT
          fi

      - name: Notify team
        if: steps.check.outputs.status == 'expiring'
        uses: slackapi/slack-github-action@v1
        with:
          payload: |
            {
              "text": "⚠️ Attestations expiring soon! Run `npx attest-it status` to see details."
            }
        env:
          SLACK_WEBHOOK_URL: ${{ secrets.SLACK_WEBHOOK }}
```

## Best Practices

1. **Verify on all branches**: Ensure attestations are valid everywhere
2. **Block deploys**: Always verify before production
3. **Automate pruning**: Remove stale attestations regularly
4. **Protect files**: Use CODEOWNERS for attestation files
5. **Clear failure messages**: Help developers fix issues quickly
6. **Monitor expiry**: Set up notifications for expiring attestations
7. **Use branch protection**: Require verification before merge

## See Also

- [Getting Started](getting-started.md) - Initial setup
- [Configuration](configuration.md) - Config reference
- [Writing Tests](writing-desktop-tests.md) - Test patterns
