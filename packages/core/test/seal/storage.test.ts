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
  readSealsFromDirSync,
  writeSealsToDirSync,
} from '../../src/seal/storage.js'
import { createSeal } from '../../src/seal/operations.js'
import { generateKeyPair } from '../../src/crypto/ed25519.js'
import type { Seal } from '../../src/seal/types.js'

function seal(gateId: string, sealedBy: string): Seal {
  const { privateKey } = generateKeyPair()
  return createSeal({ gateId, fingerprint: 'sha256:abc123', sealedBy, privateKey })
}

/** A per-file pattern-gate seal carrying an artifactPath. */
function patternSeal(gateId: string, artifactPath: string, sealedBy: string): Seal {
  return { ...seal(gateId, sealedBy), artifactPath }
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

describe('pattern-gate per-file seals (#69)', () => {
  let root: string

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'attest-pattern-'))
  })

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true })
  })

  it('stores two artifacts of the SAME gate as two coexisting files (artifact segment)', () => {
    const aPath = writeSealFileSync(root, patternSeal('tools', 'tools/a.sh', 'alice'))
    const bPath = writeSealFileSync(root, patternSeal('tools', 'tools/b.sh', 'alice'))

    expect(aPath).not.toBe(bPath)
    expect(fs.existsSync(aPath)).toBe(true)
    expect(fs.existsSync(bPath)).toBe(true)

    const stored = listStoredSealsSync(root)
    expect(stored).toHaveLength(2)
    const artifacts = stored.map((s) => s.seal.artifactPath).sort()
    expect(artifacts).toEqual(['tools/a.sh', 'tools/b.sh'])
    // artifactPath round-trips through serialize/parse.
    expect(stored.every((s) => s.seal.gateId === 'tools')).toBe(true)
  })

  it('CASE-INSENSITIVE FS: artifact paths differing ONLY in case get DISTINCT files', () => {
    // On a case-insensitive filesystem (e.g. macOS default), a naive slug would
    // collapse Foo.sh and foo.sh onto the same on-disk path and silently overwrite
    // one seal with the other. The collision-safe artifact segment must keep them
    // apart.
    const upperPath = writeSealFileSync(root, patternSeal('tools', 'tools/Foo.sh', 'alice'))
    const lowerPath = writeSealFileSync(root, patternSeal('tools', 'tools/foo.sh', 'alice'))

    expect(upperPath).not.toBe(lowerPath)
    // Both files must survive independently — writing the second did not clobber
    // the first even on a case-insensitive FS.
    const stored = listStoredSealsSync(root)
    expect(stored).toHaveLength(2)
    expect(stored.map((s) => s.seal.artifactPath).sort()).toEqual(['tools/Foo.sh', 'tools/foo.sh'])
  })

  it('aggregate read EXCLUDES per-file pattern seals (they are not one-per-gate)', () => {
    writeSealFileSync(root, patternSeal('tools', 'tools/a.sh', 'alice'))
    writeSealFileSync(root, patternSeal('tools', 'tools/b.sh', 'alice'))
    // A plain single-gate seal for a different gate DOES belong to the aggregate.
    writeSealFileSync(root, seal('single-gate', 'alice'))

    const aggregate = readSealsFromDirSync(root)
    expect(Object.keys(aggregate.seals)).toEqual(['single-gate'])
  })

  it('aggregate write does NOT prune per-file pattern seals (constraint: no silent loss)', () => {
    // Pattern seals exist for gate `tools`.
    const aPath = writeSealFileSync(root, patternSeal('tools', 'tools/a.sh', 'alice'))
    const bPath = writeSealFileSync(root, patternSeal('tools', 'tools/b.sh', 'alice'))

    // An aggregate write for an UNRELATED single gate must not delete them, even
    // though they are outside its desired one-per-gate set.
    writeSealsToDirSync(root, {
      version: 2,
      seals: { 'single-gate': seal('single-gate', 'alice') },
    })

    expect(fs.existsSync(aPath)).toBe(true)
    expect(fs.existsSync(bPath)).toBe(true)
    const stored = listStoredSealsSync(root)
    expect(stored.filter((s) => s.seal.artifactPath !== undefined)).toHaveLength(2)
  })
})
