import { detectTheme, type Theme } from 'chromaterm'

export interface OutputOptions {
  verbose?: boolean
  quiet?: boolean
  json?: boolean
}

// Singleton for global output options
let globalOptions: OutputOptions = {}

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
function getTheme(): Theme {
  if (!theme) {
    // Fallback for tests or when initTheme() wasn't called
    // This creates a simple pass-through theme that returns strings unchanged
    const noopFn = (str: string) => str
    const chainable = () => noopFn
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- Required mock theme for testing/fallback when async init not called
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

export function setOutputOptions(options: OutputOptions): void {
  globalOptions = options
}

export function getOutputOptions(): OutputOptions {
  return globalOptions
}

// Logging functions
export function log(message: string): void {
  if (!globalOptions.quiet) {
    console.log(message)
  }
}

export function verbose(message: string): void {
  if (globalOptions.verbose && !globalOptions.quiet) {
    console.log(getTheme().muted(message))
  }
}

export function success(message: string): void {
  log(getTheme().success('✓ ' + message))
}

export function error(message: string): void {
  console.error(getTheme().error('✗ ' + message))
}

export function warn(message: string): void {
  if (!globalOptions.quiet) {
    console.warn(getTheme().warning('⚠ ' + message))
  }
}

export function info(message: string): void {
  log(getTheme().info('ℹ ' + message))
}

// Table formatting for status display
export interface TableRow {
  suite: string
  status: string
  fingerprint: string
  age: string
}

export function formatTable(rows: TableRow[]): string {
  // Calculate column widths
  const headers = ['Suite', 'Status', 'Fingerprint', 'Age']

  // Helper to get row values in consistent order
  const getRowValues = (row: TableRow): string[] => [
    row.suite,
    row.status,
    row.fingerprint,
    row.age,
  ]

  const widths = headers.map((h, i) => {
    const columnValues = rows.map((r) => {
      const values = getRowValues(r)
      // eslint-disable-next-line security/detect-object-injection -- i is from .map() index
      return values[i] ?? ''
    })
    const maxValueLength = Math.max(...columnValues.map((v) => v.length), 0)
    return Math.max(h.length, maxValueLength)
  })

  // Build table
  const separator = '─'
  const lines: string[] = []

  // Header
  // eslint-disable-next-line security/detect-object-injection -- i is from .map() index
  lines.push(headers.map((h, i) => h.padEnd(widths[i] ?? 0)).join(' │ '))
  lines.push(widths.map((w) => separator.repeat(w)).join('─┼─'))

  // Rows
  for (const row of rows) {
    const values = getRowValues(row)
    // eslint-disable-next-line security/detect-object-injection -- i is from .map() index
    lines.push(values.map((v, i) => v.padEnd(widths[i] ?? 0)).join(' │ '))
  }

  return lines.join('\n')
}

// Status colorization
export function colorizeStatus(status: string): string {
  const t = getTheme()
  switch (status) {
    case 'VALID':
      return t.green(status)
    case 'NEEDS_ATTESTATION':
    case 'FINGERPRINT_CHANGED':
      return t.yellow(status)
    case 'EXPIRED':
    case 'INVALIDATED_BY_PARENT':
      return t.red(status)
    case 'SIGNATURE_INVALID':
      return t.red.bold()(status)
    default:
      return status
  }
}

// JSON output
export function outputJson(data: unknown): void {
  console.log(JSON.stringify(data, null, 2))
}
