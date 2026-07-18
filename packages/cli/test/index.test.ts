/**
 * Unit coverage for `registerSigintHandler` (issue #100).
 *
 * This is a fast, focused check that the handler itself does the right
 * thing when a `SIGINT` event fires. It intentionally does not attempt to
 * prove that a real, kernel-delivered `SIGINT` reaches this handler --
 * that's the job of the pty-driven integration test in
 * `test/pty/run-cancellation.pty.test.ts`, which drives the actual built CLI
 * through a real pseudo-terminal and sends a genuine Ctrl-C keystroke.
 *
 * @see ../src/index.ts
 * @see ./pty/run-cancellation.pty.test.ts
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { registerSigintHandler } from '../src/index.js'
import { ExitCode } from '../src/utils/exit-codes.js'

describe('registerSigintHandler (issue #100)', () => {
  const mockConsoleLog = vi.spyOn(console, 'log').mockImplementation(() => undefined)
  const mockProcessExit = vi
    .spyOn(process, 'exit')
    // @ts-expect-error - Mocking process.exit which has a complex signature
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    .mockImplementation(() => {})

  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    // Every test registers its own listener via process.on('SIGINT', ...) --
    // remove them all so they don't leak into other test files (and don't
    // trip Node's MaxListenersExceededWarning across the whole run).
    process.removeAllListeners('SIGINT')
  })

  it('exits CANCELLED with a clean message when the process receives SIGINT', () => {
    registerSigintHandler()

    process.emit('SIGINT')

    expect(mockConsoleLog).toHaveBeenCalledWith('\nCancelled')
    expect(mockProcessExit).toHaveBeenCalledTimes(1)
    expect(mockProcessExit).toHaveBeenCalledWith(ExitCode.CANCELLED)
  })
})
