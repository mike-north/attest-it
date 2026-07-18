/**
 * Regression test for the repo's own `.attest-it/policy.yaml` gate
 * fingerprint paths (issue #113).
 *
 * @remarks
 * The "Verify manual test attestations" CI job (`.github/workflows/verify-manual-attestations.yml`)
 * resolves every gate's `fingerprint.paths` entries against the repo checkout
 * via {@link computeFingerprintSync} (see `packages/core/src/fingerprint.ts`,
 * which throws `Path does not exist: <resolved>` for any non-glob path that
 * is missing). After the VaultKeeper key-provider consolidation (#63), three
 * gates in `.attest-it/policy.yaml` still pointed at deleted files
 * (`one-password-provider.ts`, `macos-keychain-provider.ts`,
 * `yubikey-provider.ts`), so this job failed identically on every PR.
 *
 * This test parses the repo's real policy file with the same
 * {@link parsePolicyContent} used by the trust-model loader, then computes
 * the fingerprint for every gate exactly as the CI job would. It fails
 * pre-fix with "Path does not exist" and guards against future renames
 * silently breaking the dogfood gate again.
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import { describe, expect, it } from 'vitest'
import { parsePolicyContent } from '../../src/config/policy-schema.js'
import { computeFingerprintSync } from '../../src/fingerprint.js'

// This test file lives at <repo-root>/packages/core/test/config/, so the
// repo root is four directories up.
const REPO_ROOT = path.resolve(__dirname, '../../../..')
const POLICY_PATH = path.join(REPO_ROOT, '.attest-it', 'policy.yaml')

function loadRepoPolicy() {
  const content = fs.readFileSync(POLICY_PATH, 'utf-8')
  return parsePolicyContent(content, 'yaml')
}

describe('dogfood: .attest-it/policy.yaml gate fingerprint paths', () => {
  it('policy file exists at the expected repo-root location', () => {
    expect(fs.existsSync(POLICY_PATH)).toBe(true)
  })

  const policy = loadRepoPolicy()
  const gateIds = Object.keys(policy.gates)

  it('has at least one gate to check', () => {
    expect(gateIds.length).toBeGreaterThan(0)
  })

  it.each(gateIds)('gate "%s" fingerprint paths all resolve to real files', (gateId) => {
    const gate = policy.gates[gateId]
    if (!gate) {
      throw new Error(`Gate "${gateId}" unexpectedly missing from parsed policy`)
    }

    // This mirrors exactly what the "Verify manual test attestations" CI job
    // does when it computes the current fingerprint for a gate: non-glob
    // paths that don't exist throw `Path does not exist: <resolved path>`.
    expect(() =>
      computeFingerprintSync({
        paths: gate.fingerprint.paths,
        exclude: gate.fingerprint.exclude,
        baseDir: REPO_ROOT,
      }),
    ).not.toThrow()

    const result = computeFingerprintSync({
      paths: gate.fingerprint.paths,
      exclude: gate.fingerprint.exclude,
      baseDir: REPO_ROOT,
    })
    // A gate whose fingerprint paths silently resolve to zero files would
    // still "pass" this test's not-toThrow assertion above while providing
    // no real attestation coverage, so require at least one matched file.
    expect(result.fileCount).toBeGreaterThan(0)
  })
})
