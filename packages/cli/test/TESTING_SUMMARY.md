# Interactive CLI Testing Infrastructure - Summary

## What Was Created

A comprehensive testing infrastructure for validating the `attest-it` interactive CLI experience, including both automated tests and manual validation tools.

## Files Created

### Core Infrastructure

1. **`helpers/fixture-factory.ts`** (580 lines)
   - Factory functions for creating realistic test projects
   - Uses `fixturify-project` to generate projects in temp directories
   - Supports custom suite configurations, attestations, and file structures
   - Includes 6 pre-configured scenarios

2. **`interactive-scenarios.test.ts`** (220 lines)
   - Automated integration tests using Vitest
   - Tests all major CLI scenarios with fixturify-generated projects
   - Validates status output, filtering, dry-run mode, and edge cases

3. **`manual-test-runner.ts`** (450 lines)
   - Interactive CLI tool for manual visual validation
   - Creates temp projects and presents a menu of test commands
   - Allows hands-on testing to check for visual artifacts
   - Supports all 6 pre-configured scenarios

### Documentation

4. **`README.md`** (450 lines)
   - Comprehensive testing guide
   - Explains all fixtures and scenarios
   - Visual validation checklist
   - Debugging tips and contribution guidelines

5. **`QUICKSTART.md`** (300 lines)
   - Get-started-in-5-minutes guide
   - Common testing workflows
   - Keyboard shortcuts reference
   - Troubleshooting section

6. **`examples/basic-fixture-usage.ts`** (200 lines)
   - Code examples showing fixture factory usage
   - 6 different usage patterns
   - Demonstrates integration with tests

### Configuration

7. **`package.json`** (updated)
   - Added `fixturify-project` dev dependency
   - Added `pnpm test:manual` script

## Pre-configured Test Scenarios

### 1. Multi-Suite Project (Default)

- **Fixture:** `createMultiSuiteFixture()`
- **What it creates:** 5 suites with mixed states
  - unit-tests: VALID (1 day old)
  - integration-tests: STALE (10 days old, max 7d)
  - e2e-tests: MISSING (no attestation)
  - linting: CHANGED (wrong fingerprint)
  - type-check: VALID (fresh)
- **Use case:** General testing, status badge rendering, interactive selection

### 2. All Valid

- **Fixture:** `createAllValidFixture()`
- **What it creates:** 1 suite with valid attestation
- **Use case:** Testing "nothing to do" state, edge case handling

### 3. All Missing

- **Fixture:** `createAllMissingFixture()`
- **What it creates:** 3 suites with no attestations
- **Use case:** First-run experience, bulk operations, "select all"

### 4. All Expired

- **Fixture:** `createAllExpiredFixture()`
- **What it creates:** 2 suites with expired attestations
- **Use case:** Expiration detection, re-attestation workflow

### 5. Complex Groups

- **Fixture:** `createComplexGroupsFixture()`
- **What it creates:** 6 suites across multiple groups
  - Frontend: unit + integration
  - Backend: unit + integration
  - E2E: slow tests
  - Security: quality checks
- **Use case:** Group filtering, handling many suites, organization

### 6. Failing Suite

- **Fixture:** `createFailingSuiteFixture()`
- **What it creates:** 1 passing + 1 failing suite
- **Use case:** Error handling, failure states, graceful degradation

## Quick Start

### For Manual Testing (Visual Validation)

```bash
cd packages/cli

# Build the CLI
pnpm build

# Run manual test runner (creates temp project with interactive menu)
pnpm test:manual

# Or run a specific scenario
pnpm test:manual all-missing
pnpm test:manual complex
pnpm test:manual failing
```

### For Automated Testing

```bash
cd packages/cli

# Build the CLI
pnpm build

# Run all tests including new interactive scenarios
pnpm test

# Run only interactive scenario tests
pnpm test interactive-scenarios
```

## Key Features

### Fixture Factory Capabilities

