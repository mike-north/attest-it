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
attest-it init --force  # Overwrite existing config
```

| Option              | Description                                          |
| ------------------- | ---------------------------------------------------- |
| `-p, --path <path>` | Config file path (default: `.attest-it/config.yaml`) |
| `-f, --force`       | Overwrite existing config                            |

### status

Show the current seal status for all gates:

```bash
attest-it status
attest-it status my-gate
attest-it status --json
```

| Option       | Description                         |
| ------------ | ----------------------------------- |
| `[gates...]` | Show status for specific gates only |
| `--json`     | Output JSON for machine parsing     |

### run

Run test suites and create attestations:

```bash
attest-it run --suite my-suite
attest-it run --suite my-suite --no-attest
attest-it run --all
attest-it run --all --dry-run
attest-it run --all --filter "unit-*"
attest-it run  # Interactive mode (requires a terminal)
```

| Option               | Description                               |
| -------------------- | ----------------------------------------- |
| `-s, --suite <name>` | Run a specific suite directly             |
| `-a, --all`          | Run all suites needing attestation        |
| `--no-attest`        | Run tests without creating an attestation |
| `--dry-run`          | Show what would run without executing     |
| `-c, --continue`     | Resume an interrupted session             |
| `--filter <pattern>` | Filter suites by glob-style pattern       |

### verify

Verify gate seals (for CI):

```bash
attest-it verify
attest-it verify my-gate
attest-it verify --json
```

| Option       | Description                     |
| ------------ | ------------------------------- |
| `[gates...]` | Verify specific gates only      |
| `--json`     | Output JSON for machine parsing |

### seal

Create cryptographic seals for gates:

```bash
attest-it seal
attest-it seal my-gate
attest-it seal --force
attest-it seal --dry-run
```

| Option       | Description                                                  |
| ------------ | ------------------------------------------------------------ |
| `[gates...]` | Gate IDs to seal (defaults to all gates without valid seals) |
| `--force`    | Force seal creation even if gate already has a valid seal    |
| `--dry-run`  | Show what would be sealed without creating seals             |

### prune

Remove stale attestations:

```bash
attest-it prune
attest-it prune --dry-run
attest-it prune --keep-days 90
```

| Option                | Description                                       |
| --------------------- | ------------------------------------------------- |
| `-n, --dry-run`       | Show what would be removed without removing       |
| `-k, --keep-days <n>` | Keep attestations newer than n days (default: 30) |

### identity

Manage local identities and keypairs:

```bash
attest-it identity create
attest-it identity list
attest-it identity use <slug>
attest-it identity show
attest-it identity show <slug>
attest-it identity remove <slug>
attest-it identity export
attest-it identity export <slug>
```

| Subcommand      | Description                                              |
| --------------- | -------------------------------------------------------- |
| `create`        | Create a new identity with Ed25519 keypair (interactive) |
| `list`          | List all local identities                                |
| `use <slug>`    | Set the active identity                                  |
| `show [slug]`   | Show identity details (defaults to active identity)      |
| `remove <slug>` | Delete identity and optionally its private key           |
| `export [slug]` | Export identity as YAML snippet for team onboarding      |

### team

Manage team members and gate authorizations:

```bash
attest-it team list
attest-it team add
attest-it team join
attest-it team remove <slug>
attest-it team remove <slug> --force
```

| Subcommand      | Description                                                 |
| --------------- | ----------------------------------------------------------- |
| `list`          | List team members and their gate authorizations             |
| `add`           | Add a new team member (interactive, prompts for public key) |
| `join`          | Add yourself using your active identity                     |
| `remove <slug>` | Remove a team member (`-f, --force` skips confirmation)     |

### whoami

Show the current active identity:

```bash
attest-it whoami
```

### completion

Install or uninstall shell tab completion:

```bash
attest-it completion install        # Auto-detect shell
attest-it completion install bash
attest-it completion install zsh
attest-it completion install fish
attest-it completion uninstall
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

| Code | Constant     | Meaning                             |
| ---- | ------------ | ----------------------------------- |
| 0    | SUCCESS      | Operation completed successfully    |
| 1    | FAILURE      | Tests failed or attestation invalid |
| 2    | NO_WORK      | Nothing needed attestation          |
| 3    | CONFIG_ERROR | Configuration or validation error   |
| 4    | CANCELLED    | User cancelled the operation        |
| 5    | MISSING_KEY  | Missing required key file           |

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

## License

MIT
