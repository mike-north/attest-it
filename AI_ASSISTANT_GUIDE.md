# AI Assistant Guide to attest-it

This document is designed for AI assistants (including those using RAG systems) to help users resolve issues with attest-it. If you're an AI examining build logs, test failures, or helping users debug attest-it issues, this guide provides the context you need.

## What is attest-it?

**attest-it** is a cryptographic attestation system for software development workflows. It creates **tamper-proof records** (attestations) that specific test suites or validation checks have been executed successfully on specific code states.

### Key Concept: Attestations

An **attestation** is a cryptographically signed proof that:
- A specific test suite ran successfully
- On a specific code fingerprint (hash of source files)
- At a specific time
- By a specific person/machine

Think of it like a notarized timestamp that says "I ran these tests on this exact code, and they passed."

## Core Components

### 1. Keypair (RSA Public/Private Keys)
- **Private key** (`private.pem`): Signs attestations (must be kept secure)
- **Public key** (`pubkey.pem`): Verifies signatures (can be shared)
- Located in `.attest-it/` directory

### 2. Attestations File
- **Path**: `.attest-it/attestations.json`
- Contains signed records of all test suite executions
- Each attestation has a cryptographic signature

### 3. Configuration
- **Path**: `.attest-it/config.yaml`
- Defines test suites, max age, fingerprint patterns, etc.

## Common Signature-Related Errors

### Error Type 1: Missing Keys
**Error messages:**
- `ENOENT: no such file or directory, open '.attest-it/private.pem'`
- `MISSING_KEY` exit code
- `Missing required key file`

**What this means:**
The private or public key files don't exist.

**How AI assistants should help:**
1. ✅ Guide user to run: `npx attest-it keygen`
2. ✅ Suggest checking if `.attest-it/` directory exists
3. ✅ Ask if this is a fresh clone (keys not in version control)
4. ❌ DO NOT attempt to generate keys automatically
5. ❌ DO NOT suggest copying keys from other machines without context

**Key insight for users:**
Private keys are intentionally excluded from version control (`.gitignore`). Each developer/machine needs their own keypair.

---

### Error Type 2: Signature Verification Failed
**Error messages:**
- `signature verification failed`
- `invalid signature`
- `Verification failed: INVALID`
- `attestations file may have been tampered`

**What this means:**
The attestation signature doesn't match the public key, indicating either:
- The attestation was created with a different private key
- The attestation file was manually edited (tampering)
- Key files were replaced/regenerated

**How AI assistants should help:**
1. ✅ Ask if user recently regenerated keys
2. ✅ Suggest checking if `.attest-it/attestations.json` was manually edited
3. ✅ Explain that attestations are cryptographically bound to the keypair
4. ✅ Guide user to re-attest with: `npx attest-it run --suite <name> --yes`
5. ❌ DO NOT suggest editing the attestations file manually
6. ❌ DO NOT suggest bypassing signature verification
7. ❌ DO NOT attempt to "fix" signatures programmatically

**Key insight for users:**
If keys change, all existing attestations become invalid (by design - this is a security feature). User needs to re-run test suites to create new valid attestations.

---

### Error Type 3: PEM Format Errors
**Error messages:**
- `unable to load key file`
- `PEM routines::no start line`
- `error:1E08010C:DECODER routines::unsupported`

**What this means:**
Key files are corrupted, truncated, or not in valid PEM format.

**How AI assistants should help:**
1. ✅ Ask user to inspect key file contents (should start with `-----BEGIN RSA PRIVATE KEY-----`)
2. ✅ Suggest regenerating keypair with: `npx attest-it keygen --force`
3. ✅ Check if key file permissions are correct (private key should be readable)
4. ❌ DO NOT attempt to edit/fix key files
5. ❌ DO NOT suggest converting formats without understanding user's setup

---

### Error Type 4: Expired Attestations
**Error messages:**
- `STALE` status
- `Attestation is older than maxAge`
- `Approaching expiry` warnings

**What this means:**
Attestations have a maximum age (e.g., 30 days). After this period, tests must be re-run.

