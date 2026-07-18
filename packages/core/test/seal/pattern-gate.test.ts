/**
 * End-to-end tests for pattern gates (#69): one gate definition under which each
 * matching file is fingerprinted and sealed INDEPENDENTLY.
 *
 * These drive the genuine embeddable-API path — `seal` → `status` → `verifyOne`
 * against a real on-disk split config and a filesystem-backed identity — rather
 * than mocks, so they exercise the same load/fingerprint/seal/verify contract a
 * consumer (e.g. Toolsmith) uses. Each test maps to a PRD R2 acceptance
 * criterion; assertions are written by hand from those criteria, not snapshotted.
 *
 * @see Issue #69 acceptance criteria (PRD R2)
 */

import { afterEach, describe, expect, it } from 'vitest'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { seal, status, verifyOne, fingerprint } from '../../src/api/index.js'
import { listStoredSealsSync, resolveSealsRoot } from '../../src/seal/storage.js'
import { createTestProject, type TestProject } from '../api/helpers.js'

let project: TestProject

afterEach(() => {
  project.cleanup()
})

/**
 * Scaffold a pattern gate `tools` over `tools/*.sh` with the given files.
 */
function patternProject(files: Record<string, string>): TestProject {
  return createTestProject({ kind: 'pattern', gatePaths: ['tools/*.sh'], files })
}

/** Find the status/verify result for a specific artifact path. */
function resultFor(results: { path?: string }[], p: string): { path?: string } | undefined {
  return results.find((r) => r.path === p)
}

describe('pattern gate: independent per-file seals (PRD R2)', () => {
  it('sealing one file leaves its sibling unsealed (seal → status → verify)', async () => {
    project = patternProject({
      'tools/a.sh': '#!/bin/sh\necho a\n',
      'tools/b.sh': '#!/bin/sh\necho b\n',
    })

    // Seal ONLY tools/a.sh.
    const sealed = await seal('tools/a.sh', { identity: 'alice' }, { baseDir: project.baseDir })
    expect(sealed.ok).toBe(true)

    // The seal is a per-file seal: it carries artifactPath and lives under an
    // artifact segment, coexisting rather than collapsing to one-per-gate.
    const stored = listStoredSealsSync(resolveSealsRoot(project.baseDir))
    expect(stored).toHaveLength(1)
    expect(stored[0]?.seal.artifactPath).toBe('tools/a.sh')

    // status reports a.sh VALID and b.sh unsealed — independence proven.
    const st = await status(undefined, { baseDir: project.baseDir })
    expect(st.ok).toBe(true)
    if (!st.ok) return
    const a = resultFor(st.results, 'tools/a.sh')
    const b = resultFor(st.results, 'tools/b.sh')
    expect(a?.ok).toBe(true)
    expect(b?.ok).toBe(false)
    if (b && !b.ok) expect(b.failureClass).toBe('unsealed')

    // verifyOne agrees for each file individually.
    const va = await verifyOne('tools/a.sh', { baseDir: project.baseDir })
    const vb = await verifyOne('tools/b.sh', { baseDir: project.baseDir })
    expect(va.ok).toBe(true)
    expect(vb.ok).toBe(false)
    if (!vb.ok) expect(vb.failureClass).toBe('unsealed')
  })

  it('changing one byte of a sealed file flips ONLY that file to invalid', async () => {
    project = patternProject({
      'tools/a.sh': '#!/bin/sh\necho a\n',
      'tools/b.sh': '#!/bin/sh\necho b\n',
    })

    await seal('tools/a.sh', { identity: 'alice' }, { baseDir: project.baseDir })
    await seal('tools/b.sh', { identity: 'alice' }, { baseDir: project.baseDir })

    // Both valid before the edit.
    expect((await verifyOne('tools/a.sh', { baseDir: project.baseDir })).ok).toBe(true)
    expect((await verifyOne('tools/b.sh', { baseDir: project.baseDir })).ok).toBe(true)

    // Flip one byte of a.sh only.
    const aPath = join(project.baseDir, 'tools/a.sh')
    writeFileSync(aPath, readFileSync(aPath, 'utf8').replace('echo a', 'echo A'), 'utf8')

    const va = await verifyOne('tools/a.sh', { baseDir: project.baseDir })
    const vb = await verifyOne('tools/b.sh', { baseDir: project.baseDir })
    expect(va.ok).toBe(false)
    if (!va.ok) expect(va.failureClass).toBe('fingerprint-mismatch')
    // The sibling is entirely unaffected.
    expect(vb.ok).toBe(true)
  })

  it('a new file matching the pattern shows as unsealed with ZERO config change', async () => {
    project = patternProject({
      'tools/a.sh': '#!/bin/sh\necho a\n',
      'tools/b.sh': '#!/bin/sh\necho b\n',
    })

    await seal('tools/a.sh', { identity: 'alice' }, { baseDir: project.baseDir })
    await seal('tools/b.sh', { identity: 'alice' }, { baseDir: project.baseDir })

    // Add a third matching file — no policy.yaml / config.yaml edit.
    writeFileSync(join(project.baseDir, 'tools/c.sh'), '#!/bin/sh\necho c\n', 'utf8')

    const st = await status(undefined, { baseDir: project.baseDir })
    expect(st.ok).toBe(true)
    if (!st.ok) return
    expect(st.results.map((r) => r.path)).toEqual(['tools/a.sh', 'tools/b.sh', 'tools/c.sh'])
    const c = resultFor(st.results, 'tools/c.sh')
    expect(c?.ok).toBe(false)
    if (c && !c.ok) expect(c.failureClass).toBe('unsealed')
    // Existing seals stay valid.
    expect(resultFor(st.results, 'tools/a.sh')?.ok).toBe(true)
    expect(resultFor(st.results, 'tools/b.sh')?.ok).toBe(true)
  })

  it('status --json ordering is deterministic across repeated runs (PRD Q5)', async () => {
    project = patternProject({
      'tools/zebra.sh': '#!/bin/sh\n',
      'tools/alpha.sh': '#!/bin/sh\n',
      'tools/mike.sh': '#!/bin/sh\n',
    })

    const first = await status(undefined, { baseDir: project.baseDir })
    const second = await status(undefined, { baseDir: project.baseDir })
    expect(first.ok && second.ok).toBe(true)
    if (!first.ok || !second.ok) return

    const order1 = first.results.map((r) => r.path)
    const order2 = second.results.map((r) => r.path)
    // Stable lexicographic-by-path ordering, identical across runs.
    expect(order1).toEqual(['tools/alpha.sh', 'tools/mike.sh', 'tools/zebra.sh'])
    expect(order2).toEqual(order1)
  })

  it('per-file fingerprint API returns each file’s own fingerprint', async () => {
    project = patternProject({
      'tools/a.sh': '#!/bin/sh\necho a\n',
      'tools/b.sh': '#!/bin/sh\necho b\n',
    })
    const fa = await fingerprint('tools/a.sh', { baseDir: project.baseDir })
    const fb = await fingerprint('tools/b.sh', { baseDir: project.baseDir })
    expect(fa.ok && fb.ok).toBe(true)
    if (!fa.ok || !fb.ok) return
    expect(fa.fileCount).toBe(1)
    expect(fb.fileCount).toBe(1)
    // Distinct files → distinct fingerprints.
    expect(fa.fingerprint).not.toBe(fb.fingerprint)
  })
})

