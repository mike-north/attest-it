/**
 * Regression tests for #81: the documented exit-code contract must match the
 * actual `ExitCode` enum. Prior to this fix, `AI_ASSISTANT_GUIDE.md` and
 * `docs/configuration.md` described a distinct "no gates / no config" exit code
 * of 2 under invented constant names (`NO_GATES`, `KEY_ERROR`) that don't exist
 * in `packages/cli/src/utils/exit-codes.ts`. These tests parse the documented
 * tables and pin every row to the real enum value, so the docs can't silently
 * drift from the implementation again.
 *
 * Extended for #95: exit code 3 (`CONFIG_ERROR`) was overloaded across "no
 * config found" (correct), a cancelled prompt (should be `CANCELLED`), and a
 * dirty working tree (should be its own code). `CANCELLED` was already
 * documented and is covered by the existing per-row pin below; the new
 * `DIRTY_WORKING_TREE` code added for the dirty-tree case is covered the same
 * way, and the row-count/enum-membership assertions below now require both
 * to be present and correctly mapped.
 *
 * Extended for #100: #98 documented `CANCELLED` (4) as reachable by a
 * declined prompt and by Ctrl-C, but neither path actually produced it (a
 * declined prompt exited `SUCCESS`; a raw `SIGINT` fell through to Node's
 * default, uncaught-signal termination, not a clean `process.exit`). Both
 * docs also described "a piped stdin that closes mid-prompt" without
 * distinguishing it from the separate "missing required flag, no TTY" path,
 * which has always been (and remains) `CONFIG_ERROR`. These tests pin the
 * prose to the decisions made for #100 so it can't silently drift from
 * reachable behavior again: a declined prompt and Ctrl-C are both
 * `CANCELLED`; a missing flag on non-interactive stdin is `CONFIG_ERROR`.
 *
 * @see ../src/utils/exit-codes.ts
 * @see ../src/commands/run.ts
 * @see ../src/index.ts
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ExitCode } from '../src/utils/exit-codes.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(__dirname, '../../..')

interface DocumentedRow {
  code: number
  constant: string
}

/**
 * Extract `| <code> | <CONSTANT_NAME> | ... |` rows from a markdown table.
 * Skips the header and separator rows.
 */
function parseExitCodeTable(markdown: string): DocumentedRow[] {
  const rows: DocumentedRow[] = []
  const rowPattern = /^\|\s*(\d+)\s*\|\s*([A-Z_]+)\s*\|/gm
  for (const match of markdown.matchAll(rowPattern)) {
    const [, codeStr, constant] = match
    if (codeStr && constant) {
      rows.push({ code: Number(codeStr), constant })
    }
  }
  return rows
}

const EXIT_CODE_BY_NAME: Record<string, number> = ExitCode