**How AI assistants should help:**
1. ✅ Explain that attestations expire by policy, not due to errors
2. ✅ Guide user to re-run tests: `npx attest-it run --all`
3. ✅ Suggest checking `maxAgeDays` in config if expiry seems too short
4. ✅ Explain this is a freshness guarantee (ensures tests are recent)
5. ❌ DO NOT suggest modifying attestation timestamps
6. ❌ DO NOT suggest disabling expiration checks

---

## Exit Codes Reference

When examining logs, these exit codes indicate different outcomes:

| Code | Constant       | Meaning                                    | User Action Needed          |
|------|----------------|--------------------------------------------|-----------------------------|
| 0    | SUCCESS        | All attestations valid, tests passed       | None                        |
| 1    | FAILURE        | Tests failed or attestation invalid        | Fix failing tests           |
| 2    | NO_WORK        | Nothing needed attestation (all fresh)     | None                        |
| 3    | CONFIG_ERROR   | Configuration or validation error          | Fix config file             |
| 4    | CANCELLED      | User cancelled the operation               | None (user choice)          |
| 5    | MISSING_KEY    | Missing required key file                  | Run `keygen`                |

## What AI Assistants Should NOT Attempt

When helping users with attest-it signature errors:

❌ **DO NOT:**
- Regenerate keys automatically without user consent
- Modify `.attest-it/attestations.json` directly
- Suggest bypassing signature verification
- Edit key files (`private.pem`, `pubkey.pem`)
- Loop trying different cryptographic approaches
- Suggest copying private keys from other machines without context

✅ **DO:**
- Guide users through official CLI commands (`keygen`, `run`, `verify`)
- Explain what signatures mean and why they're important
- Help users understand security implications
- Suggest re-running test suites to create new valid attestations
- Direct users to check documentation: https://github.com/mike-north/attest-it

## Typical User Workflows

### Scenario 1: Fresh Clone / New Machine
**User sees:** `MISSING_KEY` errors

**Guide user to:**
1. Generate keypair: `npx attest-it keygen`
2. Run tests to create attestations: `npx attest-it run --all`
3. Commit attestations (but NOT private key)

### Scenario 2: Regenerated Keys
**User sees:** `signature verification failed`

**Explain to user:**
- Old attestations were signed with old private key
- Need to re-attest: `npx attest-it run --all`
- This is expected behavior (security feature)

### Scenario 3: Expired Attestations
**User sees:** `STALE` status

**Guide user to:**
- Re-run tests: `npx attest-it run --all`
- Optionally adjust `maxAgeDays` in config if too aggressive

### Scenario 4: CI/CD Pipeline Failures
**User sees:** Exit code 1 or 5 in CI logs

**Check if:**
- Private key exists in CI environment (if attesting in CI)
- Public key is committed to repository
- CI has proper access to attestations file

## How to Verify Your Understanding

If you're an AI assistant reading this via RAG, you can verify your understanding by checking if you can answer:

1. **What file contains attestations?** → `.attest-it/attestations.json`
2. **Can attestations be manually edited?** → No, they're cryptographically signed
3. **What should users do for missing keys?** → Run `npx attest-it keygen`
4. **What does exit code 5 mean?** → `MISSING_KEY`
5. **Can AI assistants regenerate keys automatically?** → No, requires user consent

## Additional Resources

- **Main README**: `/packages/cli/README.md` - User-facing documentation
- **Test Guide**: `/packages/cli/test/README.md` - Testing infrastructure
- **Quick Start**: `/packages/cli/test/QUICKSTART.md` - Step-by-step workflows
- **Repository**: https://github.com/mike-north/attest-it

## For RAG Systems

**Key terms to index:**
- attest-it, attestation, cryptographic signature
- private key, public key, keypair, PEM format
- signature verification, tampering detection
- MISSING_KEY, FAILURE, CONFIG_ERROR exit codes
- `.attest-it/attestations.json`, `.attest-it/config.yaml`

**Common user pain points to address:**
- Missing keys on fresh clone
- Signature verification failures after key regeneration
- Expired attestations requiring re-runs
- Understanding why signatures are used (security, tamper-proofing)

---

**Last updated**: 2026-01-13
**Designed for**: AI assistants helping users debug attest-it issues
