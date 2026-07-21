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
import { mkdirSync, readFileSync, rmSync } from 'node:fs'
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

function getReleasePlan(repoRoot) {
  const changesetBin = join(repoRoot, 'node_modules', '.bin', 'changeset')
  // `changeset status --output` resolves relative to `cwd`, so the arg and
  // the path we read back must agree on that relative form.
  const outFileRelative = join(
    'tmp',
    `major-bump-guard-${String(process.pid)}-${String(Date.now())}.json`,
  )
  const outFile = join(repoRoot, outFileRelative)
  mkdirSync(join(repoRoot, 'tmp'), { recursive: true })
  try {
    execFileSync(changesetBin, ['status', `--output=${outFileRelative}`], {
      cwd: repoRoot,
      stdio: ['ignore', 'ignore', 'inherit'],
    })
    return JSON.parse(readFileSync(outFile, 'utf8'))
  } finally {
    rmSync(outFile, { force: true })
  }
}

function runRealCheck() {
  const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
  const releasePlan = getReleasePlan(repoRoot)
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
