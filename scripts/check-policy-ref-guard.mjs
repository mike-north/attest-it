#!/usr/bin/env node
/**
 * Guards against the class of bug fixed in issue #74: a workflow that gates
 * a REAL .attest-it/policy.yaml passing an explicit `policy-ref` input to the
 * attest-it GitHub Action. That input overrides the Action's safe default
 * (base-branch policy fetch in PR context — see
 * packages/github-action/src/index.ts and fetch-policy.ts), letting a PR
 * author supply their own edited policy.yaml instead of the trusted
 * base-branch version.
 *
 * Scope: only workflows explicitly opted in via the `attest-it-guard:
 * real-policy-gate` marker comment are checked. This keeps the guard narrow —
 * it must never block the legitimate `policy-ref` override in
 * test-attest-it.yml, which only exercises the Action against fixtures that
 * carry no real trust value.
 *
 * Usage:
 *   node scripts/check-policy-ref-guard.mjs             # check real workflow files
 *   node scripts/check-policy-ref-guard.mjs --self-test  # verify the guard's own logic
 */

import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const GUARD_MARKER = 'attest-it-guard: real-policy-gate'
// Case-insensitive and tolerant of a quoted key (single or double quotes) so a
// human-written variant like `"policy-ref":` or `Policy-Ref:` can't slip past
// the guard. YAML keys are technically case-sensitive, but this is a
// defense-in-depth check, not a YAML parser — it must catch every way a
// human might write this key, not just the canonical unquoted lowercase form.
const POLICY_REF_PATTERN = /^\s*["']?policy-ref["']?\s*:/i

/**
 * Find policy-ref violations in a single workflow file's content.
 *
 * A violation is any `policy-ref:` line in a file that carries the
 * `attest-it-guard: real-policy-gate` opt-in marker.
 *
 * @param {string} content - Full text content of the workflow YAML file.
 * @param {string} name - File name/path, used only for reporting.
 * @returns {{ file: string, line: number, text: string }[]} Violations found.
 */
export function findViolations(content, name) {
  if (!content.includes(GUARD_MARKER)) {
    return []
  }

  const violations = []
  const lines = content.split('\n')
  for (const [index, line] of lines.entries()) {
    if (POLICY_REF_PATTERN.test(line)) {
      violations.push({ file: name, line: index + 1, text: line.trim() })
    }
  }
  return violations
}

function runSelfTest() {
  const OLD_WORKFLOW_WITH_OVERRIDE = `name: Verify Manual Test Attestations
# attest-it-guard: real-policy-gate
on:
  pull_request:
jobs:
  verify:
    steps:
      - uses: ./packages/github-action
        with:
          policy-ref: \${{ github.head_ref }}
`

  const FIXED_WORKFLOW = `name: Verify Manual Test Attestations
# attest-it-guard: real-policy-gate
on:
  pull_request:
jobs:
  verify:
    steps:
      - uses: ./packages/github-action
        with:
          config-path: .attest-it/config.yaml
`

  const UNMARKED_FIXTURE_WORKFLOW = `name: Test attest-it Action
on:
  pull_request:
jobs:
  test:
    steps:
      - uses: ./packages/github-action
        with:
          policy-ref: \${{ github.head_ref }}
`

  const QUOTED_KEY_WORKFLOW = `name: Verify Manual Test Attestations
# attest-it-guard: real-policy-gate
on:
  pull_request:
jobs:
  verify:
    steps:
      - uses: ./packages/github-action
        with:
          "policy-ref": \${{ github.head_ref }}
`

  const UPPERCASED_KEY_WORKFLOW = `name: Verify Manual Test Attestations
# attest-it-guard: real-policy-gate
on:
  pull_request:
jobs:
  verify:
    steps:
      - uses: ./packages/github-action
        with:
          Policy-Ref: \${{ github.head_ref }}
`

  const cases = [
    {
      name: 'old workflow with reinstated override',
      content: OLD_WORKFLOW_WITH_OVERRIDE,
      expectViolation: true,
    },
    { name: 'fixed workflow', content: FIXED_WORKFLOW, expectViolation: false },
    {
      name: 'unmarked fixture workflow',
      content: UNMARKED_FIXTURE_WORKFLOW,
      expectViolation: false,
    },
    {
      name: 'quoted-key override',
      content: QUOTED_KEY_WORKFLOW,
      expectViolation: true,
    },
    {
      name: 'uppercased-key override',
      content: UPPERCASED_KEY_WORKFLOW,
      expectViolation: true,
    },
  ]

  let failed = false
  for (const testCase of cases) {
    const violations = findViolations(testCase.content, testCase.name)
    const gotViolation = violations.length > 0
    const ok = gotViolation === testCase.expectViolation
    console.log(
      `${ok ? 'PASS' : 'FAIL'}: ${testCase.name} — expected violation=${String(testCase.expectViolation)}, got=${String(gotViolation)}`,
    )
    if (!ok) failed = true
  }

  if (failed) {
    console.error('\nSelf-test failed: guard logic does not match expected behavior.')
    process.exit(1)
  }
  console.log(
    '\nSelf-test passed: guard correctly flags the regressed pattern and allows the fixed/fixture patterns.',
  )
}

function runRealCheck() {
  const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
  const workflowsDir = join(repoRoot, '.github', 'workflows')
  const workflowFiles = readdirSync(workflowsDir).filter(
    (f) => f.endsWith('.yml') || f.endsWith('.yaml'),
  )

  const allViolations = []
  for (const file of workflowFiles) {
    const content = readFileSync(join(workflowsDir, file), 'utf8')
    allViolations.push(...findViolations(content, `.github/workflows/${file}`))
  }

  if (allViolations.length > 0) {
    console.error('policy-ref guard violation(s) found:\n')
    for (const v of allViolations) {
      console.error(`  ${v.file}:${String(v.line)}: ${v.text}`)
    }
    console.error(
      '\nA workflow marked `attest-it-guard: real-policy-gate` must never pass an explicit ' +
        '`policy-ref` input — doing so lets a PR author supply their own policy.yaml instead of ' +
        'the trusted base-branch version. See issue #74.',
    )
    process.exit(1)
  }

  console.log(
    `No policy-ref guard violations found across ${String(workflowFiles.length)} workflow file(s).`,
  )
}

const args = process.argv.slice(2)
if (args.includes('--self-test')) {
  runSelfTest()
} else {
  runRealCheck()
}
