#!/usr/bin/env node
/**
 * Guards against issue #154: an agent-authored changeset annotated `major`
 * would push a 0.x package straight to 1.0.0. attest-it stays in the 0.x
 * series deliberately (see CONTRIBUTING.md) — breaking changes are expected
 * there and are expressed as `minor`, never `major`.
 *
 * .changeset/config.json links @attest-it/core, @attest-it/cli, and
 * attest-it together (`linked`), so a `major` on any one of them propagates
 * to all three. This guard reads `.changeset/*.md` front-matter directly and
 * expands it through `.changeset/config.json`'s `linked` groups itself —
 * that expansion is what makes plain front-matter parsing report the full
 * blast radius rather than under-reporting it.
 *
 * Deliberately does NOT shell out to `changeset status` (or any @changesets/*
 * package): that path needs git history to resolve a merge-base against the
 * base branch, which a shallow pull_request CI checkout doesn't have and
 * which has its own failure modes inside git worktrees. Reading local files
 * needs no git history at all, so the guard behaves identically in every
 * context it runs in — PR CI, push CI, and husky pre-commit in a worktree.
 *
 * Usage:
 *   node scripts/check-major-bump-guard.mjs             # check pending changesets
 *   node scripts/check-major-bump-guard.mjs --self-test  # verify the guard's own logic
 */

