## Summary

This PR implements the attest-it v2.0 specification, introducing a new architecture for cryptographic attestation with identity management, Ed25519 cryptography, team authorization, and gate-based seals.

### Key Changes

- **Identity System**: Local identity management supporting multiple identities with file, macOS Keychain, and 1Password key storage
- **Ed25519 Cryptography**: Modern elliptic curve signatures using Node.js native crypto (replacing RSA-2048 for new seals)
- **Team Authorization**: Per-gate authorization with team member public keys defined in project config
- **Seal System**: New cryptographic seals for gates with verification states (VALID, MISSING, STALE, FINGERPRINT_MISMATCH, INVALID_SIGNATURE, UNKNOWN_SIGNER)

### Breaking Changes

| Change                           | Impact                                                   |
| -------------------------------- | -------------------------------------------------------- |
| Fingerprint separator `\0` → `:` | Existing attestations will not verify                    |
| CLI `verify`/`status` commands   | Now work with gates/seals instead of suites/attestations |
| Local identity config required   | New file at `~/.config/attest-it/config.yaml`            |
| Project config structure         | New `team` and `gates` sections                          |

### New CLI Commands

**Identity Management:**

- `identity list` - List all local identities
- `identity create` - Interactive identity + keypair creation
- `identity use <slug>` - Set active identity
- `identity show [slug]` - Show identity details
- `identity edit <slug>` - Edit identity or rotate keypair
- `identity remove <slug>` - Delete identity and key
- `identity export [slug]` - Export for team onboarding
- `whoami` - Show current active identity

**Team Management:**

- `team list` - List team members and authorizations
- `team add` - Interactive team member addition
- `team edit <slug>` - Edit team member
- `team remove <slug>` - Remove from project

**Seal Operations:**

- `seal [gate...]` - Create seals for gates

### Files Changed

| Category             | Files                                                                      |
| -------------------- | -------------------------------------------------------------------------- |
| Core - Identity      | `src/identity/types.ts`, `src/identity/config.ts`                          |
| Core - Crypto        | `src/crypto/ed25519.ts`                                                    |
| Core - Authorization | `src/authorization.ts`, `src/config.ts`                                    |
| Core - Seals         | `src/seal/types.ts`, `src/seal/operations.ts`, `src/seal/verification.ts`  |
| CLI - Identity       | `src/commands/identity/*.ts`, `src/commands/whoami.ts`                     |
| CLI - Team           | `src/commands/team/*.ts`                                                   |
| CLI - Seals          | `src/commands/seal.ts`, `src/commands/verify.ts`, `src/commands/status.ts` |

### Test Coverage

- **409 tests passing** in core package
- New test files for identity, Ed25519, authorization, and seal operations
- Positive, negative, and edge case coverage

### Code Review Findings Addressed

| Issue                      | Resolution                                                                     |
| -------------------------- | ------------------------------------------------------------------------------ |
| H1: Type export collision  | Renamed `SealVerificationResult` → `SignatureVerificationResult` in operations |
| M1: Keychain key reference | Fixed to pass `itemName` and return correct `keyRef`                           |
| M2: Duration parsing       | Added `isValidDurationFormat()` type guard                                     |
| M3: Seals file validation  | Added Zod schema validation                                                    |
| M4: Key cleanup logging    | Added `console.warn` when cleanup fails                                        |

## Test Plan

- [x] Core package tests pass (409/409)
- [x] CLI package builds successfully
- [x] Type checking passes
- [ ] Manual testing of identity commands
- [ ] Manual testing of team commands
- [ ] Manual testing of seal/verify workflow
