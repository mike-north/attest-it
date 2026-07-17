/**
 * Tests for `identity export`.
 *
 * Regression: the exported YAML snippet's guidance comments referenced a
 * file/section that never existed on the current split-config model
 * (".attest-it/team-config.yaml" and a "members:" section). Team data
 * actually lives under the "team:" key in ".attest-it/policy.yaml" -- see
 * `packages/cli/src/commands/team/join.ts` and `packages/core/src/config/policy-schema.ts`.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { LocalConfig } from '@attest-it/core'

vi.mock('@attest-it/core', async () => {
  const actual = await vi.importActual<typeof import('@attest-it/core')>('@attest-it/core')
  return {
    ...actual,
    loadLocalConfig: vi.fn(),
  }
})

const mockConsoleLog = vi.spyOn(console, 'log').mockImplementation(() => {
  // Intentionally empty
})
const mockConsoleError = vi.spyOn(console, 'error').mockImplementation(() => {
  // Intentionally empty
})
const mockProcessExit = vi
  .spyOn(process, 'exit')
  // @ts-expect-error - Mocking process.exit which has a complex signature
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  .mockImplementation(() => {})

const { loadLocalConfig } = await import('@attest-it/core')
const { runExport } = await import('../src/commands/identity/export.js')

function mockLocalConfig(): LocalConfig {
  return {
    version: 2,
    activeIdentity: 'alice',
    identities: {
      alice: {
        name: 'Alice',
        publicKey: 'pk-alice',
        privateKey: { type: 'file', id: 'secret-id' },
        email: 'alice@example.com',
      },
    },
  }
}

describe('identity export', () => {
  beforeEach(() => vi.clearAllMocks())
  afterEach(() => vi.clearAllMocks())

  it('points at the current policy.yaml file and "team:" section, not the stale team-config.yaml/members: text', async () => {
    vi.mocked(loadLocalConfig).mockResolvedValue(mockLocalConfig())

    await runExport()

    const printed = mockConsoleLog.mock.calls.map((c) => String(c[0])).join('\n')
    expect(printed).toContain('.attest-it/policy.yaml')
    expect(printed).toContain('"team:" section')
    expect(printed).not.toContain('team-config.yaml')
    expect(printed).not.toContain('members:')
    expect(mockProcessExit).not.toHaveBeenCalled()
  })

  it('includes the requested identity as a YAML entry keyed by slug', async () => {
    vi.mocked(loadLocalConfig).mockResolvedValue(mockLocalConfig())

    await runExport('alice')

    const printed = mockConsoleLog.mock.calls.map((c) => String(c[0])).join('\n')
    expect(printed).toContain('alice:')
    expect(printed).toContain('pk-alice')
  })

  it('exits with CONFIG_ERROR when no identities are configured', async () => {
    vi.mocked(loadLocalConfig).mockResolvedValue(null)

    await runExport()

    expect(mockConsoleError).toHaveBeenCalledWith(expect.stringContaining('No identities'))
    expect(mockProcessExit).toHaveBeenCalledWith(3)
  })

  it('exits with CONFIG_ERROR when the requested slug is not found', async () => {
    vi.mocked(loadLocalConfig).mockResolvedValue(mockLocalConfig())

    await runExport('nonexistent')

    expect(mockConsoleError).toHaveBeenCalledWith(expect.stringContaining('not found'))
    expect(mockProcessExit).toHaveBeenCalledWith(3)
  })
})
