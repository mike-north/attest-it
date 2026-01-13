import * as React from 'react'
import { Box, Text } from 'ink'

export interface ProgressSummaryProps {
  /** Number of suites completed successfully */
  completed: number
  /** Number of suites remaining to run */
  remaining: number
  /** Number of suites that failed */
  failed: number
  /** Number of suites skipped by user */
  skipped: number
}

/**
 * Displays a summary box showing test run progress.
 *
 * Example output:
 * ┌─────────────────────────────────────────────────────────────┐
 * │  Completed: 2    Remaining: 2    Failed: 0    Skipped: 0    │
 * └─────────────────────────────────────────────────────────────┘
 */
export function ProgressSummary({
  completed,
  remaining,
  failed,
  skipped,
}: ProgressSummaryProps): React.ReactElement {
  return (
    <Box borderStyle="single" paddingX={1}>
      <Text>
        <Text color="green">Completed: {completed}</Text>
        {'    '}
        <Text color="yellow">Remaining: {remaining}</Text>
        {'    '}
        <Text color="red">Failed: {failed}</Text>
        {'    '}
        <Text color="gray">Skipped: {skipped}</Text>
      </Text>
    </Box>
  )
}
