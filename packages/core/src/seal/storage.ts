/**
 * File-per-seal storage layout.
 *
 * @remarks
 * Seals are stored **one file per (gate, signer)** under a deterministic,
 * collision-safe path, so that two parallel PRs each adding a disjoint gate (or
 * a disjoint signer for the same gate) never touch the same file and therefore
 * never merge-conflict (PRD R5 / Goal 4).
 *
 * ### Path scheme
 *
 * ```text
 * <root>/<gateSlug>/<signerSlug>.seal
 * ```
 *
 * where `<root>` defaults to `.attest-it/seals/`. The path is
 * **organizational only**: a seal's identity (`gateId`, `fingerprint`,
 * `sealedBy`) and its cryptographic content live *inside* the file. The
 * aggregate map is reconstructed from file **content** (`seal.gateId`), never by
 * parsing the slug back out of the path. This preserves integration invariant 6
 * — seals bind artifact content, not storage location, branch, or commit. The
 * storage slug must not be confused with, or substituted for, the SHA-256
 * content fingerprint: the slug only disambiguates on-disk paths.
 *
 * ### m-of-n is not precluded (PRD R12)
 *
 * Because the **signer** is part of the path, multiple signers can seal the same
 * (gate, artifact) as separate files that coexist without overwriting one
 * another — exactly what m-of-n quorum sealing needs. A future pattern-gate
 * model (#69) that needs one seal per matched file inserts an artifact segment:
 *
 * ```text
 * <gateSlug>/<artifactSlug>/<signerSlug>.seal
 * ```
 *
 * and reuses the same collision-safe {@link slugifySegment} for every path
 * segment. The low-level primitives ({@link writeSealFileSync},
 * {@link listStoredSealsSync}) expose *every* seal file, so an m-of-n consumer
 * can enumerate all signer seals for a gate. The aggregate {@link SealsFile} API
 * (`readSeals`/`writeSeals`) is inherently
 * one-seal-per-gate and cannot represent a quorum; when a gate directory holds
 * more than one signer file it deterministically collapses to the most recent
 * seal (latest `timestamp`, ties broken by signer slug).
 *
 * @packageDocumentation
 */

import { createHash } from 'node:crypto'
import * as fs from 'node:fs'
import * as path from 'node:path'

import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import type { Seal, SealsFile } from './types.js'
import { migrateSealsDocumentToCurrent, sealSchemaV1 } from '../config/migrations/seals-graph.js'

/**
 * Aggregate seals-file version produced by the file-per-seal storage layer.
 *
 * v1 was the monolithic single-file era; v2 marks the file-per-seal era. The
 * value lives in memory only — there is no monolithic file to persist it into —
 * but it is carried on the aggregate {@link SealsFile} for API continuity and is
 * what a migrated legacy document is normalized to.
 * @public
 */
export const CURRENT_SEALS_VERSION = 2

/**
 * Extension for an individual seal file.
 * @internal
 */
const SEAL_FILE_EXT = '.seal'

/**
 * Schema reference header written atop each `.seal` file for editor support.
 * @internal
 */
const SEAL_FILE_HEADER =
  '# yaml-language-server: $schema=https://raw.githubusercontent.com/mike-north/attest-it/main/schemas/v1/seal.schema.json\n'

/**
 * Maximum length of the human-readable portion of a slug. The disambiguating
 * hash is appended after this, so truncation here never affects correctness.
 * @internal
 */
const SLUG_READABLE_MAX = 48

/**
 * Derive a filesystem-safe, **collision-safe** slug for a single path segment.
 *
 * @remarks
 * The slug is `<readable>-<hash>` where `<hash>` is the first 32 hex characters
 * (128 bits) of the SHA-256 of the *exact* input. Because the hash is a function
 * of the full input, two distinct inputs cannot produce the same slug (short of
 * a SHA-256 collision) — including inputs that differ only in characters the
 * readable portion lossily replaces, and inputs that differ only in case (which
 * would otherwise collide on a case-insensitive filesystem). This is what makes
 * `tools/a/b.sh` and `tools/a-b.sh` slug to *different* names even though naive
 * character substitution would collapse both to `tools-a-b.sh`.
 *
 * This is deliberately **not** the artifact content fingerprint (SHA-256 over
 * file bytes); it is only a path-disambiguation hash over an identifier string.
 *
 * @param input - The raw segment value (gate id, signer slug, or future
 *   artifact path).
 * @returns A collision-safe slug safe to use as a single path segment.
 * @public
 */
