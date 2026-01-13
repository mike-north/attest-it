# Quick Start: Testing the Interactive CLI

This guide gets you up and running with the interactive CLI testing tools in 5 minutes.

## Prerequisites

1. Build the CLI:
   ```bash
   cd packages/cli
   pnpm build
   ```

## Running Manual Tests (Recommended First Step)

The fastest way to validate the interactive CLI and check for visual artifacts:

### 1. Run the default scenario (multi-suite project)

```bash
pnpm test:manual
```

This creates a temporary project with 5 suites in various states and presents an interactive menu.

**⚠️ IMPORTANT:** The test suites use **dummy commands** (just `console.log` statements) for UI testing purposes. They don't test real code. This is intentional - the manual test runner is for validating the **CLI interface itself** (visual rendering, keyboard shortcuts, colors, etc.), not for demonstrating a real workflow.

### 2. Try different commands

Select commands from the menu to see:

- **Status command** - View the visual rendering of status badges
- **Interactive run** - Test the full interactive selection experience
- **Dry run** - See what would be executed without running tests
- **Filter** - Test suite filtering by pattern

### 3. Check for visual artifacts

As you run commands, look for:

- ✓ Clean text rendering (no overlapping)
- ✓ Proper colors (green=valid, yellow=warning, red=error)
- ✓ Correct table alignment
- ✓ No flickering or artifacts when redrawing
- ✓ Keyboard shortcuts work as expected

### 4. Try other scenarios

Run specific scenarios:

```bash
# All suites missing attestations
pnpm test:manual all-missing

# Complex groups structure (6 suites)
pnpm test:manual complex

# All suites have expired attestations
pnpm test:manual all-expired

# Project with failing tests
pnpm test:manual failing

# Run all scenarios in sequence
pnpm test:manual all
```

## Running Automated Tests

To run the automated integration tests:

```bash
pnpm test
```

Or run just the interactive scenario tests:

```bash
pnpm test interactive-scenarios
```

## Common Testing Workflows

### Workflow 1: Quick Visual Check

```bash
# 1. Build
pnpm build

# 2. Run manual tester
pnpm test:manual

# 3. Select "status" to see status badges
# 4. Select "run-interactive" to test the UI
# 5. Press 0 to exit
```

### Workflow 2: Reproduce a Bug

```bash
# 1. Build
pnpm build

# 2. Choose the scenario that matches the bug
pnpm test:manual multi-suite  # or all-missing, complex, etc.

# 3. Run the command that triggers the bug
# 4. Observe and document the issue
# 5. Press 0 to exit (cleans up automatically)
```

### Workflow 3: Test a Fix

```bash
# 1. Make your code changes

# 2. Rebuild
pnpm build

# 3. Run automated tests
pnpm test

# 4. Run manual tests to visually verify
pnpm test:manual

# 5. Test the specific scenario that was broken
```

### Workflow 4: Explore Project Structure

```bash
# 1. Run manual tester
pnpm test:manual complex

# 2. From menu, select "Open shell in project directory"

# 3. Explore the generated project:
ls -la
cat .attest-it/config.yaml
attest-it status
attest-it run

# 4. Type "exit" to return to menu
# 5. Press 0 to exit and clean up
```

## Understanding Test Scenarios

### `multi-suite` (Default)

**When to use:** General testing, checking status badge rendering

**What it creates:**

- 5 suites: unit-tests, integration-tests, e2e-tests, linting, type-check
- Mix of states: valid, expired, missing, changed

**Tests:**

- Status badge display
- Interactive selection with mixed states
- Filtering by pattern

### `all-missing`

**When to use:** Testing "first run" experience, bulk operations

**What it creates:**

- 3 suites with no attestations
- All suites show as MISSING

**Tests:**

- "Select all" functionality
- Bulk attestation creation
- First-time user experience

### `all-expired`

**When to use:** Testing expiration detection

**What it creates:**

- 2 suites with expired attestations
- All show as STALE

**Tests:**

- Expiration date calculation
- Re-attestation workflow

### `complex`

**When to use:** Testing with many suites, group organization

**What it creates:**

- 6 suites across multiple groups (frontend, backend, e2e, security)

**Tests:**

- Group-based filtering
- Handling many suites
- Suite organization

### `failing`

**When to use:** Testing error handling

**What it creates:**

- 1 passing suite, 1 failing suite

**Tests:**

- Test failure handling
- Error messages
- Graceful degradation

## Keyboard Shortcuts Reference

When in interactive selection mode:

| Key                | Action                        |
| ------------------ | ----------------------------- |
| `a`                | Select all pending suites     |
| `n`                | Deselect all suites           |
| `1-9`              | Toggle suite by number        |
| `Space` or `Enter` | Continue with selected suites |
| `Ctrl+C`           | Cancel and exit               |

## Expected Visual Output Examples

### Status Command

