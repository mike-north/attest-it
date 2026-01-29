import type {
  VerifyResult,
  SuiteVerificationResult,
  AttestItConfig,
  SealVerificationResult,
  SealsFile,
  Seal,
} from '@attest-it/core'

/**
 * Creates a mock VerifyResult with sensible defaults (legacy)
 */
export function createMockVerifyResult(overrides: Partial<VerifyResult> = {}): VerifyResult {
  return {
    success: true,
    signatureValid: true,
    suites: [],
    errors: [],
    ...overrides,
  }
}

/**
 * Creates a mock SuiteVerificationResult with sensible defaults (legacy)
 */
export function createMockSuiteStatus(
  overrides: Partial<SuiteVerificationResult> = {},
): SuiteVerificationResult {
  const base: SuiteVerificationResult = {
    suite: 'test-suite',
    status: 'VALID',
    fingerprint: 'sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    age: 5,
  }

  return {
    ...base,
    ...overrides,
  }
}

/**
 * Creates a mock SealVerificationResult with sensible defaults
 */
export function createMockSealResult(
  overrides: Partial<SealVerificationResult> = {},
): SealVerificationResult {
  const base: SealVerificationResult = {
    gateId: 'test-gate',
    state: 'VALID',
    seal: createMockSeal(),
  }

  return {
    ...base,
    ...overrides,
  }
}

/**
 * Creates a mock Seal with sensible defaults
 */
export function createMockSeal(overrides: Partial<Seal> = {}): Seal {
  return {
    gateId: 'test-gate',
    fingerprint: 'sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    timestamp: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(), // 5 days ago
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
      algorithm: 'ed25519',
    },
    gates: {
      'test-gate': {
        name: 'Test Gate',
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
