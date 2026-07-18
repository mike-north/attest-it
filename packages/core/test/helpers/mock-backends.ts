/**
 * Shared mock VaultKeeper backends for tests.
 *
 * @see https://github.com/mike-north/vaultkeeper (SecretBackend / SigningBackend / PresenceCapableBackend)
 */

import * as nodeCrypto from 'node:crypto'
import { vi } from 'vitest'
import { SigningKeyNotFoundError } from 'vaultkeeper'
import type {
  BackendCapabilities,
  SecretBackend,
  SigningAlgorithm,
  SigningBackend,
  SigningPublicKey,
} from 'vaultkeeper'

/**
 * Create a mock SecretBackend, returning both the backend and individual mock
 * function references for assertion.
 */
export function createMockBackend(overrides: Partial<SecretBackend> = {}) {
  const secretStore = new Map<string, string>()

  const isAvailableFn = vi.fn<() => Promise<boolean>>().mockResolvedValue(true)
  const storeFn = vi.fn<(id: string, secret: string) => Promise<void>>((id, secret) => {
    secretStore.set(id, secret)
    return Promise.resolve()
  })
  const retrieveFn = vi.fn<(id: string) => Promise<string>>((id) => {
    const val = secretStore.get(id)
    if (val === undefined) {
      return Promise.reject(new Error(`Secret not found: ${id}`))
    }
    return Promise.resolve(val)
  })
  const deleteFn = vi.fn<(id: string) => Promise<void>>((id) => {
    if (!secretStore.has(id)) {
      return Promise.reject(new Error(`Secret not found: ${id}`))
    }
    secretStore.delete(id)
    return Promise.resolve()
  })
  const existsFn = vi.fn<(id: string) => Promise<boolean>>((id) =>
    Promise.resolve(secretStore.has(id)),
  )

  const backend: SecretBackend = {
    type: 'mock',
    displayName: 'Mock Backend',
    isAvailable: isAvailableFn,
    store: storeFn,
    retrieve: retrieveFn,
    delete: deleteFn,
    exists: existsFn,
    ...overrides,
  }

  return { backend, secretStore, isAvailableFn, storeFn, retrieveFn, deleteFn, existsFn }
}

/**
 * Create a mock VaultKeeper SigningBackend that holds real Ed25519 signing keys
 * in memory, mirroring the file backend's contract: signing keys live in a
 * namespace separate from ordinary secrets, and the private key never leaves the
 * backend (only signatures and the public half are exposed).
 *
 * @param capabilities - When provided, the backend also implements
 *   PresenceCapableBackend and reports these capabilities.
 */
const SUPPORTED_SIGNING_ALGORITHMS: readonly SigningAlgorithm[] = ['EdDSA']

export function createSigningMockBackend(capabilities?: Partial<BackendCapabilities>) {
  const base = createMockBackend()
  const signingKeys = new Map<string, nodeCrypto.KeyObject>()

  const generateSigningKeyFn = vi.fn<(id: string, algorithm: SigningAlgorithm) => Promise<void>>(
    (id, algorithm) => {
      if (!SUPPORTED_SIGNING_ALGORITHMS.includes(algorithm)) {
        return Promise.reject(new Error(`Unsupported signing algorithm '${algorithm}'`))
      }
      if (signingKeys.has(id)) {
        return Promise.reject(new Error(`Signing key already exists: ${id}`))
      }
      const { privateKey } = nodeCrypto.generateKeyPairSync('ed25519')
      signingKeys.set(id, privateKey)
      return Promise.resolve()
    },
  )

  const getPublicKeyFn = vi.fn<(id: string) => Promise<SigningPublicKey>>((id) => {
    const priv = signingKeys.get(id)
    if (!priv) {
      return Promise.reject(new SigningKeyNotFoundError(`Signing key not found: ${id}`, id))
    }
    const pub = nodeCrypto.createPublicKey(priv)
    const publicKeyPem = pub.export({ type: 'spki', format: 'pem' }).toString()
    const der = pub.export({ type: 'spki', format: 'der' })
    const kid = nodeCrypto.createHash('sha256').update(der).digest('base64url')
    return Promise.resolve({ publicKeyPem, algorithm: 'EdDSA', kid })
  })

  const signWithKeyFn = vi.fn<(id: string, data: Buffer) => Promise<Buffer>>((id, data) => {
    const priv = signingKeys.get(id)
    if (!priv) {
      return Promise.reject(new SigningKeyNotFoundError(`Signing key not found: ${id}`, id))
    }
    return Promise.resolve(nodeCrypto.sign(null, data, priv))
  })

  const backend: SigningBackend = {
    ...base.backend,
    generateSigningKey: generateSigningKeyFn,
    getPublicKey: getPublicKeyFn,
    signWithKey: signWithKeyFn,
    ...(capabilities && {
      getCapabilities: (): Promise<BackendCapabilities> =>
        Promise.resolve({ presencePerUse: false, ...capabilities }),
    }),
  }

  return {
    ...base,
    backend,
    signingKeys,
    generateSigningKeyFn,
    getPublicKeyFn,
    signWithKeyFn,
  }
}

/**
 * Recover attest-it's compact public-key form (base64 of the raw 32-byte Ed25519
 * key) from an SPKI PEM, for use in seal verification assertions.
 */
export function spkiPemToRawBase64(publicKeyPem: string): string {
  return Buffer.from(
    nodeCrypto.createPublicKey(publicKeyPem).export({ type: 'spki', format: 'der' }),
  )
    .subarray(12)
    .toString('base64')
}