export function slugifySegment(input: string): string {
  const hash = createHash('sha256').update(input, 'utf8').digest('hex').slice(0, 32)
  const readable = input
    .replace(/[^a-zA-Z0-9._-]/g, '-')
    .replace(/^[-.]+/, '')
    .replace(/-+$/, '')
    .slice(0, SLUG_READABLE_MAX)
  const prefix = readable.length > 0 ? readable : 'seg'
  return `${prefix}-${hash}`
}

/**
 * Compute the repo-relative path (from the seals root) of the file that stores a
 * given gate's seal by a given signer.
 * @internal
 */
function sealRelPath(gateId: string, sealedBy: string): string {
  return path.join(slugifySegment(gateId), slugifySegment(sealedBy) + SEAL_FILE_EXT)
}

/**
 * Resolve the seals **storage directory** from a base dir and the (possibly
 * legacy) `sealsPath` setting.
 *
 * @remarks
 * The setting historically pointed at a monolithic file (`.attest-it/seals.json`
 * or `seals.yaml`); it now denotes a directory (`.attest-it/seals/`). To keep
 * existing, root-gate-sealed `policy.yaml` files working *without* rewriting
 * their `sealsPath` (which would change the policy fingerprint and break the
 * root seal), a setting that still ends in `.json`/`.yaml`/`.yml` is normalized
 * to the sibling directory with that extension stripped. Thus both
 * `.attest-it/seals.json` and `.attest-it/seals/` resolve to the same
 * `.attest-it/seals` directory.
 *
 * @public
 */
export function resolveSealsRoot(dir: string, sealsPathOverride?: string): string {
  if (sealsPathOverride === undefined) {
    return path.join(dir, '.attest-it', 'seals')
  }
  const resolved = path.resolve(dir, sealsPathOverride)
  return resolved.replace(/\.(json|ya?ml)$/i, '')
}

/**
 * Candidate legacy monolithic seal files for a given seals root, in migration
 * priority order (YAML preferred over JSON, matching the historical loader).
 * @internal
 */
function legacyMonolithCandidates(root: string): string[] {
  return [`${root}.yaml`, `${root}.yml`, `${root}.json`]
}

/**
 * Serialize a single seal into deterministic `.seal` file content.
 *
 * Fields are emitted in a fixed order so the output is byte-stable across
 * writes — a prerequisite for conflict-free merges (an unchanged seal must
 * re-serialize identically).
 * @internal
 */
function serializeSeal(seal: Seal): string {
  const ordered = {
    gateId: seal.gateId,
    fingerprint: seal.fingerprint,
    timestamp: seal.timestamp,
    sealedBy: seal.sealedBy,
    signature: seal.signature,
  }
  return SEAL_FILE_HEADER + stringifyYaml(ordered)
}

/**
 * Parse and validate a single `.seal` file's content into a {@link Seal}.
 * Accepts YAML (and therefore JSON, which is valid YAML).
 * @internal
 */
