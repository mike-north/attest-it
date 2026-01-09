import pc from 'picocolors'

export interface OutputOptions {
  verbose?: boolean
  quiet?: boolean
  json?: boolean
}

// Singleton for global output options
let globalOptions: OutputOptions = {}

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
    console.log(pc.dim(message))
  }
}

export function success(message: string): void {
  log(pc.green('✓ ' + message))
}

export function error(message: string): void {
  console.error(pc.red('✗ ' + message))
}

export function warn(message: string): void {
  if (!globalOptions.quiet) {
    console.warn(pc.yellow('⚠ ' + message))
  }
}

export function info(message: string): void {
  log(pc.blue('ℹ ' + message))
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
  switch (status) {
    case 'VALID':
      return pc.green(status)
    case 'NEEDS_ATTESTATION':
    case 'FINGERPRINT_CHANGED':
      return pc.yellow(status)
    case 'EXPIRED':
    case 'INVALIDATED_BY_PARENT':
      return pc.red(status)
    case 'SIGNATURE_INVALID':
      return pc.red(pc.bold(status))
    default:
      return status
  }
}

// JSON output
export function outputJson(data: unknown): void {
  console.log(JSON.stringify(data, null, 2))
}
