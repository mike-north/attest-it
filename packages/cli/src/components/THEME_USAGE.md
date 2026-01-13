# Theme Module Usage

This module provides centralized theme utilities for ink components.

## Importing

```typescript
import {
  getStatusDisplay,
  STATUS_DISPLAY,
  BOX_CHARS,
  COLUMN_WIDTHS,
  getTheme,
  initTheme,
  type StatusDisplay,
  type Theme,
} from './theme.js'
```

## Status Display

The `getStatusDisplay()` function maps verification statuses to display configuration:

```tsx
import { Text } from 'ink'
import { getStatusDisplay } from './theme.js'

function StatusBadge({ status }: { status: string }) {
  const display = getStatusDisplay(status)

  return (
    <Text color={display.color} bold={display.bold}>
      {display.symbol} {display.label}
    </Text>
  )
}

// Usage
<StatusBadge status="VALID" />
// Renders: ✓ VALID (in green)

<StatusBadge status="NEEDS_ATTESTATION" />
// Renders: ○ MISSING (in yellow)

<StatusBadge status="SIGNATURE_INVALID" />
// Renders: ✗ INVALID (in red, bold)
```

## Status Display Configuration

All verification statuses have predefined display configurations:

```typescript
STATUS_DISPLAY.VALID
// { label: 'VALID', color: 'green', symbol: '✓' }

STATUS_DISPLAY.NEEDS_ATTESTATION
// { label: 'MISSING', color: 'yellow', symbol: '○' }

STATUS_DISPLAY.FINGERPRINT_CHANGED
// { label: 'CHANGED', color: 'yellow', symbol: '⚠' }

STATUS_DISPLAY.EXPIRED
// { label: 'STALE', color: 'red', symbol: '⚠' }

STATUS_DISPLAY.SIGNATURE_INVALID
// { label: 'INVALID', color: 'red', bold: true, symbol: '✗' }

STATUS_DISPLAY.INVALIDATED_BY_PARENT
// { label: 'PARENT_INVALID', color: 'red', symbol: '✗' }
```

Unknown statuses get a safe default:

```typescript
getStatusDisplay('UNKNOWN_STATUS')
// { label: 'UNKNOWN_STATUS', color: 'white', symbol: '?' }
```

## Box Drawing Characters

Use `BOX_CHARS` for consistent table borders:

```tsx
import { Box, Text } from 'ink'
import { BOX_CHARS } from './theme.js'

function TableHeader() {
  return (
    <Text>
      {BOX_CHARS.topLeft}
      {BOX_CHARS.horizontal.repeat(50)}
      {BOX_CHARS.topRight}
    </Text>
  )
}
```

Available characters:

- `BOX_CHARS.topLeft` → ┌
- `BOX_CHARS.topRight` → ┐
- `BOX_CHARS.bottomLeft` → └
- `BOX_CHARS.bottomRight` → ┘
- `BOX_CHARS.horizontal` → ─
- `BOX_CHARS.vertical` → │
- `BOX_CHARS.cross` → ┼

## Column Widths

Use `COLUMN_WIDTHS` for consistent table layout:

```typescript
COLUMN_WIDTHS.checkbox // 3  - for "[ ]" or "[x]"
COLUMN_WIDTHS.status // 14 - for status labels
COLUMN_WIDTHS.suite // 25 - for suite names
COLUMN_WIDTHS.reason // 30 - for reason text
```

Example:

```tsx
function TableRow({ selected, status, suite, reason }) {
  return (
    <Box>
      <Box width={COLUMN_WIDTHS.checkbox}>
        <Text>{selected ? '[x]' : '[ ]'}</Text>
      </Box>
      <Box width={COLUMN_WIDTHS.status}>
        <StatusBadge status={status} />
      </Box>
      <Box width={COLUMN_WIDTHS.suite}>
        <Text>{suite}</Text>
      </Box>
      <Box width={COLUMN_WIDTHS.reason}>
        <Text>{reason}</Text>
      </Box>
    </Box>
  )
}
```

## Theme Initialization

The theme should be initialized early in your application:

```typescript
import { initTheme } from './components/theme.js'

async function main() {
  // Initialize theme to detect terminal colors
  await initTheme()

  // Rest of your application
}
```

## Using the Theme

Access the chromaterm theme for custom colorization:

```typescript
import { getTheme } from './components/theme.js'

const theme = getTheme()

console.log(theme.success('Operation completed!'))
console.log(theme.error('Something went wrong'))
console.log(theme.red.bold()('Critical error'))
```

## TypeScript Types

The module exports TypeScript types for type-safe usage:

```typescript
import type { StatusDisplay, Theme } from './theme.js'

function processStatus(display: StatusDisplay) {
  console.log(display.label) // string
  console.log(display.color) // string
  console.log(display.symbol) // string
  console.log(display.bold) // boolean | undefined
}
```

## Design Philosophy

This module centralizes all styling decisions to:

1. **Consistency**: All components use the same colors and symbols for the same statuses
2. **Maintainability**: Change appearance in one place to update everywhere
3. **Type Safety**: TypeScript ensures correct usage throughout the codebase
4. **Extensibility**: Easy to add new statuses or adjust existing ones

## Adding New Statuses

To add a new verification status:

1. Add it to the `VerificationStatus` type in `@attest-it/core`
2. Add its display configuration to `STATUS_DISPLAY`:

```typescript
export const STATUS_DISPLAY: Record<string, StatusDisplay> = {
  // ... existing statuses
  NEW_STATUS: {
    label: 'NEW',
    color: 'blue',
    symbol: '◆',
    bold: true,
  },
}
```

3. Write tests for the new status in `theme.test.ts`