```
Status           Suite                 Reason
────────────────────────────────────────────────────────────
✓ VALID          type-check            All checks passed
  STALE          integration-tests     10 days old (max: 7)
  MISSING        e2e-tests             No attestation found
  CHANGED        linting               Fingerprint mismatch
✓ VALID          unit-tests            1 day old (max: 30)
```

**Note:** `attest-it status` returns exit code 1 when there are pending suites (NEEDS_ATTESTATION, STALE, etc.). This is **not an error** - it's intentional behavior. Exit code 0 means all suites are valid.

### Interactive Selection

```
Select suites to run (pending: 3)

   Status           Suite                 Reason
   ────────────────────────────────────────────────────────────
   [1] STALE            integration-tests     10 days old
   [2] MISSING          e2e-tests             No attestation
   [3] CHANGED          linting               Fingerprint changed

Already valid:
   ✓ VALID          type-check
   ✓ VALID          unit-tests

Press 'a' for all, 'n' for none, or 1-9 to toggle
```

## Troubleshooting

### "Command not found: tsx"

```bash
pnpm add -g tsx
# or
npm install -g tsx
```

### "CLI not built"

```bash
cd packages/cli
pnpm build
```

### "Cannot find module"

Make sure you're in the `packages/cli` directory:

```bash
cd packages/cli
pnpm test:manual
```

### Tests fail with "ENOENT"

The automated tests expect the CLI to be built:

```bash
pnpm build
pnpm test
```

## Next Steps

- Read [README.md](./README.md) for comprehensive documentation
- Create custom test scenarios using the fixture factory
- Add new automated tests for specific edge cases
- Report visual artifacts with screenshots

## Pro Tips

1. **Keep the CLI built:** Run `pnpm build` in watch mode: `pnpm build --watch`
2. **Use --verbose:** Add `--verbose` to see detailed output: `attest-it status --verbose`
3. **Keep projects around:** Comment out `project.dispose()` to inspect the temp project
4. **Test in different terminals:** Visual artifacts may only appear in certain terminal emulators

## Agent-Friendly Mode (For AI Assistants)

The manual test runner supports a non-interactive mode that outputs structured data for AI agents to monitor progress.

### Quick Start for Agents

```bash
# 1. Generate command for user to paste
pnpm test:manual:agent multi-suite

# 2. User pastes the command in a new terminal
# (Output will stream to manual-test-output.md)

# 3. Monitor the files:
# - ./manual-test-output.md (streaming markdown results)
# - ./manual-test-output.md.status.json (current state)
```

### Available Flags

- `--print-command`: Print command for user to paste, then exit
- `--non-interactive`: Run without prompts, write to output file
- `--output <path>`: Path to markdown output file (default: ./manual-test-output.md)
- `--status <path>`: Path to JSON status file (default: <output>.status.json)

### Example: Complete Agent Workflow

```typescript
// 1. Generate command
const { stdout } = await execa('pnpm', ['test:manual:agent', 'multi-suite'])
console.log('Please run this command:', stdout)

// 2. Poll status file for completion
const statusPath = './manual-test-output.md.status.json'
while (true) {
  const status = JSON.parse(await fs.readFile(statusPath, 'utf-8'))

  if (status.status === 'completed') {
    // Read final results
    const results = await fs.readFile('./manual-test-output.md', 'utf-8')
    console.log('Test completed:', results)
    break
  } else if (status.status === 'failed') {
    throw new Error(`Test failed: ${status.error}`)
  }

  await sleep(1000) // Poll every second
}
```

### Output File Format

The markdown output includes:

- **Header**: Scenario info and project path
- **Agent Instructions**: Complete guide to attest-it and how to work with users
- **Command Sections**: Each command's output with timestamps and exit codes
- **Summary**: Final statistics

The JSON status file provides:

```json
{
  "version": 1,
  "status": "running",
  "scenario": { "key": "multi-suite", "name": "...", "description": "..." },
  "projectPath": "/tmp/test-project-...",
  "currentCommand": { "index": 2, "name": "run-interactive", "status": "running" },
  "commands": [...],
  "stats": { "total": 5, "completed": 1, "failed": 0, "skipped": 0 }
}
```

### Understanding Agent Instructions

The output file includes comprehensive instructions explaining:

- What attest-it is (human-gated test attestation)
- Why manual tests are needed (UI validation, OAuth flows, etc.)
- The security model (asymmetric crypto prevents AI from faking attestations)
- How to work with users to provide attestations
- Exit codes and their meanings
- How to interpret status badges (VALID, STALE, MISSING, CHANGED)

This ensures even agents unfamiliar with attest-it can effectively guide users through the attestation workflow.

## Getting Help

If you encounter issues:

1. Check the [README.md](./README.md) for detailed documentation
2. Look at existing tests in `interactive-scenarios.test.ts` for examples
3. Open an issue with:
   - Scenario you were running
   - Command that failed
   - Expected vs actual behavior
   - Screenshot if visual issue
