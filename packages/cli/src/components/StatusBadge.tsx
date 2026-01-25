import React from 'react'
import { Text } from 'ink'
import type { VerificationState } from '@attest-it/core'

/**
 * Props for the StatusBadge component.
 * @public
 */
export interface StatusBadgeProps {
  /** The verification status to display */
  status: VerificationState
}

/**
 * Displays a colored badge for suite verification status.
 *
 * Status colors:
 * - VALID: green
 * - MISSING: yellow
 * - FINGERPRINT_MISMATCH: yellow (display as "CHANGED")
 * - STALE: red
 * - INVALID_SIGNATURE: red bold (display as "INVALID")
 * - UNKNOWN_SIGNER: red (display as "UNAUTHORIZED")
 *
 * @param props - Component props
 * @returns React element
 * @public
 */
export function StatusBadge({ status }: StatusBadgeProps): React.ReactElement {
  // Map status to display text and color
  const statusConfig = getStatusConfig(status)

  // Only pass bold prop if it's true to avoid exactOptionalPropertyTypes issues
  if (statusConfig.bold) {
    return (
      <Text color={statusConfig.color} bold>
        {statusConfig.text}
      </Text>
    )
  }

  return <Text color={statusConfig.color}>{statusConfig.text}</Text>
}

/**
 * Get display configuration for a verification status.
 * @internal
 */
interface StatusConfig {
  text: string
  color: 'green' | 'yellow' | 'red'
  bold?: boolean
}

/**
 * Get display configuration for a verification status.
 * @internal
 */
function getStatusConfig(status: VerificationState): StatusConfig {
  switch (status) {
    case 'VALID':
      return { text: '✓ VALID', color: 'green' }
    case 'MISSING':
      return { text: 'MISSING', color: 'yellow' }
    case 'FINGERPRINT_MISMATCH':
      return { text: 'CHANGED', color: 'yellow' }
    case 'STALE':
      return { text: 'STALE', color: 'red' }
    case 'INVALID_SIGNATURE':
      return { text: 'INVALID', color: 'red', bold: true }
    case 'UNKNOWN_SIGNER':
      return { text: 'UNAUTHORIZED', color: 'red' }
    default: {
      // Exhaustive check
      const _exhaustive: never = status
      return { text: String(_exhaustive), color: 'yellow' }
    }
  }
}
