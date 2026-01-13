import * as React from 'react'
import { Box, Text } from 'ink'

export interface HeaderProps {
  /** Number of suites needing attestation */
  pendingCount: number
}

/**
 * Displays a header box with pending suite count.
 *
 * Example output:
 * ┌─────────────────────────────────────────────────────────────┐
 * │  4 suites need attestation                                  │
 * └─────────────────────────────────────────────────────────────┘
 */
export function Header({ pendingCount }: HeaderProps): React.ReactElement {
  const message = `${pendingCount.toString()} suite${pendingCount === 1 ? '' : 's'} need${pendingCount === 1 ? 's' : ''} attestation`

  return (
    <Box borderStyle="single" paddingX={1}>
      <Text>{message}</Text>
    </Box>
  )
}
