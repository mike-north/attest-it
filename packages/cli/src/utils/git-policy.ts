/**
 * Read the trust-critical policy file from a git ref (a trusted base), so the
 * CLI's `verify --base <ref>` can enforce the SAME base-vs-worktree trust check
 * the GitHub Action performs.
 *
 * The Action sources `rootGate`/`team`/`gates` from the pull request's base
 * branch (via the GitHub API) while fingerprinting and reading seals from the
 * PR working tree. Off GitHub there is no API, but the base ref is normally
 * present locally (a checkout or a fetched ref), so we read the base copy of
 * `policy.yaml` with `git show`. The trust mechanism itself (root-gate
 * verification against the trusted config) is unchanged and lives in
 * `@attest-it/core`; this module only supplies the trusted policy bytes.
 *
 * @packageDocumentation
 */

import { spawnSync } from 'node:child_process'
import { relative } from 'node:path'

/**
 * Error thrown when the base ref's policy file cannot be read. `verify --base`
 * must fail **closed** on any such error (missing ref, missing file, no git),
 * never fall open to the untrusted working-tree policy — so callers treat this
 * as a configuration error with an actionable message.
 * @internal
 */
export class GitRefPolicyError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GitRefPolicyError'
  }
}

/**
 * The policy content read from a git ref, plus the parse format inferred from
 * the policy file's extension.
 * @internal
 */
export interface RefPolicy {
  /** Raw policy file content as committed at the ref. */
  content: string
  /** Parse format, inferred from the policy path extension. */
  format: 'yaml' | 'json'
}

/**
 * Read `policy.yaml` (or `.yml`/`.json`) as it exists at a git ref.
 *
 * Uses `git show <ref>:./<path-relative-to-cwd>` so it resolves correctly even
 * when the CLI is invoked from a subdirectory of the repository. The ref must
 * already be present locally — fetching it is the caller's / CI's job; a missing
 * ref fails closed with guidance rather than silently trusting the working tree.
 *
 * @param ref - Git ref (branch, tag, or commit SHA) providing the trusted policy.
 * @param policyPathAbs - Absolute path to the working-tree policy file, used to
 *   locate the same path at the ref and to infer the parse format.
 * @param cwd - Working directory git resolves the relative path against. Defaults
 *   to `process.cwd()`.
 * @returns The policy content at the ref and its parse format.
 * @throws {@link GitRefPolicyError} If git is unavailable, the ref is missing, or
 *   the policy file does not exist at the ref.
 * @internal
 */
export function readPolicyFromRef(
  ref: string,
  policyPathAbs: string,
  cwd: string = process.cwd(),
): RefPolicy {
  // git's `<ref>:./path` spelling resolves `path` relative to cwd, so this works
  // from a repository subdirectory. Normalize to forward slashes for git on any OS.
  const relFromCwd = relative(cwd, policyPathAbs).split('\\').join('/')
  const spec = `${ref}:./${relFromCwd}`

  const result = spawnSync('git', ['show', spec], {
    cwd,
    encoding: 'utf8',
    // Policy files are small; a generous cap still guards against pathological input.
    maxBuffer: 16 * 1024 * 1024,
  })

  if (result.error) {
    // git could not be spawned at all (most commonly: not installed / not on PATH).
    // Fail closed with an actionable message rather than trusting the working tree.
    throw new GitRefPolicyError(
      `Cannot read policy from ref '${ref}': failed to run git (${result.error.message}). ` +
        '`verify --base` requires git on PATH to read the trusted base policy.',
    )
  }

  if (result.status !== 0) {
    const stderr = (result.stderr || '').trim()
    throw new GitRefPolicyError(
      `Cannot read '${relFromCwd}' from ref '${ref}'. ` +
        'Ensure the ref exists locally (a shallow CI clone may need ' +
        `\`git fetch origin ${ref}\`) and that the policy file exists there.` +
        (stderr ? `\n  git: ${stderr}` : ''),
    )
  }

  const format: 'yaml' | 'json' = policyPathAbs.endsWith('.json') ? 'json' : 'yaml'
  return { content: result.stdout, format }
}
