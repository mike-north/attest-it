# @attest-it/core

Core library for the attest-it human-gated test attestation system.

## Overview

This package provides the core business logic for attest-it:

- Split configuration loading and validation (trust-critical `policy.yaml` + operational `config.yaml`)
- Fingerprint computation for test files and packages
- Seal creation, storage, and verification with Ed25519 signing
- Cryptographic key generation and verification (Ed25519 natively; legacy RSA-2048 via OpenSSL)
- Verification logic for CI pipelines

## Installation

```bash
npm install @attest-it/core
```

Most users should install the `attest-it` umbrella package instead, which includes both this core library and the CLI.

## Usage

### Loading Configuration

Configuration is split into a trust-critical `policy.yaml` (team, gates, security settings) and an
operational `config.yaml` (suites, command settings). `loadSplitConfig` loads and merges both into
a single `AttestItConfig` (the `Config` type still exists for the retired unified format, but
`AttestItConfig` is what the CLI and seal APIs operate on):

```typescript
import { loadSplitConfig } from '@attest-it/core'

const config = await loadSplitConfig({ baseDir: '/path/to/repo' })
```

### Computing Fingerprints

```typescript
import { computeFingerprint } from '@attest-it/core'

const result = await computeFingerprint({
  paths: ['packages/my-app'],
  baseDir: '/path/to/repo',
  exclude: ['**/*.test.ts'],
})

console.log(result.fingerprint) // "sha256:abc123..."
console.log(result.fileCount) // 42
```

### Creating and Verifying Seals

Seals (not attestations — the original attestation model was retired in favor of this seal system)
are Ed25519-signed records that a gate's fingerprint was verified at a point in time:

```typescript
import {
  loadSplitConfig,
  computeFingerprint,
  createSeal,
  readSeals,
  writeSeals,
  verifyAllSeals,
} from '@attest-it/core'
import { readFileSync } from 'node:fs'

const baseDir = '/path/to/repo'
const config = await loadSplitConfig({ baseDir })

// Compute the current fingerprint for a gate
const result = await computeFingerprint({
  paths: ['packages/my-app'],
  baseDir,
})

// Create a seal for that gate, signed with the identity's private key
const privateKeyPem = readFileSync('/path/to/private-key.pem', 'utf8')
const seal = createSeal({
  gateId: 'desktop-tests',
  fingerprint: result.fingerprint,
  sealedBy: 'alice',
  privateKey: privateKeyPem,
})

// Add it to the aggregate and persist. Seals are stored one file per
// (gate, signer) under the seals directory (default `.attest-it/seals/`), so
// parallel PRs adding disjoint gates never conflict; `readSeals`/`writeSeals`
// present the file-per-seal layout as a single aggregate.
const sealsFile = await readSeals(baseDir, config.settings.sealsPath)
sealsFile.seals[seal.gateId] = seal
await writeSeals(baseDir, sealsFile, config.settings.sealsPath)

// Verify all gates' seals against their current fingerprints
const results = verifyAllSeals(config, sealsFile, { 'desktop-tests': result.fingerprint })
for (const r of results) {
  if (r.state !== 'VALID') {
    console.log(`${r.gateId}: ${r.state} - ${r.message ?? ''}`)
  }
}
```

### Key Generation

New identities should be created via `attest-it identity create`, which stores the private key
through a VaultKeeper-backed provider (filesystem, macOS Keychain, 1Password, or YubiKey).
Programmatically, an Ed25519 keypair can be generated directly:

```typescript
import { generateEd25519KeyPair } from '@attest-it/core'

const { publicKey, privateKey } = generateEd25519KeyPair()
```

A legacy RSA-2048 keypair generator (`generateKeyPair`, via OpenSSL) also remains exported for
backward compatibility with older, non-Ed25519 signing flows.

## API Documentation

See the [API documentation](../../docs/api/core.md) for complete type definitions and function signatures.

## Requirements

- Node.js 20+
- OpenSSL (for cryptographic operations)

## License

MIT
