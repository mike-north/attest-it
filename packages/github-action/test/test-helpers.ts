import type { AttestItConfig, SealVerificationResult, SealsFile, Seal } from '@attest-it/core'

/**
 * Fixed reference "now" for deterministic seal-age assertions.
 * Tests that exercise age-dependent logic (e.g. strict-mode expiry warnings)
 * should pair this with `vi.useFakeTimers()` / `vi.setSystemTime(MOCK_NOW)` so
 * that `Date.now()` inside the code under test matches this reference point.
 */
export const MOCK_NOW = new Date('2026-01-15T00:00:00.000Z')

/**
 * Overrides for {@link createMockSealResult}.
 *
 * `seal` is widened to `Seal | undefined` (rather than inheriting
 * `SealVerificationResult`'s `seal?: Seal`) so callers can explicitly clear
 * the default seal to model a `MISSING` result, which under
 * `exactOptionalPropertyTypes` is distinct from omitting the property.
 */
type SealResultOverrides = Partial<Omit<SealVerificationResult, 'seal'>> & {
  seal?: Seal | undefined
}

/**
 * Creates a mock SealVerificationResult with sensible defaults
 */
export function createMockSealResult(overrides: SealResultOverrides = {}): SealVerificationResult {
  const { seal: sealOverride, ...rest } = overrides
  const base: SealVerificationResult = {
    gateId: 'test-gate',
    state: 'VALID',
    seal: createMockSeal(),
  }

  const merged: SealVerificationResult = { ...base, ...rest }

  // An explicit `seal: undefined` override models a MISSING result (no seal
  // exists yet); drop the key entirely rather than keeping `seal: undefined`,
  // which `exactOptionalPropertyTypes` treats differently from an absent key.
  if ('seal' in overrides) {
    if (sealOverride === undefined) {
      delete merged.seal
    } else {
      merged.seal = sealOverride
    }
  }

  return merged
}

/**
 * Creates a mock Seal with sensible defaults
 */
export function createMockSeal(overrides: Partial<Seal> = {}): Seal {
  return {
    gateId: 'test-gate',
    fingerprint: 'sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    // 5 days before the fixed reference point (see MOCK_NOW)
    timestamp: new Date(MOCK_NOW.getTime() - 5 * 24 * 60 * 60 * 1000).toISOString(),
    sealedBy: 'test-user',
    signature: 'base64signature',
    ...overrides,
  }
}

/**
 * Creates a mock SealsFile with sensible defaults
 */
export function createMockSealsFile(overrides: Partial<SealsFile> = {}): SealsFile {
  return {
    version: 1,
    seals: {},
    ...overrides,
  }
}

/**
 * Creates a mock AttestItConfig with sensible defaults
 */
export function createMockConfig(overrides: Partial<AttestItConfig> = {}): AttestItConfig {
  return {
    version: 1,
    settings: {
      maxAgeDays: 30,
      publicKeyPath: '.attest-it/public.pem',
      attestationsPath: '.attest-it/attestations.json',
      sealsPath: '.attest-it/seals.json',
    },
    gates: {
      'test-gate': {
        name: 'Test Gate',
        description: 'Test gate for verification',
        authorizedSigners: ['test-user'],
        fingerprint: {
          paths: ['packages/core'],
        },
        maxAge: '30d',
      },
    },
    team: {
      'test-user': {
        name: 'Test User',
        publicKey: 'testPublicKey123',
        publicKeyAlgorithm: 'ed25519',
      },
    },
    suites: {
      'test-suite': {
        description: 'Test suite',
        gate: 'test-gate',
      },
    },
    ...overrides,
  }
}
