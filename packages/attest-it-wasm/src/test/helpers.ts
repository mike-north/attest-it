/**
 * Shared test utilities for @attest-it/wasm integration tests.
 *
 * Provides key generation, canonical string construction, config builders,
 * and seal JSON builders used across test cases.
 */

import { generateKeyPairSync, randomUUID, sign } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

// ---------------------------------------------------------------------------
// Ed25519 key generation
// ---------------------------------------------------------------------------

export interface Ed25519KeyPair {
  /** Raw 32-byte public key encoded as base64. */
  publicKeyBase64: string
  /** Node.js KeyObject for signing. */
  privateKey: import('node:crypto').KeyObject
}

/**
 * Generate an Ed25519 key pair and extract the raw 32-byte public key
 * in base64 format (as expected by the attest-it config schema).
 */
export function generateEd25519KeyPair(): Ed25519KeyPair {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  // SPKI DER encoding: last 32 bytes are the raw public key
  const spkiDer = publicKey.export({ type: 'spki', format: 'der' })
  const rawPubKey = spkiDer.subarray(spkiDer.length - 32)
  const publicKeyBase64 = Buffer.from(rawPubKey).toString('base64')
  return { publicKeyBase64, privateKey }
}

/**
 * Sign the canonical seal string:
 *   `"{gateId}:{fingerprint}:{timestamp}"`
 *
 * Returns base64-encoded signature.
 */
export function signSealCanonical(
  gateId: string,
  fingerprint: string,
  timestamp: string,
  privateKey: import('node:crypto').KeyObject,
): string {
  const canonical = `${gateId}:${fingerprint}:${timestamp}`
  const sig = sign(null, Buffer.from(canonical), privateKey)
  return sig.toString('base64')
}

// ---------------------------------------------------------------------------
// Fixed test timestamps
// ---------------------------------------------------------------------------

/** A fixed "present" timestamp used for seal creation in tests. */
export const SEAL_TIMESTAMP = '2024-01-15T10:30:00.000Z'

/** Milliseconds since epoch for SEAL_TIMESTAMP (used as `nowMs` in verify calls). */
export const SEAL_TIMESTAMP_MS = new Date(SEAL_TIMESTAMP).getTime()

/**
 * A `nowMs` value that is 1 hour after SEAL_TIMESTAMP — seal is recent,
 * should not be stale for gates with maxAge >= 1 day.
 */
export const NOW_MS_FRESH = SEAL_TIMESTAMP_MS + 60 * 60 * 1000

/**
 * A `nowMs` value that is 60 days after SEAL_TIMESTAMP — seal is stale
 * for gates with maxAge = 30d.
 */
export const NOW_MS_STALE = SEAL_TIMESTAMP_MS + 60 * 24 * 60 * 60 * 1000

// ---------------------------------------------------------------------------
// Config JSON builders
// ---------------------------------------------------------------------------

export interface BuildPolicyConfigOptions {
  gateId?: string
  gateName?: string
  gateDescription?: string
  fingerprintPaths?: string[]
  authorizedSigners?: string[]
  maxAge?: string
  teamMembers?: Record<string, { name: string; publicKey: string }>
}

/**
 * Build a minimal valid policy config JSON string.
 */
export function buildPolicyConfigJson(opts: BuildPolicyConfigOptions = {}): string {
  const gateId = opts.gateId ?? 'test-gate'
  const teamMembers = opts.teamMembers ?? {}
  const authorizedSigners = opts.authorizedSigners ?? Object.keys(teamMembers)

  const policy = {
    version: 1,
    gates: {
      [gateId]: {
        name: opts.gateName ?? 'Test Gate',
        description: opts.gateDescription ?? 'A gate for testing',
        authorizedSigners,
        fingerprint: {
          paths: opts.fingerprintPaths ?? ['**/*.ts'],
        },
        maxAge: opts.maxAge ?? '30d',
      },
    },
    team: teamMembers,
  }
  return JSON.stringify(policy)
}

export interface BuildOperationalConfigOptions {
  gateId?: string
  suiteId?: string
  command?: string
}

/**
 * Build a minimal valid operational config JSON string.
 */
export function buildOperationalConfigJson(opts: BuildOperationalConfigOptions = {}): string {
  const suiteId = opts.suiteId ?? 'test-suite'
  const gateId = opts.gateId ?? 'test-gate'

  const operational = {
    version: 1,
    suites: {
      [suiteId]: {
        gate: gateId,
        command: opts.command ?? 'pnpm test',
      },
    },
  }
  return JSON.stringify(operational)
}

export interface BuildMergedConfigOptions extends BuildPolicyConfigOptions {
  suiteId?: string
  command?: string
}

/**
 * Build a merged (runtime) AttestItConfig JSON string.
 *
 * This is the format expected by verifyGateSeal / verifyAllSeals /
 * isAuthorizedSigner. It includes version, settings, team, gates, and suites.
 */
export function buildMergedConfigJson(opts: BuildMergedConfigOptions = {}): string {
  const gateId = opts.gateId ?? 'test-gate'
  const suiteId = opts.suiteId ?? 'test-suite'
  const teamMembers = opts.teamMembers ?? {}
  const authorizedSigners = opts.authorizedSigners ?? Object.keys(teamMembers)

  const merged = {
    version: 1,
    settings: {
      maxAgeDays: 30,
      publicKeyPath: '.attest-it/pubkey.pem',
      attestationsPath: '.attest-it/attestations.json',
      sealsPath: '.attest-it/seals.json',
    },
    team: teamMembers,
    gates: {
      [gateId]: {
        name: opts.gateName ?? 'Test Gate',
        description: opts.gateDescription ?? 'A gate for testing',
        authorizedSigners,
        fingerprint: {
          paths: opts.fingerprintPaths ?? ['**/*.ts'],
        },
        maxAge: opts.maxAge ?? '30d',
      },
    },
    suites: {
      [suiteId]: {
        gate: gateId,
        command: opts.command ?? 'pnpm test',
      },
    },
  }
  return JSON.stringify(merged)
}

// ---------------------------------------------------------------------------
// Seal JSON builders
// ---------------------------------------------------------------------------

export interface SealEntry {
  gateId: string
  fingerprint: string
  timestamp: string
  sealedBy: string
  signature: string
}

/**
 * Build a seals file JSON string with the given seals.
 */
export function buildSealsJson(seals: Record<string, SealEntry>): string {
  return JSON.stringify({ version: 1, seals })
}

/**
 * Build an empty seals file JSON string (no seals present).
 */
export function buildEmptySealsJson(): string {
  return JSON.stringify({ version: 1, seals: {} })
}

// ---------------------------------------------------------------------------
// Temp directory helper
// ---------------------------------------------------------------------------

/**
 * Create a temporary directory with the given files, return its path.
 * Caller is responsible for cleanup (use try/finally with rmTempDir).
 */
export async function createTempDir(files: Record<string, string>): Promise<{ dir: string }> {
  const dir = join(tmpdir(), `attest-it-wasm-test-${randomUUID()}`)
  await mkdir(dir, { recursive: true })

  for (const [relativePath, content] of Object.entries(files)) {
    const absolutePath = join(dir, relativePath)
    await mkdir(dirname(absolutePath), { recursive: true })
    await writeFile(absolutePath, content, 'utf8')
  }

  return { dir }
}
