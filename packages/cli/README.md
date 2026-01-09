# @attest-it/cli

Command-line interface for the attest-it human-gated test attestation system.

## Overview

This package provides the CLI for attest-it. Most users should install the `attest-it` umbrella package instead, which includes this CLI automatically.

## Installation

```bash
npm install -g @attest-it/cli
```

Or install the umbrella package:

```bash
npm install attest-it
```

## Commands

### init

Initialize attest-it configuration in your project:

```bash
attest-it init
attest-it init --path .attest-it/config.yaml
```

### keygen

Generate a keypair for signing attestations:

```bash
attest-it keygen
attest-it keygen --algorithm rsa
attest-it keygen --public .attest-it/pubkey.pem
```

### status

Show the current status of all attestations:

```bash
attest-it status
attest-it status --suite my-suite
attest-it status --json
```

### run

Run tests and create a signed attestation:

```bash
attest-it run --suite my-suite
attest-it run --suite my-suite --yes  # Skip confirmation
attest-it run --suite my-suite --no-attest  # Run without attesting
```

### verify

Verify all attestations (for CI):

```bash
attest-it verify
attest-it verify --suite my-suite
attest-it verify --strict  # Fail on warnings
attest-it verify --json
```

### prune

Remove stale attestations:

```bash
attest-it prune
attest-it prune --dry-run
attest-it prune --keep-days 90
```

## Global Options

All commands support these global options:

| Option                | Description         |
| --------------------- | ------------------- |
| `-c, --config <path>` | Path to config file |
| `-v, --verbose`       | Verbose output      |
| `-q, --quiet`         | Minimal output      |
| `--help`              | Show help           |
| `--version`           | Show version        |

## Exit Codes

| Code | Meaning                      |
| ---- | ---------------------------- |
| 0    | Success                      |
| 1    | Verification failed or error |

## Programmatic Usage

The CLI can also be used programmatically:

```typescript
import { program } from '@attest-it/cli'

program.parse(['node', 'attest-it', 'status', '--json'])
```

## Documentation

- [Getting Started](../../docs/getting-started.md)
- [Configuration](../../docs/configuration.md)
- [GitHub Integration](../../docs/github-integration.md)

## Requirements

- Node.js 20+
- OpenSSL (for key generation and signing)

## License

MIT
