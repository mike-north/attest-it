# @attest-it/cli

## 0.3.0

### Minor Changes

- 7f9d7fb: Add comprehensive interactive CLI testing infrastructure

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

## 0.2.0

### Minor Changes

- b5e5769: Add interactive mode for `attest-it run` with suite selection

  **New Features:**
  - Interactive suite selection UI when `attest-it run` is invoked without `--suite` or `--all`
  - Status display with colored badges: MISSING, STALE, CHANGED, VALID
  - New CLI options: `--dry-run`, `--continue`, `--filter <pattern>`
  - Session persistence in `.attest-it/session.json` for resumable interrupted runs
  - Suite dependencies via `depends_on` config with automatic topological sorting
  - Suite groups for batch selection

  **Breaking Changes:**
  - **Default behavior change:** `attest-it run` without flags now enters interactive mode instead of erroring
  - Exit code 2 now means "no work needed" (all suites valid)
  - Exit code 3 is now CONFIG_ERROR (was 2)
  - Exit code 4 is now CANCELLED (was 3)
  - Exit code 5 is now MISSING_KEY (was 4)

  **Dependencies:**
  - Replaced `picocolors` with `chromaterm` for terminal colors
  - Added `ink` and `react` for interactive TUI components
  - Added `ink-testing-library` for component testing (dev)

### Patch Changes

- Updated dependencies [b5e5769]
  - @attest-it/core@0.2.0

## 0.1.0

### Minor Changes

- 49c778c: Simplified `attest-it init` command

## 0.0.2

### Patch Changes

- 2fde289: Fix package release so that pnpm workspaces references are replaced by actual semver version specifiers
- 2fde289: Fix dependency references
- Updated dependencies [2fde289]
- Updated dependencies [2fde289]
  - @attest-it/core@0.0.2
