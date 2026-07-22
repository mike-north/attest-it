#!/usr/bin/env node
/**
 * Guards against issue #154: an agent-authored changeset annotated `major`
 * would push a 0.x package straight to 1.0.0. attest-it stays in the 0.x
 * series deliberately (see CONTRIBUTING.md) — breaking changes are expected
 * there and are expressed as `minor`, never `major`.
 *
 * .changeset/config.json links @attest-it/core, @attest-it/cli, and
 * attest-it together (`linked`), so a `major` on any one of them propagates
 * to all three. Grepping `.changeset/*.md` front-matter would under-report
 * that blast radius, so this guard inspects the *computed* release plan
 * instead — the same plan `changeset version` would apply — via
 * `changeset status --output`.
 *
 * Usage:
 *   node scripts/check-major-bump-guard.mjs             # check the real release plan
 *   node scripts/check-major-bump-guard.mjs --self-test  # verify the guard's own logic
 */

import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Find every release in a computed changeset release plan that would bump
 * a package to a `major` version.
 *
 * @param {{ releases: Array<{ name: string, type: string, oldVersion: string, newVersion: string }> }} releasePlan
 * @returns {Array<{ name: string, oldVersion: string, newVersion: string }>}
 */
export function findMajorBumps(releasePlan) {
  return releasePlan.releases
    .filter((release) => release.type === 'major')
    .map(({ name, oldVersion, newVersion }) => ({ name, oldVersion, newVersion }))
}

/**
 * Build the message shown to whoever (human or agent) tripped the guard. The
 * reader is likely an agent that has convinced itself a large breaking
 * change justifies a 1.0 bump — the message exists to rebut that directly
 * and redirect to the correct action.
 *
 * @param {Array<{ name: string, oldVersion: string, newVersion: string }>} majorBumps
 * @returns {string}
 */
