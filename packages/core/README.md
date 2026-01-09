# @attest-it/core

Core library for the attest-it human-gated test attestation system.

## Overview

This package provides the core business logic for attest-it:

- Configuration loading and validation
- Fingerprint computation for test files and packages
- Attestation file reading and writing with signing
- Cryptographic key generation and verification (via OpenSSL)
- Verification logic for CI pipelines

## Installation

```bash
npm install @attest-it/core
```

Most users should install the `attest-it` umbrella package instead, which includes both this core library and the CLI.

## Usage

### Loading Configuration

```typescript
import { loadConfig, findConfigPath } from '@attest-it/core'

const configPath = await findConfigPath('/path/to/repo')
const config = await loadConfig(configPath)
```

### Computing Fingerprints

```typescript
import { computeFingerprint } from '@attest-it/core'

const result = await computeFingerprint({
  packages: ['packages/my-app'],
  basedir: '/path/to/repo',
  ignore: ['**/*.test.ts'],
})

console.log(result.fingerprint) // "sha256:abc123..."
console.log(result.fileCount) // 42
```

### Working with Attestations

```typescript
import {
  readAndVerifyAttestations,
  writeSignedAttestations,
  createAttestation,
  upsertAttestation,
} from '@attest-it/core'

// Read and verify existing attestations
const { attestations } = await readAndVerifyAttestations({
  filepath: '.attest-it/attestations.json',
  publicKeyPath: '.attest-it/pubkey.pem',
})

// Create a new attestation
const newAttestation = createAttestation({
  suite: 'desktop-tests',
  fingerprint: 'sha256:abc123...',
  command: 'pnpm vitest --project desktop',
  exitCode: 0,
})

// Add to attestations and save
const updated = upsertAttestation(attestations, newAttestation)
await writeSignedAttestations({
  filepath: '.attest-it/attestations.json',
  attestations: updated,
  privateKeyPath: '~/.config/attest-it/key.pem',
})
```

### Verification

```typescript
import { verifyAttestations } from '@attest-it/core'

const result = await verifyAttestations({
  config,
  repoRoot: '/path/to/repo',
})

if (result.success) {
  console.log('All attestations valid')
} else {
  for (const suite of result.suites) {
    if (suite.status !== 'VALID') {
      console.log(`${suite.suite}: ${suite.status} - ${suite.message}`)
    }
  }
}
```

### Key Generation

```typescript
import { generateKeyPair, getDefaultPrivateKeyPath } from '@attest-it/core'

const paths = await generateKeyPair({
  algorithm: 'ed25519',
  publicPath: '.attest-it/pubkey.pem',
  privatePath: getDefaultPrivateKeyPath(),
})
```

## API Documentation

See the [API documentation](../../docs/api/core.md) for complete type definitions and function signatures.

## Requirements

- Node.js 20+
- OpenSSL (for cryptographic operations)

## License

MIT