✅ **Programmatic project generation** - Create complex projects with simple function calls
✅ **Custom suite configurations** - Define suites with names, commands, max ages, and groups
✅ **Attestation generation** - Create attestations with specific ages and states
✅ **Git initialization** - Auto-initialize git repos with commits
✅ **Keypair generation** - Auto-generate attest-it keypairs
✅ **Custom file structures** - Add any files to the project
✅ **Temp directory management** - Automatic cleanup when done
✅ **Pre-configured scenarios** - 6 ready-to-use scenarios for common cases

### Manual Test Runner Features

✅ **Interactive menu** - Easy-to-use CLI for selecting test commands
✅ **Multiple scenarios** - Switch between different project states
✅ **Shell access** - Open a shell in the test project for exploration
✅ **Auto cleanup** - Projects are automatically deleted when done
✅ **Visual validation** - Run real CLI commands to check for artifacts

### Automated Test Coverage

✅ Status command output validation
✅ Dry-run mode testing
✅ Suite filtering with patterns
✅ Edge cases (all valid, all missing, all expired)
✅ Complex group structures
✅ Error handling with failing tests

## Usage Examples

### Example 1: Quick Visual Check

```bash
# 1. Build
pnpm build

# 2. Run manual tester with default scenario
pnpm test:manual

# 3. From menu, select:
#    - "status" to see status badges
#    - "run-interactive" to test the UI
#    - Press 0 to exit

# Temp project is automatically cleaned up
```

### Example 2: Create Custom Fixture in Code

```typescript
import { createProjectFixture } from './helpers/fixture-factory.js'

const project = await createProjectFixture({
  name: 'my-test-project',
  suites: [
    {
      name: 'custom-suite',
      command: 'npm test',
      maxAge: '30d',
      groups: ['tests'],
    },
  ],
  attestations: [{ suiteName: 'custom-suite', daysOld: 5 }],
  files: {
    'README.md': '# Test Project',
    'src/index.ts': 'console.log("test")',
  },
})

console.log('Project at:', project.baseDir)

// Use project...

await project.dispose() // Clean up
```

### Example 3: Add to Automated Test

```typescript
import { describe, it, expect, afterEach } from 'vitest'
import { createMultiSuiteFixture } from './helpers/fixture-factory.js'
import type { Project } from 'fixturify-project'

describe('My Test', () => {
  let project: Project | null = null

  afterEach(async () => {
    if (project) {
      await project.dispose()
      project = null
    }
  })

  it('should work with multi-suite project', async () => {
    project = await createMultiSuiteFixture()

    const result = await runCli(['status'], project.baseDir)

    expect(result.stdout).toContain('VALID')
  })
})
```

## Visual Validation Checklist

When manually testing, verify:

### Status Command

- [ ] Status badges display correctly (VALID, MISSING, STALE, CHANGED, INVALID)
- [ ] Colors: green (valid), yellow (warnings), red (errors)
- [ ] No text wrapping issues
- [ ] Table alignment is correct
- [ ] Suite names and reasons are readable

### Interactive Selection

- [ ] Suite table renders correctly
- [ ] Checkboxes [✓] and [ ] display properly
- [ ] Number indicators (1-9) visible
- [ ] Keyboard shortcuts work (a, n, 1-9, Space)
- [ ] "Already valid" section displays correctly
- [ ] No terminal artifacts when redrawing

### Test Runner

- [ ] Progress displays correctly
- [ ] Test output is readable
- [ ] Attestation prompts are clear
- [ ] Success/failure indicators work
- [ ] Summary shows completed/failed/skipped counts

### Common Artifacts to Check For

- [ ] No text overlapping
- [ ] No incomplete clearing
- [ ] No color bleeding
- [ ] Box drawing characters render correctly
- [ ] Cursor positioned correctly
- [ ] No flashing/flickering
- [ ] No truncated output

## Architecture

