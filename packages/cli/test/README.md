# Interactive CLI Testing Guide

This directory contains comprehensive testing infrastructure for the `attest-it` interactive CLI experience, including both automated tests and manual validation tools.

## Overview

The interactive CLI is a terminal-based UI (using React + Ink) that allows users to:

- View the status of test suite attestations
- Select which suites to run
- Execute tests and create attestations
- Resume interrupted sessions

This testing infrastructure helps validate that:

- Visual rendering is correct (no artifacts)
- Status badges display properly with correct colors
- Keyboard interactions work as expected
- Different project states are handled correctly
- Edge cases are covered

## Test Infrastructure

### 1. Fixture Factory (`helpers/fixture-factory.ts`)

Creates realistic test projects using `fixturify-project`. This allows us to programmatically generate complex project structures in temporary directories.

**Important:** All fixtures are set up with a clean git working tree:

- Project files are created and committed
- Keypair is generated and committed
- Working tree is verified clean before tests run
- Automated test ensures `git status --porcelain` returns empty

**Key Features:**

- Programmatic project creation with custom suite configurations
- Attestation generation with configurable states (expired, invalid, missing)
- Git repository initialization
- Keypair generation
- Pre-configured scenarios for common test cases

**Example Usage:**

```typescript
import { createMultiSuiteFixture } from './helpers/fixture-factory.js'

// Create a project with 5 suites in various states
const project = await createMultiSuiteFixture()

// Use the project for testing
await runCli(['status'], project.baseDir)

// Clean up when done
await project.dispose()
```

### 2. Pre-configured Scenarios

The fixture factory includes several pre-configured scenarios:

#### `createMultiSuiteFixture()`

Project with 5 suites in various states:

- `unit-tests` - Fresh attestation (1 day old)
- `integration-tests` - Expired (10 days old, max age 7d)
- `e2e-tests` - Missing attestation
- `linting` - Wrong fingerprint (changed)
- `type-check` - Valid and fresh

**Use for:** Testing mixed status displays, selection UI, filtering

#### `createAllValidFixture()`

All suites have valid, fresh attestations.

**Use for:** Testing "nothing to do" state, edge case handling

#### `createAllMissingFixture()`

3 suites with no attestations.

**Use for:** Testing bulk attestation creation, "select all" functionality

#### `createAllExpiredFixture()`

2 suites with expired attestations.

**Use for:** Testing expiration detection and re-attestation flow

#### `createComplexGroupsFixture()`

6 suites organized into groups:

- Frontend (unit + integration)
- Backend (unit + integration)
- E2E (slow)
- Security scan (quality)

**Use for:** Testing group-based filtering and organization

#### `createFailingSuiteFixture()`

One passing suite and one failing suite.

**Use for:** Testing error handling, failure states

### 3. Automated Tests (`interactive-scenarios.test.ts`)

Integration tests using Vitest that validate CLI behavior across all scenarios.

**Run tests:**

```bash
pnpm test
```

**What's tested:**

- ✓ Status command output for various project states
- ✓ Dry-run mode
- ✓ Suite filtering with `--filter` flag
- ✓ "All valid" edge case
- ✓ "All missing" bulk operations
- ✓ Expired attestation detection
- ✓ Complex group structures
- ✓ Failing test handling

### 4. Manual Test Runner (`manual-test-runner.ts`)

Interactive tool for manual visual validation. Creates real projects and launches the CLI for hands-on testing.

**⚠️ Important:** The test suites use **dummy commands** (simple `console.log` statements) that don't test real code. This is intentional - the manual test runner is for validating the **CLI interface** (visual rendering, keyboard shortcuts, status displays, etc.), not for demonstrating real test workflows.

In a real `attest-it` project, suites would run actual tests (like `npm test`, `pytest`, etc.) and you would manually review the test output before attesting.

**Run the manual test runner:**

```bash
# Run default scenario (multi-suite)
pnpm tsx test/manual-test-runner.ts

# Run a specific scenario
pnpm tsx test/manual-test-runner.ts all-missing
pnpm tsx test/manual-test-runner.ts complex
pnpm tsx test/manual-test-runner.ts failing

# Run all scenarios in sequence
pnpm tsx test/manual-test-runner.ts all
```

**Available scenarios:**

- `multi-suite` - Mixed states (default)
- `all-valid` - All valid attestations
- `all-missing` - All missing attestations
- `all-expired` - All expired attestations
- `complex` - Complex groups structure
- `failing` - Failing test suite
- `all` - Run all scenarios

**Interactive Menu:**

The manual test runner presents an interactive menu for each scenario:

```
Available Commands
==================
1. status: View status of all suites
2. run-interactive: Interactive suite selection
3. run-all-dry: Dry run of all pending suites
4. run-filter: Filter suites by pattern
5. Open shell in project directory
0. Exit
```

You can:

- Run specific commands to see the visual output
- Open a shell to explore the project structure
- Test keyboard interactions (arrow keys, space, numbers, etc.)
- Verify colors and formatting
- Check for visual artifacts

