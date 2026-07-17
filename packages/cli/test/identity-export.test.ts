/**
 * Tests for `identity export`'s onboarding guidance text (issue #84).
 *
 * `export` used to tell users to add their key to a config file/key that
 * doesn't exist anywhere in the schema or docs: `.attest-it/team-config.yaml`
 * under a `members:` key. The real, only config file that holds team members
 * is `.attest-it/policy.yaml` under a `team:` key (see docs/getting-started.md
 * and docs/configuration.md). Following the tool's own old guidance produced
 * a file attest-it silently ignored. These tests drive the real `runExport`
 * against a real temp-directory home (via `setAttestItHomeDir`), matching the
 * pattern used by identity-create.test.ts, and assert the printed guidance
 * names the real file and key.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { setAttestItHomeDir, saveLocalConfig, type LocalConfig } from '@attest-it/core'
import { runExport } from '../src/commands/identity/export.js'
import { ExitCode } from '../src/utils/exit-codes.js'

const mockConsoleLog = vi.spyOn(console, 'log').mockImplementation(() => {
  // Intentionally empty
})
const mockConsoleError = vi.spyOn(console, 'error').mockImplementation(() => {
  // Intentionally empty
})
const mockProcessExit = vi.spyOn(process, 'exit').mockImplementation(() => {
  throw new Error('process.exit called')
})

/** Concatenate every console.log call into one string for substring assertions. */
function loggedOutput(): string {
  return mockConsoleLog.mock.calls.map((call) => String(call[0])).join('\n')
}

describe('identity export guidance (issue #84)', () => {
  let homeDir: string

  beforeEach(async () => {
    homeDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'attest-it-export-test-'))
    setAttestItHomeDir(homeDir)

    const config: LocalConfig = {
      version: 2,
      activeIdentity: 'alice',
      identities: {
        alice: {
          name: 'Alice Smith',
          email: 'alice@example.com',
          publicKey: 'EE23kZ8M6StmTLceSgc1DQvpqWYujRlE1vEwX2MOM0A=',
          privateKey: { type: 'file', id: 'unused-in-this-test' },
        },
      },
    }
    await saveLocalConfig(config)

    vi.clearAllMocks()
  })

  afterEach(async () => {
    setAttestItHomeDir(null)
    await fs.promises.rm(homeDir, { recursive: true, force: true })
  })

  it('should never mention the nonexistent team-config.yaml file', async () => {
    await runExport('alice')

    expect(loggedOutput()).not.toMatch(/team-config\.yaml/)
  })

  it('should never mention the nonexistent "members:" key', async () => {
    await runExport('alice')

    expect(loggedOutput()).not.toMatch(/members:/)
  })

  it('should tell the user to add the snippet to .attest-it/policy.yaml', async () => {
    await runExport('alice')

    expect(loggedOutput()).toMatch(/\.attest-it\/policy\.yaml/)
  })

  it('should tell the user the snippet belongs under the real "team:" key', async () => {
    await runExport('alice')

    expect(loggedOutput()).toMatch(/"team:"/)
  })

  it('should print a YAML snippet keyed by the identity slug with name and publicKey', async () => {
    await runExport('alice')

    const output = loggedOutput()
    expect(output).toContain('alice:')
    expect(output).toContain('name: Alice Smith')
    expect(output).toContain('publicKey: EE23kZ8M6StmTLceSgc1DQvpqWYujRlE1vEwX2MOM0A=')
  })

  it('should exit with CONFIG_ERROR when no identities are configured', async () => {
    setAttestItHomeDir(null)
    await fs.promises.rm(homeDir, { recursive: true, force: true })
    homeDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'attest-it-export-empty-'))
    setAttestItHomeDir(homeDir)

    await expect(runExport('alice')).rejects.toThrow('process.exit called')

    expect(mockProcessExit).toHaveBeenCalledWith(ExitCode.CONFIG_ERROR)
    expect(mockConsoleError).toHaveBeenCalledWith(
      expect.stringContaining('No identities configured'),
    )
  })

  it('should exit with CONFIG_ERROR when the requested slug does not exist', async () => {
    await expect(runExport('nonexistent-slug')).rejects.toThrow('process.exit called')

    expect(mockProcessExit).toHaveBeenCalledWith(ExitCode.CONFIG_ERROR)
    expect(mockConsoleError).toHaveBeenCalledWith(
      expect.stringContaining('Identity "nonexistent-slug" not found'),
    )
  })

  it('should default to the active identity when no slug is given', async () => {
    await runExport()

    expect(loggedOutput()).toContain('alice:')
  })
})
