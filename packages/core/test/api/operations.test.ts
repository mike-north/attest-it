/**
 * Unit tests for the embeddable API operations and the versioned failure
 * taxonomy.
 *
 * These assert the contract shape and taxonomy classes that an embedder (e.g.
 * Toolsmith) pins against. Each test maps to an acceptance criterion of the
 * embeddable-API work.
 *
 * @see PRD R3 — programmatic surface (listGates/status/fingerprint/seal/verifyOne/verifyAll)
 * @see Integration contract §"Interface expectations" and invariants 2 & 4
 */

import { existsSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  listGates,
  status,
  fingerprint,
  seal,
  verifyOne,
  verifyAll,
  API_SCHEMA_VERSION,
  type ApiFailure,
  type FailureClass,
} from '../../src/api/index.js'
import { sign as signEd25519 } from '../../src/crypto/ed25519.js'
import { writeSealsSync, type SealsFile } from '../../src/seal/index.js'
import { createTestProject, type TestProject } from './helpers.js'

let project: TestProject

afterEach(() => {
  project.cleanup()
})

/** Narrow a result to {@link ApiFailure}, failing the test if it is a success. */
function expectFailure(result: { ok: true } | ApiFailure): ApiFailure {
  if (result.ok) {
    throw new Error(`Expected a failure result, got: ${JSON.stringify(result)}`)
  }
  return result
}

/**
 * Craft a valid seal for the project's gate with an arbitrary timestamp, and
 * write it to the seals file. Used to construct an expired (but otherwise
 * valid) seal deterministically.
 */
function writeSealWithTimestamp(p: TestProject, fingerprintValue: string, timestamp: string): void {
  const canonical = `${p.gateId}:${fingerprintValue}:${timestamp}`
  const signature = signEd25519(canonical, p.alicePrivateKeyPem)
  const seals: SealsFile = {
    version: 1,
    seals: {
      [p.gateId]: {
        gateId: p.gateId,
        fingerprint: fingerprintValue,
        timestamp,
        sealedBy: 'alice',
        signature,
      },
    },
  }
  writeSealsSync(p.baseDir, seals, p.sealsPath)
}

describe('listGates', () => {
  it('enumerates configured gates with their descriptors', async () => {
    project = createTestProject()
    const result = await listGates({ baseDir: project.baseDir })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.schemaVersion).toBe(API_SCHEMA_VERSION)
    expect(result.gates).toHaveLength(1)
    const gate = result.gates[0]
    expect(gate?.gateId).toBe('tools')
    expect(gate?.authorizedSigners).toEqual(['alice'])
    expect(gate?.paths).toEqual(['src/**'])
    expect(gate?.maxAge).toBe('30d')
  })

  it('returns a malformed failure when no config is present', async () => {
    project = createTestProject()
    const failure = expectFailure(await listGates({ baseDir: project.homeDir }))
    expect(failure.failureClass).toBe('malformed')
    expect(failure.schemaVersion).toBe(API_SCHEMA_VERSION)
  })
})

describe('fingerprint', () => {
  it('returns the governing gate fingerprint for a governed path', async () => {
    project = createTestProject()
    const result = await fingerprint(project.gatedFile, { baseDir: project.baseDir })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.gateId).toBe('tools')
    expect(result.fingerprint).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(result.fileCount).toBeGreaterThan(0)
  })

  it('returns malformed when no gate governs the path', async () => {
    project = createTestProject()
    writeFileSync(join(project.baseDir, 'README.md'), '# readme\n', 'utf8')
    const failure = expectFailure(await fingerprint('README.md', { baseDir: project.baseDir }))
    expect(failure.failureClass).toBe('malformed')
    expect(failure.path).toBe('README.md')
  })
})