## Visual Validation Checklist

When manually testing the interactive CLI, verify:

### Status Command

- [ ] Status badges display correctly (VALID, MISSING, STALE, CHANGED, INVALID)
- [ ] Colors are appropriate (green for valid, yellow for warnings, red for errors)
- [ ] No text wrapping issues
- [ ] Table alignment is correct
- [ ] Suite names and reasons are readable

### Interactive Selection

- [ ] Suite table renders correctly
- [ ] Checkboxes `[✓]` and `[ ]` display properly
- [ ] Number indicators (1-9) are visible
- [ ] Keyboard shortcuts work:
  - `a` - Select all
  - `n` - Deselect all
  - `1-9` - Toggle individual suites
  - `Space` - Continue
- [ ] "Already valid" suites section displays correctly
- [ ] No terminal artifacts when redrawing

### Test Runner Phase

- [ ] Progress shows correctly
- [ ] Test output displays properly
- [ ] Attestation prompts are clear
- [ ] Success/failure indicators work
- [ ] Summary displays completed/failed/skipped counts

### Session Management

- [ ] `--continue` flag resumes correctly
- [ ] Pre-selected suites show as checked
- [ ] Session state persists between runs

## Common Visual Artifacts to Check For

Based on the issue description, specifically check for:

1. **Text overlapping** - Lines of text rendering on top of each other
2. **Incomplete clearing** - Previous output not being erased
3. **Color bleeding** - ANSI codes not resetting properly
4. **Box drawing characters** - Incorrect rendering of table borders
5. **Cursor positioning** - Cursor appearing in wrong location
6. **Flashing/flickering** - Screen redrawing too frequently
7. **Truncated output** - Text being cut off unexpectedly

## Creating Custom Test Scenarios

You can create custom scenarios using the fixture factory:

```typescript
import { createProjectFixture } from './helpers/fixture-factory.js'

const project = await createProjectFixture({
  name: 'my-test-project',
  suites: [
    {
      name: 'custom-suite',
      command: 'node -e "console.log(\'test\')"',
      maxAge: '30d',
      groups: ['custom-group'],
    },
  ],
  attestations: [
    {
      suiteName: 'custom-suite',
      daysOld: 5, // 5 days old
      wrongFingerprint: false,
    },
  ],
  initGit: true,
  generateKeys: true,
  files: {
    'README.md': '# My Test Project',
    'src/index.ts': 'console.log("Hello")',
  },
})

// Use project for testing...

await project.dispose()
```

## Debugging Tips

### Enable verbose logging

```bash
attest-it status --verbose
```

### Check raw terminal output

```bash
script -q /dev/null attest-it run | cat -A
```

### Inspect Ink component state

Use `ink-testing-library` in automated tests:

```typescript
import { render } from 'ink-testing-library';
import { InteractiveRun } from '../src/components/InteractiveRun.js';

const { lastFrame } = render(<InteractiveRun />);
console.log(lastFrame());
```

### Access test project manually

```typescript
const project = await createMultiSuiteFixture()
console.log('Project at:', project.baseDir)
// Don't call dispose() to keep it around
```

## Contributing New Tests

When adding new test scenarios:

1. **Create the fixture** in `fixture-factory.ts` if it's reusable
2. **Add automated tests** in `interactive-scenarios.test.ts`
3. **Add to manual test runner** in `manual-test-runner.ts`
4. **Update this README** with the new scenario

## Test Coverage Goals

Our testing should cover:

- ✅ All status badge types (VALID, MISSING, STALE, CHANGED, INVALID, INVALIDATED)
- ✅ Empty states (no suites, all valid, all invalid)
- ✅ Large numbers of suites (10+)
- ✅ Long suite names (wrapping behavior)
- ✅ All keyboard shortcuts
- ✅ Filter patterns (exact match, wildcards, groups)
- ✅ Session persistence and resumption
- ✅ Error states (failing tests, missing config, etc.)
- ⚠️ Visual artifacts and rendering issues (manual testing required)

## CI/CD Integration

The automated tests run as part of the standard test suite:

```bash
# Run all tests including interactive scenarios
pnpm test

# Run only interactive scenario tests
pnpm test interactive-scenarios
```

Manual visual validation should be performed:

- Before major releases
- When changing Ink components
- When updating terminal rendering logic
- When visual artifacts are reported

## Related Files

- `/packages/cli/src/commands/run-interactive.tsx` - Main interactive command
- `/packages/cli/src/components/` - React/Ink UI components
- `/packages/cli/test/run-interactive.test.tsx` - Unit tests for run-interactive
- `/packages/cli/test/components/InteractiveRun.test.tsx` - Component tests
- `/packages/cli/test/integration/cli.integration.test.ts` - Full integration tests

## Questions?

If you have questions about the testing infrastructure or need help creating new test scenarios, please:

1. Check existing tests for examples
2. Review the fixture factory documentation
3. Run the manual test runner to see it in action
4. Open an issue with the `testing` label
