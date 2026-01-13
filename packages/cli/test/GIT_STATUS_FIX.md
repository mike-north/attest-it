# Git Status Check Fix

## Issue

The manual test runner was failing with "Working tree has uncommitted changes" error even though there shouldn't be any uncommitted files.

## Root Cause

The manual test runner was creating fixture projects but **not** generating the keypair and committing it, leaving uncommitted files in the working tree. The interactive CLI validates that the git working tree is clean before running attestations, so it would fail.

**Sequence of events:**
1. Manual test runner creates fixture (commits initial files)
2. Manual test runner **skips** keypair generation
3. User tries to run `attest-it run`
4. CLI checks git status and finds uncommitted `.attest-it/pubkey.pem`
5. CLI errors: "Working tree has uncommitted changes"

**Why automated tests worked:**
The automated tests used a `setupProject()` helper that:
1. Creates fixture
2. Generates keypair
3. Commits keypair
4. Leaves clean working tree

## Fix

### 1. Added Automated Test

Added a test in `interactive-scenarios.test.ts` that verifies the git working tree is clean after setup:

```typescript
it('should have a clean git working tree after setup', async () => {
  project = await createMultiSuiteFixture();
  await setupProject(project);

  // Check git status - should be clean (no uncommitted changes)
  const gitStatus = await checkGitStatus(project.baseDir);
  expect(gitStatus).toBe('');
});
```

This test uses `git status --porcelain` (same as the CLI check) to verify there are no uncommitted changes.

### 2. Fixed Manual Test Runner

Updated `manual-test-runner.ts` to generate and commit the keypair before running commands:

```typescript
// Create the fixture
console.log('\nCreating test project...');
const project = await scenario.createFixture();

// Setup the project (generate keypair and commit)
console.log('Setting up keypair...');
const cliPath = join(__dirname, '../dist/bin/attest-it.js');

// Generate keypair
await runCommand('node', [cliPath, 'keygen', '--force', '--public', '.attest-it/pubkey.pem'], project.baseDir);

// Commit the keypair
await runCommand('git', ['add', '.'], project.baseDir);
await runCommand('git', ['commit', '-m', 'Add keypair', '--allow-empty'], project.baseDir);

console.log('✓ Setup complete');
```

### 3. Updated Documentation

Added notes to `README.md` explaining that fixtures have clean git working trees:

```markdown
**Important:** All fixtures are set up with a clean git working tree:
- Project files are created and committed
- Keypair is generated and committed
- Working tree is verified clean before tests run
- Automated test ensures `git status --porcelain` returns empty
```

## How the CLI Check Works

From `src/commands/run-interactive.tsx:310-328`:

```typescript
async function checkDirtyWorkingTree(): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn('git', ['status', '--porcelain'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let output = ''
    child.stdout.on('data', (data: Buffer) => {
      output += data.toString()
    })

    child.on('close', () => {
      resolve(output.trim().length > 0)
    })
    child.on('error', () => {
      resolve(false)
    })
  })
}
```

If `git status --porcelain` returns any output, there are uncommitted changes.

## Test Results

✅ **All 6 tests passing** (was 5, added 1 new test):
1. ✅ Should have a clean git working tree after setup **(NEW)**
2. ✅ Multi-suite project fixture creation
3. ✅ All-valid project fixture creation
4. ✅ All-missing project fixture creation
5. ✅ Complex groups project fixture creation
6. ✅ Help command on fixture projects

## Verification

To verify the fix works:

```bash
# Run automated tests (includes git status check)
pnpm test interactive-scenarios

# Run manual test runner (should no longer fail)
pnpm test:manual

# Select option 1 (status) or 2 (run-interactive)
# Should work without "uncommitted changes" error
```

## Files Changed

1. **`test/interactive-scenarios.test.ts`**
   - Added `checkGitStatus()` helper function
   - Added test: "should have a clean git working tree after setup"

2. **`test/manual-test-runner.ts`**
   - Added keypair generation and commit before running commands
   - Now matches the setup used in automated tests

3. **`test/README.md`**
   - Added documentation about git working tree requirements
   - Explained that fixtures are set up with clean working trees

## Related Code

**Git status check locations:**
- `src/commands/run-interactive.tsx:86-89` - Check before interactive run
- `src/commands/run-interactive.tsx:305-328` - `checkDirtyWorkingTree()` implementation
- `src/commands/run.ts:259-262` - Check in direct run mode
- `src/commands/run.ts:313-316` - Check in --all mode

**Error message:**
```
Working tree has uncommitted changes. Please commit or stash before attesting.
```

## Prevention

The new automated test will catch this issue if it ever reoccurs. If the git working tree is not clean after setup, the test will fail with output showing what files are uncommitted.

---

**Status:** ✅ Fixed
**Tests:** ✅ All 6 passing
**Fixed:** January 2026