describe('seal', () => {
  it('creates a seal for a governed path as an authorized identity', async () => {
    project = createTestProject()
    const result = await seal(
      project.gatedFile,
      { identity: 'alice' },
      { baseDir: project.baseDir },
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.gateId).toBe('tools')
    expect(result.sealedBy).toBe('alice')
    expect(result.fingerprint).toMatch(/^sha256:/)
    // Seals are stored one file per (gate, signer) under the seals directory.
    // The configured `.attest-it/seals.json` (legacy value) normalizes to the
    // `.attest-it/seals/` directory, which now holds the per-seal file.
    expect(existsSync(join(project.baseDir, '.attest-it', 'seals'))).toBe(true)
  })

  it('returns unauthorized-signer and writes no seal for an unauthorized identity', async () => {
    // Gate authorizes only alice; mallory is a known but unauthorized identity.
    project = createTestProject({ authorizedSigners: ['alice'] })
    const failure = expectFailure(
      await seal(project.gatedFile, { identity: 'mallory' }, { baseDir: project.baseDir }),
    )
    expect(failure.failureClass).toBe('unauthorized-signer')
    expect(failure.gateId).toBe('tools')
    // Critically: no seal file was created.
    expect(existsSync(join(project.baseDir, project.sealsPath))).toBe(false)
  })

  it('returns malformed when no gate governs the path', async () => {
    project = createTestProject()
    writeFileSync(join(project.baseDir, 'README.md'), '# readme\n', 'utf8')
    const failure = expectFailure(
      await seal('README.md', { identity: 'alice' }, { baseDir: project.baseDir }),
    )
    expect(failure.failureClass).toBe('malformed')
  })
})

describe('verifyOne', () => {
  it('returns the unsealed class (as a value, not a throw) for an unsealed path', async () => {
    project = createTestProject()
    const result = await verifyOne(project.gatedFile, { baseDir: project.baseDir })
    const failure = expectFailure(result)
    expect(failure.failureClass).toBe('unsealed')
    expect(failure.path).toBe(project.gatedFile)
  })

  it('returns success for a validly sealed, unchanged path', async () => {
    project = createTestProject()
    await seal(project.gatedFile, { identity: 'alice' }, { baseDir: project.baseDir })
    const result = await verifyOne(project.gatedFile, { baseDir: project.baseDir })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.gateId).toBe('tools')
    expect(result.sealedBy).toBe('alice')
    expect(result.path).toBe(project.gatedFile)
  })

  it('returns fingerprint-mismatch when content changed after sealing', async () => {
    project = createTestProject()
    await seal(project.gatedFile, { identity: 'alice' }, { baseDir: project.baseDir })
    // Mutate the sealed artifact.
    writeFileSync(
      join(project.baseDir, project.gatedFile),
      'export const tool = () => 999\n',
      'utf8',
    )
    const failure = expectFailure(await verifyOne(project.gatedFile, { baseDir: project.baseDir }))
    expect(failure.failureClass).toBe('fingerprint-mismatch')
    expect(failure.underlyingState).toBe('FINGERPRINT_MISMATCH')
  })

  it('returns expired for a valid seal older than the gate maxAge', async () => {
    project = createTestProject()
    const fp = await fingerprint(project.gatedFile, { baseDir: project.baseDir })
    expect(fp.ok).toBe(true)
    if (!fp.ok) return
    // 60 days old vs. a 30d maxAge.
    const oldTimestamp = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString()
    writeSealWithTimestamp(project, fp.fingerprint, oldTimestamp)
    const failure = expectFailure(await verifyOne(project.gatedFile, { baseDir: project.baseDir }))
    expect(failure.failureClass).toBe('expired')
    expect(failure.underlyingState).toBe('STALE')
  })

  it('returns malformed for a path governed by no gate', async () => {
    project = createTestProject()
    writeFileSync(join(project.baseDir, 'README.md'), '# readme\n', 'utf8')
    const failure = expectFailure(await verifyOne('README.md', { baseDir: project.baseDir }))
    expect(failure.failureClass).toBe('malformed')
  })
})

