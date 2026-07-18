/**
 * Pattern-gate (per-file) routing shared across the `seal`, `verify`, `status`,
 * and `run` commands.
 *
 * A gate declared `kind: pattern` fingerprints and seals **each matched file
 * independently** (see `configuration.md` and issue #130). This module is the
 * single place the CLI translates a pattern gate into its per-file units so the
 * four commands stay consistent:
 *
 * - each matched file gets its own fingerprint (`computeFingerprintsPerFileSync`),
 * - each file's seal is read/written as a standalone `.seal` under
 *   `<gate>/<artifact>/<signer>.seal` via the **low-level** per-file API
 *   ({@link writeSealFileSync} / {@link listStoredSealsSync}) — never the
 *   aggregate `writeSeals`, which is one-file-per-gate and would prune the
 *   sibling per-file seals,
 * - verification is per-file ({@link verifyPatternArtifactSeal}), so one file
 *   flipping invalid never touches its siblings.
 *
 * @packageDocumentation
 */

import {
  computeFingerprintsPerFileSync,
  listStoredSealsSync,
  resolveSealsRoot,
  verifyPatternArtifactSeal,
  type AttestItConfig,
  type GateConfig,
  type Seal,
  type SealVerificationResult,
} from '@attest-it/core'

/**
 * Whether a gate is a per-file **pattern** gate. Absent `kind` (or the explicit
 * `single`) keeps the pre-existing one-combined-fingerprint behavior.
 */
export function isPatternGate(gate: GateConfig): boolean {
  return gate.kind === 'pattern'
}

/**
 * The latest per-file seal for each matched file of a pattern gate, keyed by
 * artifact path. When several signers sealed the same file the most recent wins
 * (ties broken by signer slug) — the same deterministic collapse the aggregate
 * storage and the embeddable API use.
 *
 * Reads through the low-level {@link listStoredSealsSync} so per-file pattern
 * seals (which the aggregate read path deliberately ignores) are visible.
 */
export function readPatternSealsByArtifactSync(
  projectRoot: string,
  sealsPathOverride: string | undefined,
  gateId: string,
): Map<string, Seal> {
  const root = resolveSealsRoot(projectRoot, sealsPathOverride)
  const byArtifact = new Map<string, Seal>()
  for (const { seal } of listStoredSealsSync(root)) {
    if (seal.gateId !== gateId || seal.artifactPath === undefined) continue
    const current = byArtifact.get(seal.artifactPath)
    if (
      !current ||
      seal.timestamp > current.timestamp ||
      (seal.timestamp === current.timestamp && seal.sealedBy > current.sealedBy)
    ) {
      byArtifact.set(seal.artifactPath, seal)
    }
  }
  return byArtifact
}

/**
 * One matched file of a pattern gate together with its current individual
 * fingerprint and its verification result.
 */
export interface PatternFileState {
  /** Repo-relative, forward-slash path of the matched file. */
  path: string
  /** The file's current individual fingerprint (`sha256:...`). */
  fingerprint: string
  /** Per-file verification result (carries `artifactPath`). */
  result: SealVerificationResult
}

/**
 * Compute the current per-file fingerprints for a pattern gate, sorted
 * lexicographically by path (deterministic ordering for `status`/`verify`).
 *
 * A pattern gate whose globs match no file yields an empty list rather than
 * throwing — there is simply nothing to seal or report for it.
 */
export function computePatternFingerprintsSync(
  gate: GateConfig,
  projectRoot: string,
): { path: string; fingerprint: string }[] {
  try {
    return computeFingerprintsPerFileSync({
      paths: gate.fingerprint.paths,
      ...(gate.fingerprint.exclude && { exclude: gate.fingerprint.exclude }),
      baseDir: projectRoot,
    })
  } catch (error) {
    // A glob that matches nothing is "no files to attest", not an error. Any
    // other failure (unreadable path, etc.) is genuinely exceptional.
    if (error instanceof Error && error.message.includes('matched no files')) {
      return []
    }
    throw error
  }
}

/**
 * Verify a pattern gate: one independent {@link SealVerificationResult} per
 * matched file, sorted lexicographically by path. A newly-added matching file
 * with no seal surfaces as `MISSING`; a one-byte change to a sealed file flips
 * only that file to `FINGERPRINT_MISMATCH` while siblings stay `VALID`.
 */
export function verifyPatternGateSync(
  config: AttestItConfig,
  gateId: string,
  gate: GateConfig,
  projectRoot: string,
): PatternFileState[] {
  const perFile = computePatternFingerprintsSync(gate, projectRoot)
  const sealsByArtifact = readPatternSealsByArtifactSync(
    projectRoot,
    config.settings.sealsPath,
    gateId,
  )
  return perFile.map(({ path: filePath, fingerprint }) => ({
    path: filePath,
    fingerprint,
    result: verifyPatternArtifactSeal(
      config,
      gateId,
      filePath,
      sealsByArtifact.get(filePath),
      fingerprint,
      gate.maxAge,
    ),
  }))
}
