import React from 'react'
import { Text } from 'ink'
import type { VerificationStatus } from '@attest-it/core'

/**
 * Props for the StatusBadge component.
 * @public
 */
export interface StatusBadgeProps {
  /** The verification status to display */
  status: VerificationStatus
}

/**
 * Displays a colored badge for suite verification status.
 *
 * Status colors:
 * - VALID: green
 * - NEEDS_ATTESTATION: yellow (display as "MISSING")
 * - FINGERPRINT_CHANGED: yellow (display as "CHANGED")
 * - EXPIRED: red (display as "STALE")
 * - SIGNATURE_INVALID: red bold
 * - INVALIDATED_BY_PARENT: red (display as "INVALIDATED")
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
function getStatusConfig(status: VerificationStatus): StatusConfig {
  switch (status) {
    case 'VALID':
      return { text: '✓ VALID', color: 'green' }
    case 'NEEDS_ATTESTATION':
      return { text: 'MISSING', color: 'yellow' }
    case 'FINGERPRINT_CHANGED':
      return { text: 'CHANGED', color: 'yellow' }
    case 'EXPIRED':
      return { text: 'STALE', color: 'red' }
    case 'SIGNATURE_INVALID':
      return { text: 'INVALID', color: 'red', bold: true }
    case 'INVALIDATED_BY_PARENT':
      return { text: 'INVALIDATED', color: 'red' }
    default: {
      // Exhaustive check
      const _exhaustive: never = status
      return { text: String(_exhaustive), color: 'yellow' }
    }
  }
}