```
test/
├── helpers/
│   └── fixture-factory.ts         # Factory for creating test projects
├── examples/
│   └── basic-fixture-usage.ts     # Usage examples
├── interactive-scenarios.test.ts  # Automated integration tests
├── manual-test-runner.ts          # Interactive manual testing tool
├── README.md                      # Comprehensive guide
├── QUICKSTART.md                  # 5-minute getting started
└── TESTING_SUMMARY.md             # This file

Flow:
1. Fixture Factory creates realistic projects
2. Manual Test Runner uses fixtures for visual validation
3. Automated Tests use fixtures for regression testing
```

## Dependencies Added

- `fixturify-project@^7.1.3` - For creating realistic test projects

## Benefits

### For Developers

1. **Faster testing** - No manual project setup
2. **Consistent scenarios** - Same projects every time
3. **Easy reproduction** - Recreate any state easily
4. **Better coverage** - Test edge cases that are hard to create manually

### For Manual Testing

1. **Quick validation** - Run `pnpm test:manual` and test immediately
2. **Multiple scenarios** - Switch between project states easily
3. **No cleanup needed** - Projects auto-delete
4. **Realistic** - Tests with actual projects, not mocks

### For CI/CD

1. **Automated validation** - Catch regressions automatically
2. **Fast execution** - Tests run in temp directories
3. **Isolated** - Each test gets a fresh project
4. **Comprehensive** - All scenarios covered

## Next Steps

### Immediate

1. ✅ Infrastructure created
2. ⏭️ Build CLI: `pnpm build`
3. ⏭️ Run manual tests: `pnpm test:manual`
4. ⏭️ Run automated tests: `pnpm test`

### Future Enhancements

- [ ] Add more edge case scenarios
- [ ] Capture screenshots in automated tests
- [ ] Add performance benchmarks
- [ ] Create fixtures for monorepo structures
- [ ] Add visual regression testing

## Related Files

### Source Files (What We're Testing)

- `/packages/cli/src/commands/run-interactive.tsx` - Main interactive command
- `/packages/cli/src/components/` - React/Ink UI components
  - `InteractiveRun.tsx` - Main orchestrator
  - `SuiteSelector.tsx` - Suite selection UI
  - `TestRunner.tsx` - Test execution UI
  - `SuiteTable.tsx` - Status table rendering
  - `StatusBadge.tsx` - Colored status indicators

### Existing Tests

- `/packages/cli/test/run-interactive.test.tsx` - Unit tests
- `/packages/cli/test/components/InteractiveRun.test.tsx` - Component tests
- `/packages/cli/test/integration/cli.integration.test.ts` - Integration tests

## FAQ

### Q: Why use fixturify-project instead of manual file creation?

A: Fixturify-project provides:

- Automatic temp directory management
- Declarative file structures
- Type-safe project definitions
- Automatic cleanup
- Realistic project hierarchies

### Q: How do I add a new test scenario?

A:

1. Add factory function to `fixture-factory.ts`
2. Add test case to `interactive-scenarios.test.ts`
3. Add scenario to `manual-test-runner.ts`
4. Update documentation

### Q: Can I keep a project around for debugging?

A: Yes, don't call `project.dispose()`:

```typescript
const project = await createMultiSuiteFixture()
console.log('Project at:', project.baseDir)
// Don't dispose - project stays in temp directory
```

### Q: How do I test with a dirty git working tree?

A: Set `initGit: false` or make changes after creation:

```typescript
const project = await createProjectFixture({ initGit: false })
// Or:
const project = await createProjectFixture({ initGit: true })
// Make changes...
await execAsync('echo "new file" > test.txt', { cwd: project.baseDir })
```

### Q: Can I customize the attestation signature?

A: Currently attestations are placeholders. For full attestations, you need to:

1. Run the actual test
2. Sign with the private key
3. Save the attestation file

The factory creates placeholder attestations for testing status detection.

## Support

- Read [QUICKSTART.md](./QUICKSTART.md) for quick start
- Read [README.md](./README.md) for comprehensive docs
- Check [examples/](./examples/) for code examples
- Run `pnpm test:manual` to see it in action
- Open an issue with the `testing` label for questions

---

**Created:** January 2026
**Purpose:** Enable comprehensive testing of the interactive CLI experience
**Status:** ✅ Ready to use