describe('exit-code documentation matches the ExitCode enum (#81)', () => {
  it('the enum itself has the seven documented members', () => {
    expect(ExitCode).toStrictEqual({
      SUCCESS: 0,
      FAILURE: 1,
      NO_WORK: 2,
      CONFIG_ERROR: 3,
      CANCELLED: 4,
      MISSING_KEY: 5,
      DIRTY_WORKING_TREE: 6,
    })
  })

  it('AI_ASSISTANT_GUIDE.md exit-code table matches the enum exactly', () => {
    const doc = readFileSync(join(REPO_ROOT, 'AI_ASSISTANT_GUIDE.md'), 'utf8')
    const section = doc.split('## Exit Codes')[1]?.split(/\n## /)[0]
    if (!section) {
      throw new Error('Could not find "## Exit Codes" section in AI_ASSISTANT_GUIDE.md')
    }

    const rows = parseExitCodeTable(section)
    expect(rows.length).toBe(7)

    for (const row of rows) {
      expect(EXIT_CODE_BY_NAME[row.constant], `documented constant "${row.constant}"`).toBe(
        row.code,
      )
    }

    // Every enum member must be documented — a new code added to the enum
    // without a doc update should fail this test, not just the reverse.
    const documentedNames = new Set(rows.map((r) => r.constant))
    for (const name of Object.keys(ExitCode)) {
      expect(documentedNames.has(name), `enum member "${name}" documented`).toBe(true)
    }
  })

  it('docs/configuration.md exit-code table matches the enum exactly', () => {
    const doc = readFileSync(join(REPO_ROOT, 'docs/configuration.md'), 'utf8')
    const section = doc.split('### Exit Codes')[1]?.split(/\n#{2,3} /)[0]
    if (!section) {
      throw new Error('Could not find "### Exit Codes" section in docs/configuration.md')
    }

    const rows = parseExitCodeTable(section)
    expect(rows.length).toBe(7)

    for (const row of rows) {
      expect(EXIT_CODE_BY_NAME[row.constant], `documented constant "${row.constant}"`).toBe(
        row.code,
      )
    }

    const documentedNames = new Set(rows.map((r) => r.constant))
    for (const name of Object.keys(ExitCode)) {
      expect(documentedNames.has(name), `enum member "${name}" documented`).toBe(true)
    }
  })

  it('CANCELLED (4) is distinct from CONFIG_ERROR (3) -- issue #95', () => {
    // A cancelled prompt (declined or force-closed/interrupted) must never
    // collapse onto the same code as "no configuration found".
    expect(ExitCode.CANCELLED).toBe(4)
    expect(ExitCode.CANCELLED).not.toBe(ExitCode.CONFIG_ERROR)
  })

  it('DIRTY_WORKING_TREE (6) is distinct from CONFIG_ERROR (3) -- issue #95', () => {
    // A dirty working tree is a precondition failure on valid configuration,
    // not a configuration error -- it must not share CONFIG_ERROR's code.
    expect(ExitCode.DIRTY_WORKING_TREE).toBe(6)
    expect(ExitCode.DIRTY_WORKING_TREE).not.toBe(ExitCode.CONFIG_ERROR)
  })

  it.each([
    ['AI_ASSISTANT_GUIDE.md', join(REPO_ROOT, 'AI_ASSISTANT_GUIDE.md')],
    ['docs/configuration.md', join(REPO_ROOT, 'docs/configuration.md')],
  ])(
    '%s documents a declined prompt and Ctrl-C as CANCELLED, and a missing flag on ' +
      'non-interactive stdin as CONFIG_ERROR -- issue #100',
    (_label, docPath) => {
      const doc = readFileSync(docPath, 'utf8')

      // Declining a confirmation must be documented as reachable CANCELLED,
      // not folded silently into "force-closed" language that could be
      // misread as excluding an explicit "n" answer.
      expect(doc).toMatch(/declin(e|es|ed|ing)/i)

      // Ctrl-C must be documented as CANCELLED (4). Some prose contrasts this
      // with the shell's conventional 130 to make reachability unambiguous
      // (e.g. "not the shell's conventional 130") -- that's fine as long as
      // it's phrased as a rejection, not a claim that 130 is what happens.
      expect(doc).toContain('Ctrl-C')
      const ctrlCContext = doc.slice(
        Math.max(0, doc.indexOf('Ctrl-C') - 200),
        doc.indexOf('Ctrl-C') + 200,
      )
      expect(ctrlCContext).toMatch(/CANCELLED/)
      if (/\b130\b/.test(ctrlCContext)) {
        expect(ctrlCContext).toMatch(/not[\s\S]{0,40}?130/)
      }

      // The missing-flag/non-interactive case must be pinned to CONFIG_ERROR,
      // not left implying CANCELLED.
      expect(doc).toMatch(/missing (a )?required flag/i)
      const missingFlagIndex = doc.search(/missing (a )?required flag/i)
      const missingFlagContext = doc.slice(missingFlagIndex, missingFlagIndex + 400)
      expect(missingFlagContext).toMatch(/CONFIG_ERROR/)
    },
  )
})
