---
'@attest-it/core': major
'@attest-it/cli': major
---

Implement attest-it v2.0 specification with identity system, Ed25519 cryptography, and gate-based seals

This is a major release that introduces a new architecture for cryptographic attestation with breaking changes from v1.x.

**Breaking Changes:**

- Fingerprint algorithm separator changed from `\0` to `:` - existing attestations will not verify
- CLI `verify` and `status` commands now work with gates/seals instead of suites/attestations
- New local identity configuration required at `~/.config/attest-it/config.yaml`
- Project configuration now uses `team` and `gates` sections

**New Features:**

- **Identity System**: Local identity management with support for multiple identities
  - Commands: `identity list`, `identity create`, `identity use`, `identity show`, `identity edit`, `identity remove`, `identity export`
  - `whoami` command to show active identity
  - Support for file, macOS Keychain, and 1Password key storage backends

- **Ed25519 Cryptography**: Modern elliptic curve cryptography using Node.js native crypto
  - `generateEd25519KeyPair()`, `signEd25519()`, `verifyEd25519()`, `getPublicKeyFromPrivate()`
  - 32-byte public keys encoded as Base64

- **Team and Authorization**: Per-gate authorization with team member public keys
  - Team members defined in project config with public keys
  - Gates specify `authorizedSigners` array of team member slugs
  - Authorization functions: `isAuthorizedSigner()`, `getAuthorizedSignersForGate()`, `findTeamMemberByPublicKey()`

- **Seal System**: Cryptographic seals for gates replacing attestations
  - Verification states: `VALID`, `MISSING`, `STALE`, `FINGERPRINT_MISMATCH`, `INVALID_SIGNATURE`, `UNKNOWN_SIGNER`
  - `seal` command to create seals for gates
  - Updated `verify` and `status` commands for seal verification

- **Team Management CLI**: Commands to manage team members in project config
  - Commands: `team list`, `team add`, `team edit`, `team remove`

**Configuration:**

```yaml
# Project config (.attest-it/config.yaml)
version: 1

team:
  alice:
    name: Alice Smith
    email: alice@example.com
    publicKey: <base64-ed25519-public-key>

gates:
  unit-tests:
    name: Unit Tests
    description: All unit tests pass
    authorizedSigners: [alice]
    fingerprint:
      paths: ['src/**/*.ts', 'test/**/*.ts']
      exclude: ['**/*.d.ts']
    maxAge: 30d
```

```yaml
# Local config (~/.config/attest-it/config.yaml)
activeIdentity: work
identities:
  work:
    name: Alice Smith
    email: alice@example.com
    publicKey: <base64-ed25519-public-key>
    privateKey:
      type: keychain
      service: attest-it-work
      account: alice
```

**Migration:**

Users upgrading from v1.x will need to:

1. Create a local identity: `attest-it identity create`
2. Add team members to project config with their public keys
3. Define gates with authorized signers
4. Re-seal all gates (existing attestations will not verify)
