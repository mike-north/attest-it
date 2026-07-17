/**
 * Tests for `attest-it seal`, focused on the `--json` non-interactive surface.
 *
 * @see PRD R3 — `--json` on every command; non-interactive throughout.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { AttestItConfig, Identity, LocalConfig, Seal } from '@attest-it/core'

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
    verifyGateSeal: vi.fn(),
    isEncryptedPrivateKeyPem: vi.fn(),
    createSeal: vi.fn(),
    KeyProviderRegistry: { create: vi.fn() },
  }
})

// node:fs/promises.readFile is used to read the resolved key file's PEM
// content before signing -- mocked so the encrypted-key passphrase tests
// don't need a real file on disk.
vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
}))

// @inquirer/prompts' password() -- used to prompt for an encrypted identity
// key's passphrase interactively (shared with `run`, issue #94).
vi.mock('@inquirer/prompts', () => ({
  password: vi.fn(),
}))

vi.mock('../src/utils/prompts.js', () => ({
  isInteractiveTTY: vi.fn(() => false),
}))

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
  verifyGateSeal,
  isEncryptedPrivateKeyPem,
  createSeal,
  KeyProviderRegistry,
} = await import('@attest-it/core')
const { readFile } = await import('node:fs/promises')
const { password } = await import('@inquirer/prompts')
const { isInteractiveTTY } = await import('../src/utils/prompts.js')
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

  // Regression: `seal` used to skip resealing whenever *any* seal existed for
  // a gate, checking only presence and never validity. That let a stale seal
  // (fingerprint changed, signature invalid, signer no longer authorized,
  // etc.) survive indefinitely without --force. `seal` must now run full
  // verification (verifyGateSeal) before deciding to skip.
  it('reseals when an existing seal is present but no longer valid (e.g. fingerprint changed)', async () => {
    const config = mockConfig()
    vi.mocked(loadSplitConfig).mockResolvedValue(config)
    vi.mocked(loadLocalConfigSync).mockReturnValue(mockLocalConfig('alice'))
    vi.mocked(getActiveIdentity).mockReturnValue(mockIdentity('alice'))
    const existingSeal = {
      gateId: 'test-gate',
      fingerprint: 'sha256:stale',
      timestamp: '2024-01-01T00:00:00.000Z',
      sealedBy: 'alice',
      signature: 'sig',
    }
    vi.mocked(readSealsSync).mockReturnValue({
      version: 1,
      seals: { 'test-gate': existingSeal },
    })
    vi.mocked(getGate).mockReturnValue(config.gates?.['test-gate'])
    vi.mocked(computeFingerprintSync).mockReturnValue({
      fingerprint: 'sha256:fresh',
      fileCount: 1,
      files: [],
    })
    vi.mocked(isAuthorizedSigner).mockReturnValue(true)
    // The existing seal's fingerprint no longer matches -- verification reports mismatch.
    vi.mocked(verifyGateSeal).mockReturnValue({
      gateId: 'test-gate',
      state: 'FINGERPRINT_MISMATCH',
      seal: existingSeal,
      message: 'Fingerprint changed since seal was created',
    })

    await runSeal(['test-gate'], { json: true, dryRun: true })

    // A dry run with a stale seal should report the gate as (would be) sealed,
    // not skipped -- proving the skip-on-existence bug is fixed.
    const printed = mockConsoleLog.mock.calls.map((c) => String(c[0])).join('\n')
    expect(printed).toContain('"sealed"')
    const parsed: { sealed: unknown[]; skipped: unknown[] } = JSON.parse(printed) as {
      sealed: unknown[]
      skipped: unknown[]
    }
    expect(parsed.sealed).toHaveLength(1)
    expect(parsed.skipped).toHaveLength(0)
  })

  it('skips resealing when the existing seal is still valid (no --force)', async () => {
    const config = mockConfig()
    vi.mocked(loadSplitConfig).mockResolvedValue(config)
    vi.mocked(loadLocalConfigSync).mockReturnValue(mockLocalConfig('alice'))
    vi.mocked(getActiveIdentity).mockReturnValue(mockIdentity('alice'))
    const existingSeal = {
      gateId: 'test-gate',
      fingerprint: 'sha256:fresh',
      timestamp: '2024-01-01T00:00:00.000Z',
      sealedBy: 'alice',
      signature: 'sig',
    }
    vi.mocked(readSealsSync).mockReturnValue({
      version: 1,
      seals: { 'test-gate': existingSeal },
    })
    vi.mocked(getGate).mockReturnValue(config.gates?.['test-gate'])
    vi.mocked(computeFingerprintSync).mockReturnValue({
      fingerprint: 'sha256:fresh',
      fileCount: 1,
      files: [],
    })
    vi.mocked(isAuthorizedSigner).mockReturnValue(true)
    vi.mocked(verifyGateSeal).mockReturnValue({
      gateId: 'test-gate',
      state: 'VALID',
      seal: existingSeal,
    })

    await runSeal(['test-gate'], { json: true })

    const printed = mockConsoleLog.mock.calls.map((c) => String(c[0])).join('\n')
    const parsed: { sealed: unknown[]; skipped: { reason: string }[] } = JSON.parse(printed) as {
      sealed: unknown[]
      skipped: { reason: string }[]
    }
    expect(parsed.sealed).toHaveLength(0)
    expect(parsed.skipped).toHaveLength(1)
    expect(parsed.skipped[0]?.reason).toContain('already has a valid seal')
    expect(writeSealsSync).not.toHaveBeenCalled()
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

// Regression coverage for issue #94: `seal` read a private key's raw PEM and
// signed with it directly, with no passphrase handling at all -- so a
// passphrase-encrypted file-backed key (created via `identity create
// --passphrase-stdin`) simply failed to sign. `run`'s seal-creation path
// already resolved this in #87; `seal` now shares that same
// non-interactive-safe resolution (env var -> interactive prompt -> fail
// fast) via `resolveKeyPassphrase`.
describe('seal — encrypted private key passphrase (issue #94)', () => {
  const PASSPHRASE_ENV = 'ATTEST_IT_KEY_PASSPHRASE'
  const originalEnvValue = process.env[PASSPHRASE_ENV]

  beforeEach(() => {
    vi.clearAllMocks()
    delete process.env[PASSPHRASE_ENV]
    vi.mocked(isInteractiveTTY).mockReturnValue(false)
  })

  afterEach(() => {
    vi.clearAllMocks()
    if (originalEnvValue === undefined) {
      delete process.env[PASSPHRASE_ENV]
    } else {
      process.env[PASSPHRASE_ENV] = originalEnvValue
    }
  })

  /** Wire up everything `processSingleGate` needs to reach the signing step. */
  function setupSigningMocks(): AttestItConfig {
    const config = mockConfig()
    vi.mocked(loadSplitConfig).mockResolvedValue(config)
    vi.mocked(loadLocalConfigSync).mockReturnValue(mockLocalConfig('alice'))
    vi.mocked(getActiveIdentity).mockReturnValue(mockIdentity('alice'))
    vi.mocked(readSealsSync).mockReturnValue({ version: 1, seals: {} })
    vi.mocked(getGate).mockReturnValue(config.gates?.['test-gate'])
    vi.mocked(computeFingerprintSync).mockReturnValue({
      fingerprint: 'sha256:abc',
      fileCount: 1,
      files: [],
    })
    vi.mocked(isAuthorizedSigner).mockReturnValue(true)
    vi.mocked(KeyProviderRegistry.create).mockReturnValue({
      getPrivateKey: vi.fn().mockResolvedValue({ keyPath: '/tmp/key.pem', cleanup: vi.fn() }),
      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- minimal test double
    } as unknown as ReturnType<typeof KeyProviderRegistry.create>)
    vi.mocked(readFile).mockResolvedValue(
      '-----BEGIN ENCRYPTED PRIVATE KEY-----\nfake\n-----END ENCRYPTED PRIVATE KEY-----\n',
    )
    return config
  }

  function fakeSeal(): Seal {
    return {
      gateId: 'test-gate',
      fingerprint: 'sha256:abc',
      timestamp: '2024-01-01T00:00:00.000Z',
      sealedBy: 'alice',
      signature: 'sig',
    }
  }

  it('resolves the passphrase from ATTEST_IT_KEY_PASSPHRASE and signs without prompting', async () => {
    setupSigningMocks()
    process.env[PASSPHRASE_ENV] = 'env-secret'
    vi.mocked(isEncryptedPrivateKeyPem).mockReturnValue(true)
    vi.mocked(createSeal).mockReturnValue(fakeSeal())

    await runSeal(['test-gate'], { json: true })

    expect(createSeal).toHaveBeenCalledWith(expect.objectContaining({ passphrase: 'env-secret' }))
    expect(password).not.toHaveBeenCalled()
    expect(mockProcessExit).toHaveBeenCalledWith(0)
  })

  it('does not resolve or pass a passphrase for an unencrypted key', async () => {
    setupSigningMocks()
    vi.mocked(isEncryptedPrivateKeyPem).mockReturnValue(false)
    vi.mocked(createSeal).mockReturnValue(fakeSeal())

    await runSeal(['test-gate'], { json: true })

    expect(createSeal).toHaveBeenCalledTimes(1)
    const [options] = vi.mocked(createSeal).mock.calls[0] ?? []
    expect(options).not.toHaveProperty('passphrase')
    expect(password).not.toHaveBeenCalled()
  })

  it(
    'fails fast (does not hang) when the key is encrypted, the env var is unset, ' +
      'and stdin is not a TTY',
    async () => {
      setupSigningMocks()
      vi.mocked(isEncryptedPrivateKeyPem).mockReturnValue(true)

      await runSeal(['test-gate'], { json: true })

      // Never invokes the prompt library, and never signs.
      expect(password).not.toHaveBeenCalled()
      expect(createSeal).not.toHaveBeenCalled()

      const printed = mockConsoleLog.mock.calls.map((c) => String(c[0])).join('\n')
      expect(printed).toContain('passphrase-encrypted')
      expect(printed).toContain(PASSPHRASE_ENV)
      // The failure is scoped to this gate (summary.failed), not a hang and
      // not CONFIG_ERROR -- it surfaces as FAILURE (1).
      expect(mockProcessExit).toHaveBeenCalledWith(1)
    },
  )

  it('prompts interactively for the passphrase when the env var is unset and stdin is a TTY', async () => {
    setupSigningMocks()
    vi.mocked(isInteractiveTTY).mockReturnValue(true)
    vi.mocked(isEncryptedPrivateKeyPem).mockReturnValue(true)
    vi.mocked(password).mockResolvedValue('prompted-secret')
    vi.mocked(createSeal).mockReturnValue(fakeSeal())

    await runSeal(['test-gate'], { json: true })

    expect(password).toHaveBeenCalledTimes(1)
    expect(createSeal).toHaveBeenCalledWith(
      expect.objectContaining({ passphrase: 'prompted-secret' }),
    )
  })
})
