# Manual Testing Guide

This project uses its own attestation system (dogfooding) to ensure manual tests for credential store integrations are actually run by humans before merging to main.

## Quick Reference

| Test Suite | Command                                               | Requirements        |
| ---------- | ----------------------------------------------------- | ------------------- |
| 1Password  | `pnpm --filter @attest-it/cli test:manual:1password`  | `op` CLI signed in  |
| Keychain   | `pnpm --filter @attest-it/cli test:manual:keychain`   | macOS               |
| YubiKey    | `pnpm --filter @attest-it/cli test:manual:yubikey`    | `ykman` + YubiKey   |
| Visual CLI | `pnpm --filter @attest-it/cli test:manual:visual all` | Terminal with color |

## Why Manual Testing?

Some tests cannot be automated in CI:

- **1Password Integration**: Requires a real 1Password account and the `op` CLI signed in
- **macOS Keychain Integration**: Requires running on macOS with Keychain access
- **YubiKey Integration**: Requires physical YubiKey hardware with HMAC challenge-response configured
- **Interactive CLI**: Requires visual verification of terminal UI rendering

These tests exercise real credential stores to ensure the integrations work correctly.

> **Note**: In attest-it, "attestation" and "seal" are used interchangeably.
> Both refer to cryptographic signatures proving test execution.

## Prerequisites

1. **Install attest-it CLI** (if not already available):

   ```bash
   pnpm install
   pnpm build
   ```

2. **Set up a signing identity**:

   ```bash
   pnpm exec attest-it identity create
   ```

3. **Have access to the required credential stores** for the tests you'll run.

## Running Manual Tests

### 1Password Integration Test

```bash
pnpm --filter @attest-it/cli test:manual:1password
```

**Requirements**: `op` CLI installed and signed in to a 1Password account.

### macOS Keychain Integration Test

```bash
pnpm --filter @attest-it/cli test:manual:keychain
```

**Requirements**: Running on macOS.

### YubiKey Integration Test

```bash
pnpm --filter @attest-it/cli test:manual:yubikey
```

**Requirements**:

- `ykman` CLI installed
- YubiKey connected with HMAC challenge-response configured on slot 2
- Configure with: `ykman otp chalresp --generate 2`

### Interactive CLI Test

```bash
pnpm --filter @attest-it/cli test:manual:visual all
```

**Requirements**: Terminal with color support.

## Creating Attestations (Seals)

After successfully running a manual test, create a seal:

```bash
# Run the test through attest-it to create a seal
pnpm exec attest-it run --suite 1password-integration

# Or seal a gate directly after running the test manually
pnpm exec attest-it seal 1password-integration
```

The seal is a cryptographic signature proving you ran the test. It's stored in `.attest-it/seals.json`
(configurable via the policy's `settings.sealsPath`).

## When to Re-attest

Seals are invalidated when:

1. **Code changes**: Files in the gate's fingerprint paths are modified
2. **Age expires**: Seals older than the gate's `maxAge` (90 days for this project's gates) expire

The CI workflow will fail if seals are missing or invalid.

## CI Verification

The CI workflow is defined in `.github/workflows/verify-manual-attestations.yml`.

The workflow runs on every PR to main. It:

1. Builds the project
2. Runs the attest-it GitHub Action
3. Verifies all manual test gates have valid seals
4. Fails the PR if any seal is missing or invalid

### Example CI Failure Output

When seals are missing or invalid, you'll see something like:

```
Error: Gate 'yubikey-integration' verification failed
  State: FINGERPRINT_MISMATCH
  Expected: abc123...
  Actual: def456...

  Files changed since last seal:
    - packages/core/src/key-provider/vault-key-provider.ts
```

## Troubleshooting

### "MISSING" seal state

Run the manual test and create a seal:

```bash
pnpm exec attest-it run --suite <suite-name>
```

### "FINGERPRINT_MISMATCH" / "STALE" seal state

The code has changed since the last seal, or the seal has exceeded the gate's `maxAge`. Re-run the test:

```bash
pnpm exec attest-it run --suite <suite-name>
```

### "UNKNOWN_SIGNER" seal state

Your identity's public key isn't in the policy. Add yourself to `.attest-it/policy.yaml`:

```yaml
team:
  your-slug:
    name: Your Name
    publicKey: <your-base64-public-key>
```

Then add your slug to the `authorizedSigners` list for the relevant gates.

### YubiKey-Specific Issues

**"ykman not found"**

Install YubiKey Manager:

