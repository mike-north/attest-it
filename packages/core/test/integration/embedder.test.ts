/**
 * Sample-embedder integration test.
 *
 * This is the PRD's own required integration test: it drives the embeddable
 * surface exactly as an embedder (Toolsmith) would — list → seal → verify —
 * with zero terminal interaction. The identity here is backed by a filesystem
 * key, whose "unlock" is a no-op; a hardware backend would surface its own
 * unlock UX at the seal step and nowhere else.
 *
 * A runnable, human-facing counterpart lives at `examples/embedder/`.
 *
 * @see PRD R3 AC — "A sample embedder script performs list → seal → verify with
 *   zero terminal interaction besides the backend unlock."
 * @see Integration contract invariant 2 — one human interaction (the unlock).
 */

import { afterEach, describe, expect, it } from 'vitest'
import { listGates, seal, verifyOne } from '../../src/api/index.js'
import { createTestProject, type TestProject } from '../api/helpers.js'

let project: TestProject

afterEach(() => {
  project.cleanup()
})

describe('sample embedder: list → seal → verify', () => {
  it('completes the full cycle non-interactively', async () => {
    project = createTestProject()
    const opts = { baseDir: project.baseDir }

    // 1. Enumerate gates/artifacts to review.
    const listed = await listGates(opts)
    expect(listed.ok).toBe(true)
    if (!listed.ok) throw new Error('listGates failed')
    const gate = listed.gates[0]
    expect(gate?.gateId).toBe('tools')

    // Before sealing, the artifact is not attested.
    const before = await verifyOne(project.gatedFile, opts)
    expect(before.ok).toBe(false)

    // 2. Seal the artifact as the active identity (backend unlock happens here).
    const sealed = await seal(project.gatedFile, { identity: 'alice' }, opts)
    expect(sealed.ok).toBe(true)
    if (!sealed.ok) throw new Error('seal failed')
    expect(sealed.sealedBy).toBe('alice')

    // 3. Verify the now-sealed artifact.
    const after = await verifyOne(project.gatedFile, opts)
    expect(after.ok).toBe(true)
    if (!after.ok) throw new Error('verifyOne failed after sealing')
    expect(after.gateId).toBe('tools')
    expect(after.fingerprint).toBe(sealed.fingerprint)
  })
})
