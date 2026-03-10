# @attest-it/core

Core library for the attest-it human-gated test attestation system.

## Overview

This package provides the core business logic for attest-it:

- Configuration loading and validation (unified and split policy/operational formats)
- Fingerprint computation for test files and packages
- Attestation file reading and writing
- Seal creation and verification (the primary integrity mechanism)
- Identity system for managing signing keys and team members
- Verification logic for CI pipelines
- Optional WASM acceleration via `@attest-it/wasm` (Ed25519 via Rust, falls back to `node:crypto`)

## Installation

```bash
pnpm add @attest-it/core
```

Most users should install the `attest-it` umbrella package instead, which includes both this core library and the CLI.

## Usage

### Loading Configuration

The recommended approach is split config, which separates security-critical policy from operational settings:

```typescript
import { loadSplitConfig } from '@attest-it/core'

// Auto-detects policy and operational config files in cwd
const config = await loadSplitConfig()

// Or specify a base directory
const config = await loadSplitConfig({ baseDir: '/path/to/repo' })
```

For projects using a single unified config file:

```typescript
import { loadConfig, findConfigPath } from '@attest-it/core'

const configPath = await findConfigPath('/path/to/repo')
const config = await loadConfig(configPath)
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

### Constructing Config Programmatically

If you need to build a config in memory (e.g., for testing or tooling), construct an `AttestItConfig` object directly:

```typescript
import type { AttestItConfig } from '@attest-it/core'

const config: AttestItConfig = {
  version: 1,
  settings: {
    sealsPath: '.attest-it/seals.yaml',
  },
  team: {
    alice: {
      name: 'Alice Smith',
      publicKey: 'MCowBQYDK2VwAyEA...',
    },
  },
  gates: {
    'desktop-tests': {
      name: 'Desktop Tests',
      description: 'Tests requiring the desktop app',
      authorizedSigners: ['alice'],
      fingerprint: { paths: ['src/**/*.ts'] },
      maxAge: '30d',
    },
  },
  suites: {
    'desktop-tests': {
      gate: 'desktop-tests',
      command: 'pnpm vitest --project desktop',
    },
  },
}
```

To validate a raw config object against the Zod schema (the same validation that `loadConfig` performs), use `toAttestItConfig`:

```typescript
import { toAttestItConfig } from '@attest-it/core'

const validated = toAttestItConfig(rawObject)
```

### Working with Seals

Seals are the primary integrity mechanism. A seal cryptographically binds a gate's fingerprint to a team member's Ed25519 signature.

```typescript
import {
  createSeal,
  verifySeal,
  readSeals,
  writeSeals,
  verifyAllSeals,
  computeFingerprint,
} from '@attest-it/core'

// Read existing seals from .attest-it/seals.yaml
const sealsFile = await readSeals('/path/to/repo')

// Create a new seal
const seal = createSeal({
  gateId: 'desktop-tests',
  fingerprint: 'sha256:abc123...',
  sealedBy: 'alice', // team member slug
  privateKey: pemPrivateKey,
})

// Persist it
sealsFile.seals[seal.gateId] = seal
await writeSeals('/path/to/repo', sealsFile)

// Verify a single seal against team config
const result = verifySeal(seal, config)
if (!result.valid) {
  console.error(result.error)
}

// Verify all seals at once: provide current fingerprints keyed by gateId
const fingerprints: Record<string, string> = {}
for (const gateId of Object.keys(sealsFile.seals)) {
  const fp = await computeFingerprint({ paths: [`gates/${gateId}`], baseDir: '/path/to/repo' })
  fingerprints[gateId] = fp.fingerprint
}
const sealResults = verifyAllSeals(config, sealsFile, fingerprints)
```

### Working with Attestations

```typescript
import {
  readAttestations,
  writeAttestations,
  createAttestation,
  upsertAttestation,
} from '@attest-it/core'

// Read existing attestations
const attestationsFile = await readAttestations('.attest-it/attestations.json')
const attestations = attestationsFile?.attestations ?? []

// Create a new attestation
const newAttestation = createAttestation({
  suite: 'desktop-tests',
  fingerprint: 'sha256:abc123...',
  command: 'pnpm vitest --project desktop',
})

// Upsert and save (signature field is a legacy placeholder; integrity is provided by seals)
const updated = upsertAttestation(attestations, newAttestation)
await writeAttestations('.attest-it/attestations.json', updated, '')
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
      console.log(`${suite.suite}: ${suite.status} - ${suite.message ?? ''}`)
    }
  }
}
```

### Identity System

The identity system manages which key provider and identity are active for signing operations.

```typescript
import { loadLocalConfig, getActiveIdentity } from '@attest-it/core'

const localConfig = await loadLocalConfig()
const identity = getActiveIdentity(localConfig)

if (identity) {
  console.log(`Active identity: ${identity.name}`)
}
```

### Key Generation

```typescript
import { generateEd25519KeyPair } from '@attest-it/core'

// Generate an Ed25519 keypair (uses node:crypto — no OpenSSL required)
const keyPair = generateEd25519KeyPair()
console.log(keyPair.publicKey) // base64-encoded, ~44 chars
console.log(keyPair.privateKey) // PEM-encoded PKCS#8
```

### WASM Acceleration

The optional WASM backend accelerates Ed25519 signature verification and authorization lookups by running them in compiled Rust. It does **not** affect fingerprinting (which is I/O-bound) or config loading.

```typescript
import { initWasm, teardownWasm } from '@attest-it/core'

// Call once at startup to enable the Rust/WASM backend.
// Without this, all operations fall back to the TypeScript implementation.
await initWasm()

// ... perform verification and authorization operations ...

// Free WASM resources (useful in test teardown)
teardownWasm()
```

**When to use it:** Call `initWasm()` in long-running processes (CI pipelines, GitHub Actions) that verify many seals. For one-off CLI commands like `attest-it seal`, the TypeScript fallback is fast enough and avoids the ~50ms WASM load overhead.

### Config vs AttestItConfig

The library exports two config types:

- **`AttestItConfig`** — the hand-written interface in `types.ts`. Use this in your code.
- **`Config`** — inferred from the Zod validation schema (`z.infer<typeof configSchema>`). It is structurally equivalent to `AttestItConfig` but with Zod's default-applied types.

In practice, always use `AttestItConfig`. The `Config` type exists for internal validation plumbing and is re-exported for completeness. The bridge between them is `toAttestItConfig(raw)`, which parses and validates a raw object through the Zod schema and returns an `AttestItConfig`.

## API Documentation

See the [API documentation](../../docs/api/core.md) for complete type definitions and function signatures.

## Requirements

- Node.js 20+

## License

MIT
