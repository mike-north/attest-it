/**
 * Tests for `attest-it seal`, focused on the `--json` non-interactive surface.
 *
 * @see PRD R3 — `--json` on every command; non-interactive throughout.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { AttestItConfig, Identity, LocalConfig } from '@attest-it/core'

vi.mock('@attest-it/core', async () => {
  const actual = await vi.importActual<typeof import('@attest-it/core')>('@attest-it/core')
  return {
    ...actual,
    loadSplitConfig: vi.fn(),
    loadLocalConfigSync: vi.fn(),
    getActiveIdentity: vi.fn(),
    computeFingerprintSync: vi.fn(),
    isAuthorizedSigner: vi.fn(),
    getGate: vi.fn(),
    readSealsSync: vi.fn(),
    writeSealsSync: vi.fn(),
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

const {
  loadSplitConfig,
  loadLocalConfigSync,
  getActiveIdentity,
  computeFingerprintSync,
  isAuthorizedSigner,
  getGate,
  readSealsSync,
  writeSealsSync,
} = await import('@attest-it/core')
const { runSeal } = await import('../src/commands/seal.js')

function mockConfig(): AttestItConfig {
  return {
    version: 1,
    settings: {
      maxAgeDays: 30,
      publicKeyPath: '.attest-it/pubkey.pem',
      attestationsPath: '.attest-it/attestations.json',
      sealsPath: '.attest-it/seals.json',
    },
    team: { alice: { name: 'Alice', publicKey: 'pk' } },
    gates: {
      'test-gate': {
        name: 'Test Gate',
        description: 'desc',
        authorizedSigners: ['alice'],
        fingerprint: { paths: ['src/**/*.ts'] },
        maxAge: '30d',
      },
    },
    suites: {},
  }
}

function mockLocalConfig(activeIdentity: string): LocalConfig {
  return {
    version: 1,
    activeIdentity,
    identities: {
      [activeIdentity]: {
        name: activeIdentity,
        publicKey: 'pk',
        privateKey: { type: 'file', path: '/tmp/key.pem' },
      },
    },
  }
}

function mockIdentity(name: string): Identity {
  return { name, publicKey: 'pk', privateKey: { type: 'file', path: '/tmp/key.pem' } }
}

describe('seal --json', () => {
  beforeEach(() => vi.clearAllMocks())
  afterEach(() => vi.clearAllMocks())

  it('reports an unauthorized identity as unauthorized-signer and writes no seal', async () => {
    const config = mockConfig()
    vi.mocked(loadSplitConfig).mockResolvedValue(config)
    vi.mocked(loadLocalConfigSync).mockReturnValue(mockLocalConfig('mallory'))
    vi.mocked(getActiveIdentity).mockReturnValue(mockIdentity('mallory'))
    vi.mocked(readSealsSync).mockReturnValue({ version: 1, seals: {} })
    vi.mocked(getGate).mockReturnValue(config.gates?.['test-gate'])
    vi.mocked(computeFingerprintSync).mockReturnValue({
      fingerprint: 'sha256:abc',
      fileCount: 1,
      files: [],
    })
    // mallory is not an authorized signer.
    vi.mocked(isAuthorizedSigner).mockReturnValue(false)

    await runSeal(['test-gate'], { json: true })

    // Structured JSON was emitted with the taxonomy class and schema version.
    const printed = mockConsoleLog.mock.calls.map((c) => String(c[0])).join('\n')
    expect(printed).toContain('"schemaVersion"')
    expect(printed).toContain('unauthorized-signer')
    // No seal file was written.
    expect(writeSealsSync).not.toHaveBeenCalled()
    // Skips (but no failures) exit successfully.
    expect(mockProcessExit).toHaveBeenCalledWith(0)
  })

  it('emits a structured error object (not a bare line) on config failure', async () => {
    vi.mocked(loadSplitConfig).mockRejectedValue(new Error('policy.yaml not found'))

    await runSeal([], { json: true })

    const printed = mockConsoleLog.mock.calls.map((c) => String(c[0])).join('\n')
    expect(printed).toContain('"ok": false')
    expect(printed).toContain('policy.yaml not found')
    // The human error() path must not be used on the --json surface.
    expect(mockConsoleError).not.toHaveBeenCalled()
    expect(mockProcessExit).toHaveBeenCalledWith(3)
  })
})