function parseSeal(content: string, source: string): Seal {
  let data: unknown
  try {
    data = parseYaml(content)
  } catch (error) {
    throw new Error(
      `Failed to read seal file '${source}': ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  const result = sealSchemaV1.safeParse(data)
  if (!result.success) {
    const errors = result.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join(', ')
    throw new Error(`Failed to read seal file '${source}': Validation failed: ${errors}`)
  }
  return result.data
}

/**
 * Deterministic tiebreak between two seals for the same gate when the aggregate
 * (one-per-gate) view must pick one. The most recently created seal wins; ties
 * on timestamp are broken by signer slug so the choice is stable.
 * @internal
 */
function isPreferredOver(candidate: Seal, current: Seal): boolean {
  if (candidate.timestamp !== current.timestamp) {
    return candidate.timestamp > current.timestamp
  }
  return candidate.sealedBy > current.sealedBy
}

// ─── Sync IO ─────────────────────────────────────────────────────────────────

/**
 * Recursively list absolute paths of every `.seal` file under `root` (sync).
 * @internal
 */
function listSealFilePathsSync(root: string): string[] {
  const out: string[] = []
  const walk = (dir: string): void => {
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch (error) {
      if (isFileNotFoundError(error)) return
      throw error
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(full)
      } else if (entry.isFile() && entry.name.endsWith(SEAL_FILE_EXT)) {
        out.push(full)
      }
    }
  }
  walk(root)
  return out.sort()
}

/**
 * A single seal file on disk together with its absolute path.
 * @public
 */
export interface StoredSeal {
  /** Absolute path to the `.seal` file. */
  path: string
  /** The parsed seal. */
  seal: Seal
}

/**
 * List every stored seal under `root` (sync), one entry per `.seal` file.
 *
 * This is the m-of-n-aware primitive: it returns *all* signer files, including
 * multiple signers for the same gate. The aggregate read path
 * collapses these to one-per-gate.
 * @public
 */
export function listStoredSealsSync(root: string): StoredSeal[] {
  return listSealFilePathsSync(root).map((p) => ({
    path: p,
    seal: parseSeal(fs.readFileSync(p, 'utf8'), p),
  }))
}

/**
 * Write a single seal file (sync) at its deterministic per-(gate, signer) path,
 * coexisting with any other signer's file for the same gate.
 * @public
 */
export function writeSealFileSync(root: string, seal: Seal): string {
  const target = path.join(root, sealRelPath(seal.gateId, seal.sealedBy))
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, serializeSeal(seal), 'utf8')
  return target
}

/**
 * Assemble the aggregate {@link SealsFile} from the file-per-seal layout (sync).
 * One seal per gate; multiple signer files for a gate collapse deterministically
 * to the most recent seal.
 * @internal
 */
export function readSealsFromDirSync(root: string): SealsFile {
  const seals: Record<string, Seal> = {}
  for (const { seal } of listStoredSealsSync(root)) {
    const current = seals[seal.gateId]
    if (!current || isPreferredOver(seal, current)) {
      seals[seal.gateId] = seal
    }
  }
  return { version: CURRENT_SEALS_VERSION, seals }
}

/**
 * Persist an aggregate {@link SealsFile} to the file-per-seal layout (sync).
 *
 * @remarks
 * Writes one file per gate (at the current signer's path), touching only files
 * whose content actually changes so unrelated seals stay byte-identical across
 * branches (conflict-free merges). Files whose gate is no longer present in the
 * aggregate — or a stale signer file for a gate that changed signers — are
 * removed, keeping the aggregate one-per-gate view deterministic. Empty gate
 * directories are pruned.
 * @internal
 */
export function writeSealsToDirSync(root: string, sealsFile: SealsFile): void {
  const desired = new Map<string, Seal>()
  for (const seal of Object.values(sealsFile.seals)) {
    desired.set(path.join(root, sealRelPath(seal.gateId, seal.sealedBy)), seal)
  }

  const existing = listSealFilePathsSync(root)

  // Write desired files (only when content differs, to minimize churn).
  for (const [target, seal] of desired) {
    const content = serializeSeal(seal)
    let prior: string | undefined
    try {
      prior = fs.readFileSync(target, 'utf8')
    } catch {
      prior = undefined
    }
    if (prior !== content) {
      fs.mkdirSync(path.dirname(target), { recursive: true })
      fs.writeFileSync(target, content, 'utf8')
    }
  }

  // Remove files not in the desired set (removed gates / stale signer files).
  for (const p of existing) {
    if (!desired.has(p)) {
      fs.rmSync(p, { force: true })
    }
  }

  pruneEmptyDirsSync(root)
}

/**
 * Remove empty directories beneath (and including, when empty) `root`, without
 * removing `root` itself. Best-effort; ignores races.
 * @internal
 */
function pruneEmptyDirsSync(root: string): void {
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(root, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      const child = path.join(root, entry.name)
      pruneEmptyDirsSync(child)
      try {
        if (fs.readdirSync(child).length === 0) {
          fs.rmdirSync(child)
        }
      } catch {
        // ignore
      }
    }
  }
}

/**
 * One-time migration of any legacy monolithic seals file into the file-per-seal
 * layout (sync). Reads the monolith, validates + normalizes it through the
 * migrex seals graph, fans it out to per-seal files, then deletes the monolith.
 * No-op when no monolith is present. This is the *only* code that reads a
 * monolithic seals document; after it runs once, none remains.
 * @internal
 */
export function migrateMonolithsSync(dir: string, root: string): boolean {
  const candidates = legacyMonolithCandidates(root)
  let migrated: SealsFile | undefined
  const present: string[] = []
  for (const candidate of candidates) {
    let content: string
    try {
      content = fs.readFileSync(candidate, 'utf8')
    } catch (error) {
      if (isFileNotFoundError(error)) continue
      throw new Error(
        `Failed to read seals file: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
    present.push(candidate)
    migrated ??= parseMonolith(content, candidate)
  }
  if (!migrated) return false

  // Fan out to per-seal files, then remove every monolith we found.
  writeSealsToDirSync(root, migrated)
  for (const candidate of present) {
    fs.rmSync(candidate, { force: true })
  }
  return true
}

/**
 * Parse + migrate a monolithic seals document to the current aggregate.
 * @internal
 */
function parseMonolith(content: string, source: string): SealsFile {
  let raw: unknown
  try {
    raw = parseYaml(content)
  } catch (error) {
    if (
      error instanceof SyntaxError ||
      (error instanceof Error && error.name === 'YAMLParseError')
    ) {
      throw new Error(`Failed to read seals file: Invalid seals document`)
    }
    throw error
  }
  return migrateSealsDocumentToCurrent(raw, source)
}

/**
 * Whether an error is a Node.js "not found" filesystem error.
 * @internal
 */
function isFileNotFoundError(error: unknown): boolean {
  if (error && typeof error === 'object' && 'code' in error) {
    const errorWithCode: { code: unknown } = error
    return errorWithCode.code === 'ENOENT' || errorWithCode.code === 'ENOTDIR'
  }
  return false
}

// ─── Async IO ────────────────────────────────────────────────────────────────

/**
 * Recursively list absolute paths of every `.seal` file under `root` (async).
 * @internal
 */
async function listSealFilePaths(root: string): Promise<string[]> {
  const out: string[] = []
  const walk = async (dir: string): Promise<void> => {
    let entries: fs.Dirent[]
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true })
    } catch (error) {
      if (isFileNotFoundError(error)) return
      throw error
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        await walk(full)
      } else if (entry.isFile() && entry.name.endsWith(SEAL_FILE_EXT)) {
        out.push(full)
      }
    }
  }
  await walk(root)
  return out.sort()
}

