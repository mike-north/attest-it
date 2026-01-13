import React from 'react'
import { Box, Text } from 'ink'
import { StatusBadge } from './StatusBadge.js'
import type { VerificationStatus } from '@attest-it/core'

/**
 * Information about a single suite for display in the table.
 * @public
 */
export interface SuiteInfo {
  /** Suite name */
  name: string
  /** Current verification status */
  status: VerificationStatus
  /** Human-readable reason (e.g., "32 days old (max: 30)") */
  reason: string
  /** Days since attestation (if exists) */
  age?: number | undefined
}

/**
 * Props for the SuiteTable component.
 * @public
 */
export interface SuiteTableProps {
  /** List of suites to display */
  suites: SuiteInfo[]
  /** Show checkbox column for selection */
  selectable?: boolean | undefined
  /** Currently selected suite names */
  selected?: Set<string> | undefined
}

/**
 * Displays suites in a table format with status badges.
 *
 * Example output:
 * ```
 *    Status           Suite                 Reason
 *    ──────────────────────────────────────────────────────────
 *    [ ] STALE        visual-effects        32 days old (max: 30)
 *    [ ] MISSING      focus-detection       No attestation found
 * ```
 *
 * @param props - Component props
 * @returns React element
 * @public
 */
export function SuiteTable({
  suites,
  selectable = false,
  selected = new Set(),
}: SuiteTableProps): React.ReactElement {
  // Calculate column widths
  const columnWidths = calculateColumnWidths(suites, selectable)

  return (
    <Box flexDirection="column">
      {/* Header */}
      <Box>
        {selectable && <Text>{' '.repeat(4)}</Text>}
        <Text bold>{padEnd('Status', columnWidths.status)}</Text>
        <Text> </Text>
        <Text bold>{padEnd('Suite', columnWidths.suite)}</Text>
        <Text> </Text>
        <Text bold>Reason</Text>
      </Box>

      {/* Separator */}
      <Box>
        <Text color="gray">
          {'─'.repeat(
            (selectable ? 4 : 0) + columnWidths.status + columnWidths.suite + columnWidths.reason,
          )}
        </Text>
      </Box>

      {/* Rows */}
      {suites.map((suite) => (
        <Box key={suite.name}>
          {selectable && <Text>{selected.has(suite.name) ? '[✓] ' : '[ ] '}</Text>}
          <Box width={columnWidths.status}>
            <StatusBadge status={suite.status} />
          </Box>
          <Text> </Text>
          <Text>{padEnd(suite.name, columnWidths.suite)}</Text>
          <Text> </Text>
          <Text color="gray">{suite.reason}</Text>
        </Box>
      ))}
    </Box>
  )
}

/**
 * Column width information.
 * @internal
 */
interface ColumnWidths {
  status: number
  suite: number
  reason: number
}

/**
 * Calculate column widths based on content.
 * @internal
 */
function calculateColumnWidths(suites: SuiteInfo[], _selectable: boolean): ColumnWidths {
  const statusHeader = 'Status'
  const suiteHeader = 'Suite'
  const reasonHeader = 'Reason'

  // Status column - fixed width for badges
  // Maximum status badge length is "INVALIDATED" (11 chars) + "✓ " (2 chars) = 13
  const statusWidth = Math.max(statusHeader.length, 13)

  // Suite column - max of header and all suite names
  const suiteWidth = Math.max(suiteHeader.length, ...suites.map((s) => s.name.length))

  // Reason column - max of header and all reasons
  const reasonWidth = Math.max(reasonHeader.length, ...suites.map((s) => s.reason.length))

  return {
    status: statusWidth,
    suite: suiteWidth,
    reason: reasonWidth,
  }
}

/**
 * Pad a string to the right with spaces.
 * @internal
 */
function padEnd(str: string, width: number): string {
  return str.padEnd(width, ' ')
}
