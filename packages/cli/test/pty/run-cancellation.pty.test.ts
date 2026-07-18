/**
 * pty-driven regression tests for issue #100: exit code `CANCELLED` (4) was
 * documented (by #98) as reachable by declining a confirmation prompt or by
 * Ctrl-C, but neither path actually produced it.
 *
 * These tests attach the real, built CLI to a genuine pseudo-terminal via
 * `node-pty` so `process.stdin.isTTY` is really `true` inside the CLI
 * process and real keystrokes/signals drive the exact interactive-prompt
 * and raw-SIGINT code paths the bug was in -- a piped/non-TTY stdin (as
 * used by the CLI's other integration tests) never reaches either path, so
 * mocking or piping stdin here would not have caught the original bug.
 *
 * - "declining a seal prompt exits CANCELLED, not SUCCESS" reproduces the
 *   exact repro from the issue: typing `n` at "Create seal for gate 'x'?"
 *   previously logged "Seal creation skipped" and fell through to the
 *   caller's normal success path (implicit exit 0).
 * - "Ctrl-C during a seal prompt exits CANCELLED" reproduces a real SIGINT
 *   (not `@inquirer/core`'s internal force-close detection, which only
 *   fires in the specific terminal mode a prompt puts the tty in) --
 *   previously this fell through to Node's default, uncaught-signal
 *   termination.
 *
 * @see ../../src/commands/run.ts
 * @see ../../src/index.ts
 * @see ../helpers/pty.ts
 * @see ../helpers/pty-fixture.ts
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { spawnPty, waitForOutput, waitForPtyExit } from '../helpers/pty.js'
import { setupSealPromptFixture, CLI_PATH, type SealPromptFixture } from '../helpers/pty-fixture.js'

const PTY_TEST_TIMEOUT_MS = 30000

describe('run --suite: seal prompt cancellation exits CANCELLED (issue #100)', () => {
  let fixture: SealPromptFixture

  beforeEach(async () => {
    fixture = await setupSealPromptFixture()
  }, PTY_TEST_TIMEOUT_MS)

  afterEach(async () => {
    await fixture.cleanup()
  })

  it(
    'declining the seal prompt (typing "n") exits CANCELLED (4), not SUCCESS (0)',
    async () => {
      const term = spawnPty('node', [CLI_PATH, 'run', '--suite', fixture.suiteName], {
        cwd: fixture.projectDir,
        env: fixture.env,
      })

      await waitForOutput(term, (acc) => acc.includes(`Create seal for gate '${fixture.gateId}'`))

      term.write('n\r')

      const exitCode = await waitForPtyExit(term)

      // Pre-fix: this was 0 (SUCCESS) -- the decline logged "Seal creation
      // skipped" and fell through to "Suite completed!" as if nothing had
      // gone wrong, which is exactly what let a CI script read a declined
      // seal as a passing attestation.
      expect(exitCode).not.toBe(0)
      expect(exitCode).toBe(4) // ExitCode.CANCELLED
    },
    PTY_TEST_TIMEOUT_MS,
  )

  it(
    'Ctrl-C (SIGINT) during the seal prompt exits CANCELLED (4), not the shell-conventional 130',
    async () => {
      const term = spawnPty('node', [CLI_PATH, 'run', '--suite', fixture.suiteName], {
        cwd: fixture.projectDir,
        env: fixture.env,
      })

      await waitForOutput(term, (acc) => acc.includes(`Create seal for gate '${fixture.gateId}'`))

      // Send a real Ctrl-C keystroke through the pty -- this is what a real
      // terminal delivers for Ctrl-C, exercising the same raw-SIGINT path a
      // human would trigger (as opposed to calling `child.kill('SIGINT')`
      // on a plain piped child, which does not reproduce the terminal-mode
      // nuance the original bug lived in).
      term.write('\x03')

      const exitCode = await waitForPtyExit(term)

      // Pre-fix: there was no `process.on('SIGINT', ...)` handler anywhere
      // in the CLI, so Node's default action for an uncaught SIGINT ran
      // instead of a clean `process.exit(4)` -- the process was killed by
      // the signal (a parent shell would typically report this as 130).
      expect(exitCode).toBe(4) // ExitCode.CANCELLED
    },
    PTY_TEST_TIMEOUT_MS,
  )
})
