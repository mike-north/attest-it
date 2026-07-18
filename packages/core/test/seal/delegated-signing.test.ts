/**
 * Integration tests for delegated-signing seal creation.
 *
 * Verifies that when a VaultKeeper SigningBackend-capable key provider is used,
 * seals are signed without the raw private key ever being written to disk, while
 * non-signing backends still work via the temp-file PEM fallback.
 *
 * @see https://github.com/mike-north/vaultkeeper (SigningBackend contract)
 * @see https://github.com/mike-north/attest-it/issues/76
 */

import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as ed25519 from '../../src/crypto/ed25519.js'
import { createSealWithProvider } from '../../src/seal/operations.js'
import { VaultKeyProvider } from '../../src/key-provider/vault-key-provider.js'
import {
  createMockBackend,
  createSigningMockBackend,
  spkiPemToRawBase64,
} from '../helpers/mock-backends.js'

// Wrap node:fs/promises so writes still hit disk (needed by the fallback path)
// while `writeFile` calls are observable — the ESM namespace cannot be spied
// directly, so a partial module mock is used instead.
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return { ...actual, writeFile: vi.fn(actual.writeFile) }
})

const GATE_ID = 'ci'
const FINGERPRINT = 'a'.repeat(64)
const SEALED_BY = 'alice'

/** Whether a written value looks like PEM private-key material. */
function isPemPrivateKey(value: unknown): boolean {
  const text = Buffer.isBuffer(value)
    ? value.toString('utf8')
    : typeof value === 'string'
      ? value
      : ''
  return text.includes('PRIVATE KEY')
}

/** Reconstruct the canonical string a seal was signed over. */
function canonicalFor(seal: { gateId: string; fingerprint: string; timestamp: string }): string {
  return `${seal.gateId}:${seal.fingerprint}:${seal.timestamp}`
}

/** Whether any writeFile call so far received PEM private-key content. */
function wrotePemToDisk(): boolean {
  return vi.mocked(fs.writeFile).mock.calls.some(([, data]) => isPemPrivateKey(data))
}

describe('createSealWithProvider — delegated signing', () => {
  afterEach(() => {
    vi.mocked(fs.writeFile).mockClear()
  })

  it('signs via the backend without writing raw private-key bytes to disk', async () => {
    const signing = createSigningMockBackend()
    const provider = new VaultKeyProvider({ backend: signing.backend, displayName: 'Signing' })

    // Enroll a delegated signing key (the provider uses generateSigningKey).
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'attest-it-delegated-'))
    const publicKeyPath = path.join(tmpDir, 'public.pem')
    let keyRef: string
    let rawPublicKeyBase64: string
    try {
      const gen = await provider.generateKeyPair({ publicKeyPath })
      keyRef = gen.privateKeyRef
      const { publicKeyPem } = await signing.getPublicKeyFn(keyRef)
      rawPublicKeyBase64 = spkiPemToRawBase64(publicKeyPem)
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true })
    }

    // Only inspect writes made during the signing operation itself.
    vi.mocked(fs.writeFile).mockClear()

    const seal = await createSealWithProvider({
      gateId: GATE_ID,
      fingerprint: FINGERPRINT,
      sealedBy: SEALED_BY,
      keyProvider: provider,
      keyRef,
    })

    // Delegated path was taken: the backend signed and no PEM touched disk.
    expect(signing.signWithKeyFn).toHaveBeenCalledOnce()
    expect(signing.retrieveFn).not.toHaveBeenCalled()
    expect(wrotePemToDisk()).toBe(false)

    // The delegated signature verifies against the enrolled public key.
    expect(ed25519.verify(canonicalFor(seal), seal.signature, rawPublicKeyBase64)).toBe(true)
    expect(seal.sealedBy).toBe(SEALED_BY)
  })

  it('delegated-path tamper: verify fails when the signed canonical string or signature is altered', async () => {
    const signing = createSigningMockBackend()
    const provider = new VaultKeyProvider({ backend: signing.backend, displayName: 'Signing' })

    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'attest-it-delegated-tamper-'))
    const publicKeyPath = path.join(tmpDir, 'public.pem')
    let keyRef: string
    let rawPublicKeyBase64: string
    try {
      const gen = await provider.generateKeyPair({ publicKeyPath })
      keyRef = gen.privateKeyRef
      const { publicKeyPem } = await signing.getPublicKeyFn(keyRef)
      rawPublicKeyBase64 = spkiPemToRawBase64(publicKeyPem)
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true })
    }

    const seal = await createSealWithProvider({
      gateId: GATE_ID,
      fingerprint: FINGERPRINT,
      sealedBy: SEALED_BY,
      keyProvider: provider,
      keyRef,
    })

    // Baseline: the untampered delegated signature verifies.
    const canonical = canonicalFor(seal)
    expect(ed25519.verify(canonical, seal.signature, rawPublicKeyBase64)).toBe(true)

    // Tamper 1: flip a byte in the signed canonical string (as if the gate's
    // fingerprint were swapped after signing) — verify must reject.
    const tamperedCanonical = `${seal.gateId}:${'b' + FINGERPRINT.slice(1)}:${seal.timestamp}`
    expect(tamperedCanonical).not.toBe(canonical)
    expect(ed25519.verify(tamperedCanonical, seal.signature, rawPublicKeyBase64)).toBe(false)

    // Tamper 2: flip a byte in the signature itself — verify must reject.
    const sigBytes = Buffer.from(seal.signature, 'base64')
    sigBytes[0] ^= 0xff
    const tamperedSignature = sigBytes.toString('base64')
    expect(tamperedSignature).not.toBe(seal.signature)
    expect(ed25519.verify(canonical, tamperedSignature, rawPublicKeyBase64)).toBe(false)
  })

  it('falls back to the temp-file PEM path for a non-signing backend', async () => {
    // Generate a real Ed25519 key and store its PEM as an ordinary secret.
    const { publicKey, privateKey } = ed25519.generateKeyPair()
    const plain = createMockBackend()
    const provider = new VaultKeyProvider({ backend: plain.backend, displayName: 'Plain' })
    await plain.backend.store('key-1', privateKey)

    // Delegated signing is unavailable for a plain SecretBackend.
    expect(provider.signDirectly).toBeUndefined()

    vi.mocked(fs.writeFile).mockClear()

    const seal = await createSealWithProvider({
      gateId: GATE_ID,
      fingerprint: FINGERPRINT,
      sealedBy: SEALED_BY,
      keyProvider: provider,
      keyRef: 'key-1',
    })

    // Fallback path retrieved the PEM and wrote it to a temp file — proving the
    // detector above would catch a raw-key disk write in the delegated case.
    expect(plain.retrieveFn).toHaveBeenCalledWith('key-1')
    expect(wrotePemToDisk()).toBe(true)

    // The fallback signature verifies against the stored key's public half.
    expect(ed25519.verify(canonicalFor(seal), seal.signature, publicKey)).toBe(true)
  })
})