/**
 * Assemble the aggregate {@link SealsFile} from the file-per-seal layout (async).
 * @internal
 */
export async function readSealsFromDir(root: string): Promise<SealsFile> {
  const paths = await listSealFilePaths(root)
  const seals: Record<string, Seal> = {}
  for (const p of paths) {
    const seal = parseSeal(await fs.promises.readFile(p, 'utf8'), p)
    const current = seals[seal.gateId]
    if (!current || isPreferredOver(seal, current)) {
      seals[seal.gateId] = seal
    }
  }
  return { version: CURRENT_SEALS_VERSION, seals }
}

/**
 * Persist an aggregate {@link SealsFile} to the file-per-seal layout (async).
 * @internal
 */
export async function writeSealsToDir(root: string, sealsFile: SealsFile): Promise<void> {
  const desired = new Map<string, Seal>()
  for (const seal of Object.values(sealsFile.seals)) {
    desired.set(path.join(root, sealRelPath(seal.gateId, seal.sealedBy)), seal)
  }

  const existing = await listSealFilePaths(root)

  for (const [target, seal] of desired) {
    const content = serializeSeal(seal)
    let prior: string | undefined
    try {
      prior = await fs.promises.readFile(target, 'utf8')
    } catch {
      prior = undefined
    }
    if (prior !== content) {
      await fs.promises.mkdir(path.dirname(target), { recursive: true })
      await fs.promises.writeFile(target, content, 'utf8')
    }
  }

  for (const p of existing) {
    if (!desired.has(p)) {
      await fs.promises.rm(p, { force: true })
    }
  }

  pruneEmptyDirsSync(root)
}

/**
 * One-time migration of any legacy monolithic seals file into the file-per-seal
 * layout (async). See {@link migrateMonolithsSync}.
 * @internal
 */
export async function migrateMonoliths(dir: string, root: string): Promise<boolean> {
  const candidates = legacyMonolithCandidates(root)
  let migrated: SealsFile | undefined
  const present: string[] = []
  for (const candidate of candidates) {
    let content: string
    try {
      content = await fs.promises.readFile(candidate, 'utf8')
    } catch (error) {
      if (isFileNotFoundError(error)) continue
      throw new Error(
        `Failed to read seals file: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
    present.push(candidate)
    migrated ??= parseMonolith(content, candidate)
  }
  if (!migrated) return false

  await writeSealsToDir(root, migrated)
  for (const candidate of present) {
    await fs.promises.rm(candidate, { force: true })
  }
  return true
}
