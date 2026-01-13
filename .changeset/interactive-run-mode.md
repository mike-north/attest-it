---
'@attest-it/cli': minor
'@attest-it/core': patch
---

Add interactive mode for `attest-it run` with suite selection

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
