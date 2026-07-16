/**
 * Tests for the shell-completion offer helper.
 *
 * `offerCompletionInstall` is called at the end of both `init` and
 * `identity create`. Before issue #80 it called `@inquirer/prompts`'
 * `confirm()` completely unconditionally -- with no TTY gate at all -- so a
 * non-interactive run (CI, an embedder, an agent) with `SHELL` set and no
 * saved preference would hang forever. It must now skip the offer entirely
 * when stdin is not an interactive TTY.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { confirm } from '@inquirer/prompts'
import { loadPreferences, savePreferences } from '@attest-it/core'

vi.mock('@inquirer/prompts', () => ({
  confirm: vi.fn(),
}))

vi.mock('@attest-it/core', async () => {
  const actual = await vi.importActual<typeof import('@attest-it/core')>('@attest-it/core')
  return {
    ...actual,
    loadPreferences: vi.fn(),
    savePreferences: vi.fn(),
  }
})

vi.mock('@pnpm/tabtab', () => ({
  default: { install: vi.fn() },
}))

vi.mock('../src/utils/output.js', () => ({
  log: vi.fn(),
  info: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}))

// Import after mocks
const { offerCompletionInstall } = await import('../src/utils/completion-offer.js')

describe('offerCompletionInstall', () => {
  const originalIsTTY = process.stdin.isTTY
  const originalShell = process.env.SHELL

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(loadPreferences).mockResolvedValue({})
    process.env.SHELL = '/bin/zsh'
  })

  afterEach(() => {
    Object.defineProperty(process.stdin, 'isTTY', { value: originalIsTTY, configurable: true })
    if (originalShell === undefined) {
      delete process.env.SHELL
    } else {
      process.env.SHELL = originalShell
    }
  })

  it('should skip the offer entirely without prompting when stdin is not a TTY (never hangs)', async () => {
    Object.defineProperty(process.stdin, 'isTTY', { value: undefined, configurable: true })

    const result = await offerCompletionInstall()

    expect(result).toBe(false)
    expect(confirm).not.toHaveBeenCalled()
    expect(loadPreferences).not.toHaveBeenCalled()
  })

  it('should prompt when stdin is an interactive TTY and no preference is saved', async () => {
    Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true })
    vi.mocked(confirm).mockResolvedValue(false)

    await offerCompletionInstall()

    expect(confirm).toHaveBeenCalledTimes(1)
  })

  it('should skip the offer when the user already declined, even with a TTY', async () => {
    Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true })
    vi.mocked(loadPreferences).mockResolvedValue({
      cliExperience: { declinedCompletionInstall: true },
    })

    const result = await offerCompletionInstall()

    expect(result).toBe(false)
    expect(confirm).not.toHaveBeenCalled()
  })

  it('should save the declined preference when the user declines interactively', async () => {
    Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true })
    vi.mocked(confirm).mockResolvedValue(false)

    const result = await offerCompletionInstall()

    expect(result).toBe(false)
    const savedPreferences = vi.mocked(savePreferences).mock.calls[0]?.[0]
    expect(savedPreferences?.cliExperience?.declinedCompletionInstall).toBe(true)
  })
})