export function formatFailureMessage(majorBumps) {
  const targets = majorBumps
    .map((release) => `  - ${release.name}: ${release.oldVersion} -> ${release.newVersion}`)
    .join('\n')

  return [
    'Major version bump guard failed.',
    '',
    'attest-it stays in the 0.x series deliberately — the API surface has not stabilized and',
    'we are not ready to commit to post-0.x stability guarantees. A breaking change, no matter',
    'how large, is NOT justification for a major/1.0 bump on its own. In the 0.x series,',
    'breaking changes are expected, and the correct way to express one is `minor`, not `major`.',
    '',
    'The current changeset release plan computes a major bump for:',
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
 * Parse and shape-validate the JSON `changeset status --output` writes. This
 * never trusts the file blindly: a missing `releases` array, or a release
 * entry missing `name`/`type`, is treated the same as invalid JSON — all of
 * it means the plan can't be relied on.
 *
 * @param {string} rawText
 * @returns {{ releases: Array<{ name: string, type: string, oldVersion: string, newVersion: string }> }}
 */
export function parseReleasePlanJson(rawText) {
  let parsed
  try {
    parsed = JSON.parse(rawText)
  } catch (error) {
    throw new Error(
      `release plan output is not valid JSON (${error instanceof Error ? error.message : String(error)})`,
    )
  }

  if (parsed === null || typeof parsed !== 'object' || !Array.isArray(parsed.releases)) {
    throw new Error('release plan JSON has no `releases` array')
  }
  for (const release of parsed.releases) {
    if (typeof release?.name !== 'string' || typeof release?.type !== 'string') {
      throw new Error('release plan JSON contains a release entry missing `name`/`type`')
    }
  }
  return parsed
}

/**
 * Run `changeset status --output=<file>` and return the parsed, validated
 * release plan. `runChangesetStatus` is injectable so self-test can exercise
 * every indeterminate path (binary exits non-zero, output file never
 * written, output file empty/malformed) without shelling out for real.
 *
 * @param {{ repoRoot: string, runChangesetStatus?: (repoRoot: string, outFileRelative: string) => void }} params
 * @returns {{ releases: Array<{ name: string, type: string, oldVersion: string, newVersion: string }> }}
 */
export function loadReleasePlan({ repoRoot, runChangesetStatus = runChangesetStatusForReal }) {
  // `changeset status --output` resolves relative to `cwd`, so the arg and
  // the path we read back must agree on that relative form.
  const outFileRelative = join(
    'tmp',
    `major-bump-guard-${String(process.pid)}-${String(Date.now())}.json`,
  )
  const outFile = join(repoRoot, outFileRelative)
  mkdirSync(join(repoRoot, 'tmp'), { recursive: true })
  try {
    runChangesetStatus(repoRoot, outFileRelative)

    let rawText
    try {
      rawText = readFileSync(outFile, 'utf8')
    } catch (error) {
      throw new Error(
        `release plan output file was not produced (${error instanceof Error ? error.message : String(error)})`,
      )
    }
    return parseReleasePlanJson(rawText)
  } finally {
    rmSync(outFile, { force: true })
  }
}

function runChangesetStatusForReal(repoRoot, outFileRelative) {
  const changesetBin = join(repoRoot, 'node_modules', '.bin', 'changeset')
  execFileSync(changesetBin, ['status', `--output=${outFileRelative}`], {
    cwd: repoRoot,
    stdio: ['ignore', 'ignore', 'inherit'],
  })
}

/**
 * Build the message shown when the guard could not compute a release plan
 * at all — e.g. `changeset status` exited non-zero, or produced no/malformed
 * output. This must never be confused with "a major bump was found": it's
 * the opposite problem, an inability to certify anything either way, and it
 * must fail closed rather than silently pass with an empty major-bump list.
 *
 * @param {unknown} error
 * @returns {string}
 */
export function formatCouldNotVerifyMessage(error) {
  const reason = error instanceof Error ? error.message : String(error)

  return [
    'Major version bump guard could not verify the release plan.',
    '',
    'This is NOT a report that a major bump was found. It means the guard was unable to',
    'compute the changeset release plan at all, so it cannot certify that no major/1.0 bump',
    'is present. An indeterminate result must be treated as a failure, not a pass — silently',
    'passing here is exactly the failure mode this guard exists to prevent.',
    '',
    `Reason: ${reason}`,
    '',
    'Common causes: `changeset status` could not resolve the merge-base against the base',
    'branch (e.g. a shallow git checkout with no local `main` ref/history available), the',
    '`changeset` CLI is missing or crashed, or its JSON output was empty/malformed.',
    '',
    'Fix the underlying `changeset status` failure (see the reason above) and re-run this',
    'check — do not bypass it based on this message alone.',
  ].join('\n')
}

function runRealCheck() {
  const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

  let releasePlan
  try {
    releasePlan = loadReleasePlan({ repoRoot })
  } catch (error) {
    console.error(formatCouldNotVerifyMessage(error))
    process.exit(1)
  }

  const majorBumps = findMajorBumps(releasePlan)

  if (majorBumps.length > 0) {
    console.error(formatFailureMessage(majorBumps))
    process.exit(1)
  }

  console.log('No major version bumps found in the computed changeset release plan.')
}

function runSelfTest() {
  const onlyMinorAndPatchPlan = {
    releases: [
      { name: '@attest-it/core', type: 'minor', oldVersion: '0.10.1', newVersion: '0.11.0' },
      { name: '@attest-it/cli', type: 'minor', oldVersion: '0.10.1', newVersion: '0.11.0' },
      { name: 'attest-it', type: 'minor', oldVersion: '0.10.1', newVersion: '0.11.0' },
      {
        name: '@attest-it/example-embedder',
        type: 'patch',
        oldVersion: '0.0.0',
        newVersion: '0.0.1',
      },
      { name: '@attest-it/github-action', type: 'none', oldVersion: '0.0.1', newVersion: '0.0.1' },
    ],
  }

  // Mirrors what `changeset status` actually reports for this repo's `linked`
  // config: a `major` changeset on one package in the group propagates to
  // every package in it, so the computed plan lists all three as `major`.
  const linkedMajorPlan = {
    releases: [
      { name: '@attest-it/cli', type: 'major', oldVersion: '0.10.1', newVersion: '1.0.0' },
      { name: 'attest-it', type: 'major', oldVersion: '0.10.1', newVersion: '1.0.0' },
      { name: '@attest-it/core', type: 'major', oldVersion: '0.10.1', newVersion: '1.0.0' },
      {
        name: '@attest-it/example-embedder',
        type: 'patch',
        oldVersion: '0.0.0',
        newVersion: '0.0.1',
      },
    ],
  }

  const cases = [
    {
      name: 'plan with only minor/patch bumps passes',
      plan: onlyMinorAndPatchPlan,
      expectedNames: [],
    },
    {
      name: 'plan with a major bump on a linked group is detected as affecting all linked packages',
      plan: linkedMajorPlan,
      expectedNames: ['@attest-it/cli', 'attest-it', '@attest-it/core'],
    },
  ]

  let failed = false
  for (const testCase of cases) {
    const majorBumps = findMajorBumps(testCase.plan)
    const gotNames = majorBumps.map((r) => r.name)
    const ok =
      gotNames.length === testCase.expectedNames.length &&
      testCase.expectedNames.every((name) => gotNames.includes(name))
    console.log(
      `${ok ? 'PASS' : 'FAIL'}: ${testCase.name} — expected=[${testCase.expectedNames.join(', ')}], got=[${gotNames.join(', ')}]`,
    )
    if (!ok) failed = true
  }

  // Negative test: the failure message must name every offending package, not
  // just report a bare exit code — the message is the deliverable (issue #154).
  const message = formatFailureMessage(findMajorBumps(linkedMajorPlan))
  const namesAllPresent = ['@attest-it/cli', 'attest-it', '@attest-it/core'].every((name) =>
    message.includes(name),
  )
  console.log(`${namesAllPresent ? 'PASS' : 'FAIL'}: failure message names every offending package`)
  if (!namesAllPresent) failed = true

  const mentions1_0 = message.includes('1.0')
  console.log(`${mentions1_0 ? 'PASS' : 'FAIL'}: failure message names the 1.0 target`)
  if (!mentions1_0) failed = true

  // Indeterminate paths: the guard must fail closed on each of these — never
  // fall through to "no major bumps found" — and the failure must use the
  // distinct could-not-verify message, not the major-bump-found message.
  const indeterminateCases = [
    {
      name: 'changeset status exits non-zero',
      runChangesetStatus: () => {
        throw new Error('simulated: changeset status exited with code 1')
      },
    },
    {
      name: 'plan file is never written',
      runChangesetStatus: () => {
        // Succeeds but writes nothing — mirrors a `changeset` version that
        // silently drops --output, or a permissions failure that doesn't throw.
      },
    },
    {
      name: 'plan file is empty',
      runChangesetStatus: (repoRoot, outFileRelative) => {
        writeFileSync(join(repoRoot, outFileRelative), '')
      },
    },
    {
      name: 'plan file is malformed JSON',
      runChangesetStatus: (repoRoot, outFileRelative) => {
        writeFileSync(join(repoRoot, outFileRelative), '{ not valid json')
      },
    },
    {
      name: 'plan file is valid JSON but missing `releases`',
      runChangesetStatus: (repoRoot, outFileRelative) => {
        writeFileSync(join(repoRoot, outFileRelative), JSON.stringify({ changesets: [] }))
      },
    },
  ]

  for (const testCase of indeterminateCases) {
    const scratchRepoRoot = mkdtempSync(join(tmpdir(), 'major-bump-guard-self-test-'))
    let threw = false
    let usedCouldNotVerifyMessage = false
    try {
      loadReleasePlan({
        repoRoot: scratchRepoRoot,
        runChangesetStatus: testCase.runChangesetStatus,
      })
    } catch (error) {
      threw = true
      // formatCouldNotVerifyMessage must be able to render this error without
      // throwing itself, and the rendered message must be distinguishable
      // from "a major bump was found".
      const message = formatCouldNotVerifyMessage(error)
      usedCouldNotVerifyMessage =
        message.includes('could not verify') &&
        !message.includes('Major version bump guard failed.')
    } finally {
      rmSync(scratchRepoRoot, { recursive: true, force: true })
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
