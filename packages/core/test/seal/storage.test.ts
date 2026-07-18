/**
 * Tests for the file-per-seal storage layout: collision-safe slug derivation,
 * deterministic path scheme, and m-of-n coexistence (multiple signer files per
 * artifact).
 *
 * @see PRD R5  — deterministic, collision-safe seal paths for conflict-free PRs.
 * @see PRD R12 — the storage shape must not preclude m-of-n (multiple required
 *   signers per artifact).
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {
  slugifySegment,
  resolveSealsRoot,
  writeSealFileSync,
  listStoredSealsSync,
} from '../../src/seal/storage.js'
import { createSeal } from '../../src/seal/operations.js'
import { generateKeyPair } from '../../src/crypto/ed25519.js'
import type { Seal } from '../../src/seal/types.js'

function seal(gateId: string, sealedBy: string): Seal {
  const { privateKey } = generateKeyPair()
  return createSeal({ gateId, fingerprint: 'sha256:abc123', sealedBy, privateKey })
}

describe('slugifySegment collision-safety', () => {
  it('maps distinct artifact paths that collide under naive substitution to DISTINCT slugs', () => {
    // The exact AC example: naive `/`→`-` substitution would collapse both to
    // `tools-a-b.sh`; the collision-safe scheme must keep them apart.
    const a = slugifySegment('tools/a/b.sh')
    const b = slugifySegment('tools/a-b.sh')
    expect(a).not.toBe(b)
  })

  it('distinguishes inputs differing only in case (case-insensitive-FS safe)', () => {
    expect(slugifySegment('Foo')).not.toBe(slugifySegment('foo'))
  })

  it('is deterministic and produces a filesystem-safe single segment', () => {
    const s = slugifySegment('tools/a/b.sh')
    expect(s).toBe(slugifySegment('tools/a/b.sh'))
    // No path separators or characters that would escape the segment.
    expect(s).not.toContain('/')
    expect(s).not.toContain('\\')
    expect(s).toMatch(/^[A-Za-z0-9._-]+$/)
  })

  it('never yields "." or ".." (no path traversal) even for dot inputs', () => {
    expect(slugifySegment('..')).not.toBe('..')
    expect(slugifySegment('.')).not.toBe('.')
    expect(slugifySegment('../../etc/passwd')).not.toContain('/')
  })

  it('is injective across a batch of adversarial near-collisions', () => {
    const inputs = [
      'a/b',
      'a-b',
      'a_b',
      'a.b',
      'a b',
      'A/B',
      'a//b',
      'tools/a/b.sh',
      'tools/a-b.sh',
      'tools-a-b.sh',
      '',
      '-',
      '__root__',
    ]
    const slugs = inputs.map(slugifySegment)
    expect(new Set(slugs).size).toBe(inputs.length)
  })
})

describe('resolveSealsRoot', () => {
  it('defaults to .attest-it/seals when no override is given', () => {
    expect(resolveSealsRoot('/repo')).toBe(path.join('/repo', '.attest-it', 'seals'))
  })

  it('normalizes a legacy monolithic file path to its sibling directory', () => {
    expect(resolveSealsRoot('/repo', '.attest-it/seals.json')).toBe(
      path.join('/repo', '.attest-it', 'seals'),
    )
    expect(resolveSealsRoot('/repo', '.attest-it/seals.yaml')).toBe(
      path.join('/repo', '.attest-it', 'seals'),
    )
  })

  it('uses a directory-shaped override as-is', () => {
    expect(resolveSealsRoot('/repo', '.attest-it/seals/')).toBe(
      path.join('/repo', '.attest-it', 'seals'),
    )
  })
})

describe('m-of-n coexistence (PRD R12 not precluded)', () => {
  let root: string

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'attest-mofn-'))
  })

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true })
  })

  it('stores two signers of the SAME gate/artifact as two coexisting files', () => {
    const aliceSeal = seal('tools', 'alice')
    const bobSeal = seal('tools', 'bob')

    const aPath = writeSealFileSync(root, aliceSeal)
    const bPath = writeSealFileSync(root, bobSeal)

    // Two distinct files, neither overwriting the other.
    expect(aPath).not.toBe(bPath)
    expect(fs.existsSync(aPath)).toBe(true)
    expect(fs.existsSync(bPath)).toBe(true)

    const stored = listStoredSealsSync(root)
    expect(stored).toHaveLength(2)
    const signers = stored.map((s) => s.seal.sealedBy).sort()
    expect(signers).toEqual(['alice', 'bob'])
    // Both are the same gate/artifact.
    expect(stored.every((s) => s.seal.gateId === 'tools')).toBe(true)
  })

  it('writing a second signer does not disturb the first signer file', () => {
    const aliceSeal = seal('tools', 'alice')
    const aPath = writeSealFileSync(root, aliceSeal)
    const before = fs.readFileSync(aPath, 'utf8')

    writeSealFileSync(root, seal('tools', 'bob'))

    expect(fs.readFileSync(aPath, 'utf8')).toBe(before)
  })
})
