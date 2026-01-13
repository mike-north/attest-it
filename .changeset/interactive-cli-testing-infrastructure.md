---
'@attest-it/cli': minor
---

Add comprehensive interactive CLI testing infrastructure

**New Testing Utilities:**

- Fixture factory using fixturify-project for creating realistic test projects
- Automated integration tests validating CLI behavior across user workflows
- Manual test runner for visual validation and artifact detection
- Pre-configured test scenarios (multi-suite, all-missing, complex groups, failing tests)

**New Documentation:**

- Complete testing guide (test/README.md) with fixture usage and debugging tips
- Quick start guide (test/QUICKSTART.md) with step-by-step workflows
- Interactive CLI testing guide with usage examples

**Testing Coverage:**

- Git working tree validation
- Exit code handling (SUCCESS, FAILURE, NO_WORK, CONFIG_ERROR, CANCELLED, MISSING_KEY)
- Suite filtering and selection
- Dry run mode validation
- User workflow scenarios (first-time use, re-attestation, nothing to do)

This infrastructure enables systematic testing of the interactive CLI experience, including React/Ink UI components, keyboard shortcuts, status displays, and visual artifact detection.

**AI-Friendly Error Detection:**

- Added signature error detection wrapper to prevent AI assistants from looping on unfixable cryptographic issues
- Wraps keygen and attestation operations with clear error messages when signature-related failures occur
- Explicitly distinguishes signature issues (require human intervention) from other test failures (AI can help fix)
- Prevents futile retry loops when private keys are missing, corrupted, or have permission issues
- Created comprehensive AI Assistant Guide (`/AI_ASSISTANT_GUIDE.md`) optimized for RAG systems
- Error messages link directly to the guide for AI assistants examining CI/CD logs

**Fixes:**

- Updated README exit codes table to match implementation (6 codes instead of 2)
- Improved error handling in test helpers
- Added project-local private key support in fixtures to avoid test conflicts
- Enhanced `createRealAttestation()` with better error messages