- macOS: `brew install ykman`
- Linux: `pip install yubikey-manager`
- Windows: [Download installer](https://www.yubico.com/support/download/yubikey-manager/)

**"Slot 2 not configured"**

Configure HMAC challenge-response:

```bash
ykman otp chalresp --generate 2
```

⚠️ **Warning**: This overwrites slot 2. Ensure you're not using it for OTP.

**Multiple YubiKeys detected**

The test will prompt you to select which YubiKey to use.

## Adding New Manual Tests

To add a new manual test that requires a seal:

### Checklist

- [ ] Create the test script in `packages/cli/test/manual/scripts/`
- [ ] Add the npm script to `packages/cli/package.json`
- [ ] Add a gate definition to `.attest-it/policy.yaml`
- [ ] Add a suite configuration to `.attest-it/config.yaml`
- [ ] Run the test and create an initial seal
- [ ] Update this guide with the new test information

### Step 1: Create the Test Script

Create a new script in `packages/cli/test/manual/scripts/`:

```typescript
// packages/cli/test/manual/scripts/test-my-integration.ts
import { MyIntegrationProvider } from '@attest-it/core'

async function testMyIntegration() {
  console.log('Testing My Integration...')

  // Your test logic here
  const provider = new MyIntegrationProvider()
  const result = await provider.doSomething()

  if (!result.success) {
    throw new Error('Integration test failed')
  }

  console.log('✓ My Integration test passed')
}

testMyIntegration().catch((error) => {
  console.error('Test failed:', error)
  process.exit(1)
})
```

### Step 2: Add npm Script

In `packages/cli/package.json`, add a script to run your test:

```json
{
  "scripts": {
    "test:manual:my-integration": "tsx test/manual/scripts/test-my-integration.ts"
  }
}
```

### Step 3: Add Gate to Policy

In `.attest-it/policy.yaml`, add a gate definition:

```yaml
gates:
  my-integration:
    name: My Integration Tests
    description: Manual test for My Integration
    authorizedSigners:
      - your-slug
    fingerprint:
      paths:
        - packages/core/src/my-integration-provider.ts
        - packages/cli/test/manual/scripts/test-my-integration.ts
    maxAge: 90d
```

**Key fields**:

- `fingerprint.paths`: Files that, if modified, invalidate existing seals
- `authorizedSigners`: Team members allowed to create seals for this gate
- `maxAge`: How long a seal remains valid before it's considered stale (manual tests
  can't run in CI, so this is what forces periodic re-verification)

### Step 4: Add Suite to Config

In `.attest-it/config.yaml`, add a suite configuration:

```yaml
suites:
  my-integration:
    gate: my-integration
    description: Test My Integration provider
    command: pnpm --filter @attest-it/cli test:manual:my-integration
```

**Key fields**:

- `command`: The full command to run the test
- `gate`: The single gate this suite satisfies

### Step 5: Create Initial Seal

Run the test and create a seal:

```bash
# Run the test
pnpm --filter @attest-it/cli test:manual:my-integration

# Create the seal
pnpm exec attest-it seal my-integration
```

Commit the seals file (`.attest-it/seals.json`) along with your changes.

### Example: Full Flow

Here's a complete example for a hypothetical "AWS Secrets Manager" integration:

**1. Test script** (`packages/cli/test/manual/scripts/test-aws-secrets.ts`):

```typescript
import { AwsSecretsProvider } from '@attest-it/core'

async function testAwsSecrets() {
  const provider = new AwsSecretsProvider({ region: 'us-east-1' })
  await provider.storeSecret('test-key', 'test-value')
  const retrieved = await provider.retrieveSecret('test-key')
  if (retrieved !== 'test-value') throw new Error('Value mismatch')
  console.log('✓ AWS Secrets Manager integration test passed')
}

testAwsSecrets().catch(console.error)
```

**2. Package.json script**:

```json
"test:manual:aws-secrets": "tsx test/manual/scripts/test-aws-secrets.ts"
```

**3. Policy gate**:

```yaml
gates:
  aws-secrets-integration:
    name: AWS Secrets Manager Integration Tests
    description: Manual test for AWS Secrets Manager integration
    authorizedSigners: [your-slug]
    fingerprint:
      paths:
        - packages/core/src/key-provider/aws-secrets-provider.ts
        - packages/cli/test/manual/scripts/test-aws-secrets.ts
    maxAge: 90d
```

**4. Config suite**:

```yaml
suites:
  aws-secrets-integration:
    gate: aws-secrets-integration
    description: Test AWS Secrets Manager provider
    command: pnpm --filter @attest-it/cli test:manual:aws-secrets
```

**5. Create the seal**:

```bash
pnpm exec attest-it run --suite aws-secrets-integration
```
