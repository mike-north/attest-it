/**
 * Regression/coverage test for issue #100's third scenario: `run --suite`
 * on non-interactive stdin (no TTY) without `--yes`.
 *
 * Prior to #100, `AI_ASSISTANT_GUIDE.md` and `docs/configuration.md`
 * documented every "cancelled/interrupted prompt" case -- including this one
 * -- as `CANCELLED` (4). This case never actually starts a prompt (the
 * missing-flag check runs *before* any prompt could), so there is nothing to
 * cancel; the real, correct, and unchanged behavior is `CONFIG_ERROR` (3),
 * the same code any other missing-required-input usage error gets. #100's
 * fix is the docs no longer implying this reaches `CANCELLED` -- see
 * `test/exit-codes.test.ts`'s pin of that prose. This test locks the
 * runtime behavior itself in place so a future change can't silently drift
 * it away from what the docs now say.
 *
 * @see ../src/commands/run.ts
 * @see ./exit-codes.test.ts
 * @see ./helpers/pty-fixture.ts
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { spawn } from 'node:child_process'
import { setupSealPromptFixture, CLI_PATH, type SealPromptFixture } from './helpers/pty-fixture.js'
import { ExitCode } from '../src/utils/exit-codes.js'

interface RunResult {
  exitCode: number
  stdout: string
  stderr: string
}

/** Run the built CLI as a real subprocess with stdin closed (`< /dev/null`) and a hard timeout. */
function runCliWithClosedStdin(
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
  timeoutMs = 15000,
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn('node', [CLI_PATH, ...args], {
      cwd,
      env: { ...process.env, NO_COLOR: '1', ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString()
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })

    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(
        new Error(
          `CLI call did not exit within ${String(timeoutMs)}ms -- likely hanging on an ` +
            `undocumented prompt with no TTY available: node attest-it ${args.join(' ')}\n` +
            `stdout so far:\n${stdout}\nstderr so far:\n${stderr}`,
        ),
      )
    }, timeoutMs)

    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ exitCode: code ?? 1, stdout, stderr })
    })

    child.on('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })
  })
}

describe('run --suite with no --yes and no TTY exits CONFIG_ERROR, not CANCELLED (issue #100)', () => {
  let fixture: SealPromptFixture

  beforeEach(async () => {
    fixture = await setupSealPromptFixture()
  }, 30000)

  afterEach(async () => {
    await fixture.cleanup()
  })

  it('exits CONFIG_ERROR (3) and names the missing --yes flag, without hanging', async () => {
    const result = await runCliWithClosedStdin(
      ['run', '--suite', fixture.suiteName],
      fixture.projectDir,
      fixture.env,
    )

    expect(result.exitCode).toBe(ExitCode.CONFIG_ERROR)
    expect(result.exitCode).not.toBe(ExitCode.CANCELLED)
    expect(result.stderr).toContain('--yes')
  }, 30000)
})