describe('createSealWithProvider — fallback passphrase handling', () => {
  afterEach(() => {
    vi.mocked(fs.writeFile).mockClear()
  })

  it('does not resolve a passphrase for an unencrypted key', async () => {
    const { publicKey, privateKey } = ed25519.generateKeyPair()
    const plain = createMockBackend()
    const provider = new VaultKeyProvider({ backend: plain.backend, displayName: 'Plain' })
    await plain.backend.store('key-1', privateKey)

    const resolvePassphrase = vi.fn<() => Promise<string | undefined>>()

    const seal = await createSealWithProvider({
      gateId: GATE_ID,
      fingerprint: FINGERPRINT,
      sealedBy: SEALED_BY,
      keyProvider: provider,
      keyRef: 'key-1',
      resolvePassphrase,
    })

    expect(resolvePassphrase).not.toHaveBeenCalled()
    expect(ed25519.verify(canonicalFor(seal), seal.signature, publicKey)).toBe(true)
  })

  it('resolves and applies the passphrase for an encrypted key', async () => {
    const { publicKey, privateKey } = ed25519.generateKeyPair({ passphrase: 'correct horse' })
    const plain = createMockBackend()
    const provider = new VaultKeyProvider({ backend: plain.backend, displayName: 'Plain' })
    await plain.backend.store('key-1', privateKey)

    const resolvePassphrase = vi
      .fn<() => Promise<string | undefined>>()
      .mockResolvedValue('correct horse')

    const seal = await createSealWithProvider({
      gateId: GATE_ID,
      fingerprint: FINGERPRINT,
      sealedBy: SEALED_BY,
      keyProvider: provider,
      keyRef: 'key-1',
      resolvePassphrase,
    })

    expect(resolvePassphrase).toHaveBeenCalledOnce()
    expect(ed25519.verify(canonicalFor(seal), seal.signature, publicKey)).toBe(true)
  })

  it('propagates a passphrase-resolution failure (fail-closed, no seal)', async () => {
    const { privateKey } = ed25519.generateKeyPair({ passphrase: 'pw' })
    const plain = createMockBackend()
    const provider = new VaultKeyProvider({ backend: plain.backend, displayName: 'Plain' })
    await plain.backend.store('key-1', privateKey)

    const resolvePassphrase = vi
      .fn<() => Promise<string | undefined>>()
      .mockRejectedValue(new Error('no passphrase available'))

    await expect(
      createSealWithProvider({
        gateId: GATE_ID,
        fingerprint: FINGERPRINT,
        sealedBy: SEALED_BY,
        keyProvider: provider,
        keyRef: 'key-1',
        resolvePassphrase,
      }),
    ).rejects.toThrow('no passphrase available')
  })
})