describe('REGRESSION: single (non-pattern) gates behave exactly as before (#69)', () => {
  it('a single gate produces one combined seal with NO artifact segment', async () => {
    // Default kind (omitted) is `single`: multiple matched files roll into one
    // combined fingerprint covered by one seal — the historical behavior.
    project = createTestProject({
      gatePaths: ['tools/*.sh'],
      files: {
        'tools/a.sh': '#!/bin/sh\necho a\n',
        'tools/b.sh': '#!/bin/sh\necho b\n',
      },
    })

    const sealed = await seal('tools/a.sh', { identity: 'alice' }, { baseDir: project.baseDir })
    expect(sealed.ok).toBe(true)

    // Exactly one seal file, carrying NO artifactPath (aggregate one-per-gate).
    const stored = listStoredSealsSync(resolveSealsRoot(project.baseDir))
    expect(stored).toHaveLength(1)
    expect(stored[0]?.seal.artifactPath).toBeUndefined()
    expect(stored[0]?.seal.gateId).toBe('tools')

    // status reports ONE result for the whole gate (gate-keyed, not per-file).
    const st = await status(undefined, { baseDir: project.baseDir })
    expect(st.ok).toBe(true)
    if (!st.ok) return
    expect(st.results).toHaveLength(1)
    expect(st.results[0]?.ok).toBe(true)
    expect(st.results[0]?.gateId).toBe('tools')

    // Verifying the gate's sibling reports VALID too — the single seal covers the
    // whole gate, unlike a pattern gate.
    const vb = await verifyOne('tools/b.sh', { baseDir: project.baseDir })
    expect(vb.ok).toBe(true)
  })
})
