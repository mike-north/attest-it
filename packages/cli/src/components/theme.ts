/**
 * Theme utilities for ink components.
 * Provides access to chromaterm theme and shared styling constants.
 */

import { detectTheme, type Theme } from 'chromaterm'

/**
 * Status display configuration.
 */
export interface StatusDisplay {
  /** Text to display */
  label: string
  /** Ink color name */
  color: string
  /** Whether to apply bold */
  bold?: boolean
  /** Symbol to show before label */
  symbol?: string
}

/**
 * Map verification status to display configuration.
 */
export const STATUS_DISPLAY: Record<string, StatusDisplay> = {
  VALID: {
    label: 'VALID',
    color: 'green',
    symbol: '✓',
  },
  NEEDS_ATTESTATION: {
    label: 'MISSING',
    color: 'yellow',
    symbol: '○',
  },
  FINGERPRINT_CHANGED: {
    label: 'CHANGED',
    color: 'yellow',
    symbol: '⚠',
  },
  EXPIRED: {
    label: 'STALE',
    color: 'red',
    symbol: '⚠',
  },
  SIGNATURE_INVALID: {
    label: 'INVALID',
    color: 'red',
    bold: true,
    symbol: '✗',
  },
  INVALIDATED_BY_PARENT: {
    label: 'PARENT_INVALID',
    color: 'red',
    symbol: '✗',
  },
}

/**
 * Box drawing characters for consistent UI.
 */
export const BOX_CHARS = {
  topLeft: '┌',
  topRight: '┐',
  bottomLeft: '└',
  bottomRight: '┘',
  horizontal: '─',
  vertical: '│',
  cross: '┼',
} as const

/**
 * Common column widths for table display.
 */
export const COLUMN_WIDTHS = {
  checkbox: 3, // [ ] or [x]
  status: 14, // MISSING, CHANGED, PARENT_INVALID, etc.
  suite: 25, // Suite name
  reason: 30, // Reason text
} as const

// Theme singleton - will be initialized lazily if not explicitly initialized
let theme: Theme | undefined

/**
 * Initialize the color theme by detecting the terminal theme.
 * Must be called before using any color functions.
 */
export async function initTheme(): Promise<void> {
  theme = await detectTheme()
}

/**
 * Get the theme, initializing it synchronously if needed (for tests).
 * Uses a fallback no-op theme if async initialization hasn't been called.
 */
export function getTheme(): Theme {
  if (!theme) {
    // Fallback for tests or when initTheme() wasn't called
    // This creates a simple pass-through theme that returns strings unchanged
    const noopFn = (str: string) => str
    const chainable = () => noopFn
    // Type assertion is required here because we're creating a mock Theme object
    // for testing/fallback purposes. The chromaterm Theme type has complex
    // chainable methods that we're approximating with simple functions.
    // This is safe because all methods accept and return strings.
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- Required to create mock theme for testing
    theme = {
      red: Object.assign(noopFn, { bold: chainable, dim: chainable }),
      green: Object.assign(noopFn, { bold: chainable, dim: chainable }),
      yellow: Object.assign(noopFn, { bold: chainable, dim: chainable }),
      blue: Object.assign(noopFn, { bold: chainable, dim: chainable }),
      success: noopFn,
      error: noopFn,
      warning: noopFn,
      info: noopFn,
      muted: noopFn,
    } as unknown as Theme
  }
  return theme
}

/**
 * Get display configuration for a verification status.
 * Returns a default for unknown statuses.
 */
export function getStatusDisplay(status: string): StatusDisplay {
  return (
    // eslint-disable-next-line security/detect-object-injection -- status is a user-controlled string, but we provide a safe default for unknown values
    STATUS_DISPLAY[status] ?? {
      label: status,
      color: 'white',
      symbol: '?',
    }
  )
}