import { readFileSync, readdirSync, mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Parse a single changeset file's YAML-ish front matter into `{ name, type }`
 * release entries. Deliberately narrow — it matches exactly the shape
 * `@changesets/cli` writes (quoted-or-unquoted package name, `:`, bump type)
 * rather than pulling in a general YAML parser, mirroring the other guard
 * script in this repo (scripts/check-policy-ref-guard.mjs).
 *
 * @param {string} content - Full text of a `.changeset/*.md` file.
 * @param {string} fileName - Used only for error messages.
 * @returns {Array<{ name: string, type: 'major' | 'minor' | 'patch' | 'none' }>}
 */
export function parseChangesetFrontMatter(content, fileName) {
  const lines = content.split('\n')
  if (lines[0]?.trim() !== '---') {
    throw new Error(`${fileName}: missing opening \`---\` front-matter delimiter`)
  }
  const closingIndex = lines.slice(1).findIndex((line) => line.trim() === '---')
  if (closingIndex === -1) {
    throw new Error(`${fileName}: missing closing \`---\` front-matter delimiter`)
  }

  const releases = []
  for (const line of lines.slice(1, 1 + closingIndex)) {
    if (line.trim() === '') continue
    const match = /^\s*["']?([^"':]+)["']?\s*:\s*(major|minor|patch|none)\s*$/.exec(line)
    if (!match) {
      throw new Error(`${fileName}: could not parse front-matter line: ${JSON.stringify(line)}`)
    }
    releases.push({ name: match[1].trim(), type: match[2] })
  }
  if (releases.length === 0) {
    throw new Error(`${fileName}: front matter has no package entries`)
  }
  return releases
}

/**
 * Parse `.changeset/config.json`'s `linked` groups (defaulting to `[]` when
 * absent, matching @changesets/config's own default).
 *
 * @param {string} configJsonText
 * @returns {string[][]}
 */
export function parseLinkedGroups(configJsonText) {
  let parsed
  try {
    parsed = JSON.parse(configJsonText)
  } catch (error) {
    throw new Error(
      `.changeset/config.json is not valid JSON (${error instanceof Error ? error.message : String(error)})`,
    )
  }
  if (parsed === null || typeof parsed !== 'object') {
    throw new Error('.changeset/config.json is not a JSON object')
  }

  const linked = parsed.linked ?? []
  const isValid =
    Array.isArray(linked) &&
    linked.every((group) => Array.isArray(group) && group.every((name) => typeof name === 'string'))
  if (!isValid) {
    throw new Error('.changeset/config.json `linked` is not an array of string arrays')
  }
  return linked
}

/**
 * Given every pending changeset's release entries and the `linked` groups,
 * return the sorted list of package names that would end up `major` — after
 * expanding through linked groups, since a `major` on any member propagates
 * to every member.
 *
 * @param {Array<{ name: string, type: string }>} allReleases
 * @param {string[][]} linkedGroups
 * @returns {string[]}
 */
export function computeMajorBumpPackages(allReleases, linkedGroups) {
  const majors = new Set()
  for (const release of allReleases) {
    if (release.type === 'major') majors.add(release.name)
  }
  for (const group of linkedGroups) {
    if (group.some((pkg) => majors.has(pkg))) {
      for (const pkg of group) majors.add(pkg)
    }
  }
  return [...majors].sort()
}

/**
 * Read every pending changeset under `.changeset/*.md` (skipping `README.md`)
 * plus `.changeset/config.json`, and return their parsed, unexpanded state.
 * Throws — never returns a partial/empty result — if the directory, config,
 * or any individual changeset file can't be read or parsed, so a filesystem
 * problem can never be mistaken for "no changesets pending".
 *
 * @param {string} repoRoot
 * @returns {{ allReleases: Array<{ name: string, type: string }>, linkedGroups: string[][] }}
 */
export function loadReleaseState(repoRoot) {
  const changesetDir = join(repoRoot, '.changeset')

  let entries
  try {
    entries = readdirSync(changesetDir, { withFileTypes: true })
  } catch (error) {
    throw new Error(
      `could not read .changeset directory (${error instanceof Error ? error.message : String(error)})`,
    )
  }

  const changesetFileNames = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md') && entry.name !== 'README.md')
    .map((entry) => entry.name)
    .sort()

  const allReleases = []
  for (const fileName of changesetFileNames) {
    let content
    try {
      content = readFileSync(join(changesetDir, fileName), 'utf8')
    } catch (error) {
      throw new Error(
        `could not read .changeset/${fileName} (${error instanceof Error ? error.message : String(error)})`,
      )
    }
    allReleases.push(...parseChangesetFrontMatter(content, `.changeset/${fileName}`))
  }

  let configText
  try {
    configText = readFileSync(join(changesetDir, 'config.json'), 'utf8')
  } catch (error) {
    throw new Error(
      `could not read .changeset/config.json (${error instanceof Error ? error.message : String(error)})`,
    )
  }

  return { allReleases, linkedGroups: parseLinkedGroups(configText) }
}

/**
 * Best-effort lookup of each workspace package's current version, purely to
 * enrich the failure message with an old -> new preview. Never throws — a
 * missing/unreadable package.json just means that package's entry omits
 * version info, since this is cosmetic, not part of the guard's correctness.
 *
 * @param {string} repoRoot
 * @returns {Map<string, string>}
 */
function loadWorkspaceVersions(repoRoot) {
  const versions = new Map()
  for (const workspaceDir of ['packages', 'examples']) {
    let entries
    try {
      entries = readdirSync(join(repoRoot, workspaceDir), { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      try {
        const pkg = JSON.parse(
          readFileSync(join(repoRoot, workspaceDir, entry.name, 'package.json'), 'utf8'),
        )
        if (typeof pkg.name === 'string' && typeof pkg.version === 'string') {
          versions.set(pkg.name, pkg.version)
        }
      } catch {
        // Best-effort only — skip packages without a readable/valid package.json.
      }
    }
  }
  return versions
}

function bumpMajorVersion(oldVersion) {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(oldVersion)
  return match ? `${String(Number(match[1]) + 1)}.0.0` : undefined
}

/**
 * Resolve which packages would bump to `major`, enriched with an old -> new
 * version preview where the current version is known.
 *
 * @param {{ allReleases: Array<{ name: string, type: string }>, linkedGroups: string[][] }} releaseState
 * @param {Map<string, string>} [versions]
 * @returns {Array<{ name: string, oldVersion?: string, newVersion?: string }>}
 */
export function findMajorBumps(releaseState, versions = new Map()) {
  return computeMajorBumpPackages(releaseState.allReleases, releaseState.linkedGroups).map(
    (name) => {
      const oldVersion = versions.get(name)
      const newVersion = oldVersion ? bumpMajorVersion(oldVersion) : undefined
      return { name, oldVersion, newVersion }
    },
  )
}

/**
 * Build the message shown to whoever (human or agent) tripped the guard. The
 * reader is likely an agent that has convinced itself a large breaking
 * change justifies a 1.0 bump — the message exists to rebut that directly
 * and redirect to the correct action.
 *
 * @param {Array<{ name: string, oldVersion?: string, newVersion?: string }>} majorBumps
 * @returns {string}
 */
export function formatFailureMessage(majorBumps) {
  const targets = majorBumps
    .map((release) =>
      release.oldVersion && release.newVersion
        ? `  - ${release.name}: ${release.oldVersion} -> ${release.newVersion}`
        : `  - ${release.name}`,
    )
    .join('\n')

  return [
    'Major version bump guard failed.',
    '',
    'attest-it stays in the 0.x series deliberately — the API surface has not stabilized and',
    'we are not ready to commit to post-0.x stability guarantees. A breaking change, no matter',
    'how large, is NOT justification for a major/1.0 bump on its own. In the 0.x series,',
    'breaking changes are expected, and the correct way to express one is `minor`, not `major`.',
    '',
    'Pending changesets compute a major bump for:',
    '',
    targets,
    '',
    '.changeset/config.json links @attest-it/core, @attest-it/cli, and attest-it together, so a',
    'major on any one of them propagates to all three — the list above already reflects that.',
    '',
    'What to do instead:',
    '  1. In the offending changeset(s) under .changeset/*.md, change the front-matter bump type',
    '     from `major` to `minor`.',
    '  2. Describe the breaking change clearly in the changeset body, so consumers reading the',
    "     0.x release notes understand what changed and how to adapt. That's how breaking changes",
    '     are communicated pre-1.0 — through the changelog, not through the major version number.',
    '',
    'Taking attest-it to 1.0 is a deliberate decision made by the repo owner alone, by bypassing',
    'this check on merge. It is never made implicitly by a changeset annotation.',
  ].join('\n')
}

/**
 * Build the message shown when the guard could not read/parse the pending
 * changesets at all — e.g. `.changeset/` is missing, `config.json` is
 * unreadable or malformed, or a changeset file's front matter doesn't parse.
 * This must never be confused with "a major bump was found": it's the
 * opposite problem, an inability to certify anything either way, and it must
 * fail closed rather than silently pass with an empty major-bump list.
 *
 * @param {unknown} error
 * @returns {string}
 */
export function formatCouldNotVerifyMessage(error) {
  const reason = error instanceof Error ? error.message : String(error)

  return [
    'Major version bump guard could not verify the pending changesets.',
    '',
    'This is NOT a report that a major bump was found. It means the guard was unable to read',
    'or parse .changeset/*.md and .changeset/config.json, so it cannot certify that no',
    'major/1.0 bump is present. An indeterminate result must be treated as a failure, not a',
    'pass — silently passing here is exactly the failure mode this guard exists to prevent.',
    '',
    `Reason: ${reason}`,
    '',
    'Fix the underlying problem (see the reason above) and re-run this check — do not bypass',
    'it based on this message alone.',
  ].join('\n')
}

function runRealCheck() {
  const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

  let releaseState
  try {
    releaseState = loadReleaseState(repoRoot)
  } catch (error) {
    console.error(formatCouldNotVerifyMessage(error))
    process.exit(1)
  }

  const majorBumps = findMajorBumps(releaseState, loadWorkspaceVersions(repoRoot))

  if (majorBumps.length > 0) {
    console.error(formatFailureMessage(majorBumps))
    process.exit(1)
  }

  console.log('No major version bumps found across pending changesets (linked groups expanded).')
}

/**
 * Write a fixture `.changeset/` directory (config.json + given changeset
 * files) under a fresh scratch repo root, for self-test cases to run the
 * real `loadReleaseState` against — not hand-built plan objects.
 *
 * @param {{ linked?: string[][], changesets: Record<string, string> }} fixture
 * @returns {string} the scratch repo root
 */
function writeFixtureRepo({ linked = [], changesets }) {
  const repoRoot = mkdtempSync(join(tmpdir(), 'major-bump-guard-self-test-'))
  const changesetDir = join(repoRoot, '.changeset')
  mkdirSync(changesetDir, { recursive: true })
  writeFileSync(join(changesetDir, 'config.json'), JSON.stringify({ linked }))
  writeFileSync(join(changesetDir, 'README.md'), '# Changesets\n')
  for (const [fileName, content] of Object.entries(changesets)) {
    writeFileSync(join(changesetDir, fileName), content)
  }
  return repoRoot
}

function runSelfTest() {
  let failed = false

  const linkedGroups = [['@attest-it/core', '@attest-it/cli', 'attest-it']]

  const parsingCases = [
    {
      name: 'only minor/patch changesets: no major bumps',
      fixture: {
        linked: linkedGroups,
        changesets: {
          'a.md': "---\n'@attest-it/core': minor\n'@attest-it/cli': minor\n---\n\nsummary\n",
          'b.md': "---\n'@attest-it/cli': patch\n---\n\nsummary\n",
        },
      },
      expectedNames: [],
    },
    {
      name: 'major on one linked package propagates to every linked package',
      fixture: {
        linked: linkedGroups,
        changesets: {
          'a.md': "---\n'@attest-it/core': major\n---\n\nbreaking change\n",
        },
      },
      expectedNames: ['@attest-it/cli', '@attest-it/core', 'attest-it'],
    },
    {
      name: 'major on an unlinked package does not propagate to unrelated packages',
      fixture: {
        linked: linkedGroups,
        changesets: {
          'a.md': "---\n'@attest-it/example-embedder': major\n---\n\nbreaking change\n",
        },
      },
      expectedNames: ['@attest-it/example-embedder'],
    },
  ]

  for (const testCase of parsingCases) {
    const repoRoot = writeFixtureRepo(testCase.fixture)
    let gotNames
    try {
      const releaseState = loadReleaseState(repoRoot)
      gotNames = computeMajorBumpPackages(releaseState.allReleases, releaseState.linkedGroups)
    } finally {
      rmSync(repoRoot, { recursive: true, force: true })
    }
    const ok =
      gotNames.length === testCase.expectedNames.length &&
      testCase.expectedNames.every((name) => gotNames.includes(name))
    console.log(
      `${ok ? 'PASS' : 'FAIL'}: ${testCase.name} — expected=[${testCase.expectedNames.join(', ')}], got=[${gotNames.join(', ')}]`,
    )
    if (!ok) failed = true
  }

  // Negative test: the failure message must name every offending package.
  const namedRepoRoot = writeFixtureRepo({
    linked: linkedGroups,
    changesets: { 'a.md': "---\n'@attest-it/core': major\n---\n\nbreaking change\n" },
  })
  let message
  try {
    const releaseState = loadReleaseState(namedRepoRoot)
    message = formatFailureMessage(findMajorBumps(releaseState))
  } finally {
    rmSync(namedRepoRoot, { recursive: true, force: true })
  }
  const namesAllPresent = ['@attest-it/cli', 'attest-it', '@attest-it/core'].every((name) =>
    message.includes(name),
  )
  console.log(`${namesAllPresent ? 'PASS' : 'FAIL'}: failure message names every offending package`)
  if (!namesAllPresent) failed = true

  // Indeterminate paths: the guard must fail closed on each of these — never
  // fall through to "no major bumps found" — with the distinct
  // could-not-verify message, not the major-bump-found message.
  const indeterminateCases = [
    {
      name: '.changeset directory is missing',
      setup: () => mkdtempSync(join(tmpdir(), 'major-bump-guard-self-test-')),
    },
    {
      name: '.changeset/config.json is missing',
      setup: () => {
        const repoRoot = mkdtempSync(join(tmpdir(), 'major-bump-guard-self-test-'))
        mkdirSync(join(repoRoot, '.changeset'), { recursive: true })
        writeFileSync(
          join(repoRoot, '.changeset', 'a.md'),
          "---\n'@attest-it/core': minor\n---\n\nsummary\n",
        )
        return repoRoot
      },
    },
    {
      name: '.changeset/config.json is malformed JSON',
      setup: () => {
        const repoRoot = writeFixtureRepo({ changesets: {} })
        writeFileSync(join(repoRoot, '.changeset', 'config.json'), '{ not valid json')
        return repoRoot
      },
    },
    {
      name: 'a changeset file has no front-matter delimiters',
      setup: () =>
        writeFixtureRepo({
          linked: linkedGroups,
          changesets: { 'a.md': 'not a changeset file at all\n' },
        }),
    },
    {
      name: 'a changeset file has an unparseable front-matter line',
      setup: () =>
        writeFixtureRepo({
          linked: linkedGroups,
          changesets: { 'a.md': '---\nthis is not valid: : yaml: at all\n---\n\nsummary\n' },
        }),
    },
  ]

  for (const testCase of indeterminateCases) {
    const repoRoot = testCase.setup()
    let threw = false
    let usedCouldNotVerifyMessage = false
    try {
      loadReleaseState(repoRoot)
    } catch (error) {
      threw = true
      const message = formatCouldNotVerifyMessage(error)
      usedCouldNotVerifyMessage =
        message.includes('could not verify') &&
        !message.includes('Major version bump guard failed.')
    } finally {
      rmSync(repoRoot, { recursive: true, force: true })
    }
    const ok = threw && usedCouldNotVerifyMessage
    console.log(
      `${ok ? 'PASS' : 'FAIL'}: indeterminate path — ${testCase.name} — fails closed with could-not-verify message`,
    )
    if (!ok) failed = true
  }

  if (failed) {
    console.error('\nSelf-test failed: guard logic does not match expected behavior.')
    process.exit(1)
  }
  console.log('\nSelf-test passed: guard correctly detects major bumps and linked propagation.')
}

const args = process.argv.slice(2)
if (args.includes('--self-test')) {
  runSelfTest()
} else {
  runRealCheck()
}
