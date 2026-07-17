/**
 * Regression tests for #81: the documented exit-code contract must match the
 * actual `ExitCode` enum. Prior to this fix, `AI_ASSISTANT_GUIDE.md` and
 * `docs/configuration.md` described a distinct "no gates / no config" exit code
 * of 2 under invented constant names (`NO_GATES`, `KEY_ERROR`) that don't exist
 * in `packages/cli/src/utils/exit-codes.ts`. These tests parse the documented
 * tables and pin every row to the real enum value, so the docs can't silently
 * drift from the implementation again.
 *
 * @see ../src/utils/exit-codes.ts
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
  it('the enum itself has the six documented members', () => {
    expect(ExitCode).toStrictEqual({
      SUCCESS: 0,
      FAILURE: 1,
      NO_WORK: 2,
      CONFIG_ERROR: 3,
      CANCELLED: 4,
      MISSING_KEY: 5,
    })
  })

  it('AI_ASSISTANT_GUIDE.md exit-code table matches the enum exactly', () => {
    const doc = readFileSync(join(REPO_ROOT, 'AI_ASSISTANT_GUIDE.md'), 'utf8')
    const section = doc.split('## Exit Codes')[1]?.split(/\n## /)[0]
    if (!section) {
      throw new Error('Could not find "## Exit Codes" section in AI_ASSISTANT_GUIDE.md')
    }

    const rows = parseExitCodeTable(section)
    expect(rows.length).toBe(6)

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
    expect(rows.length).toBe(6)

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
})