describe('status', () => {
  it('reports every gate as unsealed before any seal exists', async () => {
    project = createTestProject()
    const result = await status(undefined, { baseDir: project.baseDir })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.results).toHaveLength(1)
    const only = result.results[0]
    expect(only).toBeDefined()
    if (!only) return
    expect(expectFailure(only).failureClass).toBe('unsealed')
  })

  it('is path-keyed when given explicit paths', async () => {
    project = createTestProject()
    await seal(project.gatedFile, { identity: 'alice' }, { baseDir: project.baseDir })
    const result = await status([project.gatedFile], { baseDir: project.baseDir })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.results[0]?.ok).toBe(true)
    expect(result.results[0]?.path).toBe(project.gatedFile)
  })
})

describe('verifyAll', () => {
  it('verifies every gate and reflects a valid seal', async () => {
    project = createTestProject()
    await seal(project.gatedFile, { identity: 'alice' }, { baseDir: project.baseDir })
    const result = await verifyAll({}, { baseDir: project.baseDir })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.results).toHaveLength(1)
    expect(result.results[0]?.ok).toBe(true)
  })

  it('rejects an invalid changedSince timestamp as malformed', async () => {
    project = createTestProject()
    const failure = expectFailure(
      await verifyAll({ changedSince: 'not-a-date' }, { baseDir: project.baseDir }),
    )
    expect(failure.failureClass).toBe('malformed')
  })

  it('skips gates unchanged since a future changedSince timestamp', async () => {
    project = createTestProject()
    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString()
    const result = await verifyAll({ changedSince: future }, { baseDir: project.baseDir })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.results).toHaveLength(0)
  })
})

describe('corrupt seals file handling', () => {
  it('returns a malformed failure (not a throw) from verifyOne when the seals file is corrupt', async () => {
    project = createTestProject()
    // Structurally invalid JSON — readSeals() throws on parse.
    writeFileSync(join(project.baseDir, project.sealsPath), '{ not valid json', 'utf8')
    const failure = expectFailure(await verifyOne(project.gatedFile, { baseDir: project.baseDir }))
    expect(failure.failureClass).toBe('malformed')
    expect(failure.gateId).toBe(project.gateId)
  })

  it('returns a malformed failure (not a throw) from seal() when the existing seals file is corrupt', async () => {
    project = createTestProject()
    writeFileSync(join(project.baseDir, project.sealsPath), '{ not valid json', 'utf8')
    const failure = expectFailure(
      await seal(project.gatedFile, { identity: 'alice' }, { baseDir: project.baseDir }),
    )
    expect(failure.failureClass).toBe('malformed')
  })
})

describe('verifyAll changedSince fail-safe behavior', () => {
  it('does not skip a gate when change detection errors (fails safe, not open)', async () => {
    project = createTestProject()
    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString()
    // Delete the gate's source tree so listPackageFiles() throws while
    // detecting whether the gate changed. Before the fix, that error was
    // swallowed and read as "unchanged", silently skipping the gate.
    rmSync(join(project.baseDir, 'src'), { recursive: true, force: true })
    const result = await verifyAll({ changedSince: future }, { baseDir: project.baseDir })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.results).toHaveLength(1)
  })
})

describe('failure taxonomy', () => {
  it('documents exactly the six versioned classes', () => {
    // A total record over FailureClass: adding or removing a class is a
    // compile error here, forcing a deliberate (breaking) schema change.
    const exhaustive: Record<FailureClass, true> = {
      unsealed: true,
      'fingerprint-mismatch': true,
      'unauthorized-signer': true,
      'untrusted-config': true,
      expired: true,
      malformed: true,
    }
    expect(Object.keys(exhaustive).sort()).toEqual(
      [
        'expired',
        'fingerprint-mismatch',
        'malformed',
        'unauthorized-signer',
        'unsealed',
        'untrusted-config',
      ].sort(),
    )
  })

  it('stamps every structured result with the schema version', async () => {
    project = createTestProject()
    const gates = await listGates({ baseDir: project.baseDir })
    const one = await verifyOne(project.gatedFile, { baseDir: project.baseDir })
    expect(gates.schemaVersion).toBe(API_SCHEMA_VERSION)
    expect(one.schemaVersion).toBe(API_SCHEMA_VERSION)
  })
})
