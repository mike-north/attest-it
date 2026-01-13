# Terminal UI Components

React components for terminal UI using [ink](https://github.com/vadimdemedes/ink).

## Components

### StatusBadge

Displays a colored badge for suite verification status.

**Usage:**

```tsx
import { StatusBadge } from './components/StatusBadge.js'

<StatusBadge status="VALID" />
// Renders: ✓ VALID (in green)

<StatusBadge status="EXPIRED" />
// Renders: STALE (in red)
```

**Props:**

- `status: VerificationStatus` - The verification status to display

**Status Mapping:**

| Status                | Display     | Color      |
| --------------------- | ----------- | ---------- |
| VALID                 | ✓ VALID     | green      |
| NEEDS_ATTESTATION     | MISSING     | yellow     |
| FINGERPRINT_CHANGED   | CHANGED     | yellow     |
| EXPIRED               | STALE       | red        |
| SIGNATURE_INVALID     | INVALID     | red (bold) |
| INVALIDATED_BY_PARENT | INVALIDATED | red        |

### SuiteTable

Displays suites in a table format with status badges.

**Usage:**

```tsx
import { SuiteTable } from './components/SuiteTable.js'

const suites = [
  {
    name: 'visual-effects',
    status: 'EXPIRED',
    reason: '32 days old (max: 30)',
    age: 32,
  },
  {
    name: 'focus-detection',
    status: 'NEEDS_ATTESTATION',
    reason: 'No attestation found',
  },
]

// Basic table
<SuiteTable suites={suites} />

// Selectable table with checkboxes
<SuiteTable
  suites={suites}
  selectable={true}
  selected={new Set(['visual-effects'])}
/>
```

**Props:**

- `suites: SuiteInfo[]` - List of suites to display
- `selectable?: boolean` - Show checkbox column for selection (default: `false`)
- `selected?: Set<string>` - Currently selected suite names (default: empty set)

**SuiteInfo Type:**

```typescript
interface SuiteInfo {
  name: string // Suite name
  status: VerificationStatus // Current verification status
  reason: string // Human-readable reason
  age?: number // Days since attestation (if exists)
}
```

**Example Output:**

```
   Status           Suite                 Reason
   ──────────────────────────────────────────────────────────
   STALE            visual-effects        32 days old (max: 30)
   MISSING          focus-detection       No attestation found
   ✓ VALID          unit-tests            All checks passed
```

**With Selection:**

```
      Status           Suite                 Reason
   ──────────────────────────────────────────────────────────
   [✓] STALE            visual-effects        32 days old (max: 30)
   [ ] MISSING          focus-detection       No attestation found
   [✓] ✓ VALID          unit-tests            All checks passed
```

## Implementation Notes

### Color Support

Components use ink's built-in `color` prop for terminal color support. Colors automatically adapt to the terminal's theme.

### Type Safety

All components are fully typed with TypeScript and use proper types from `@attest-it/core`.

### Testing

Components are tested using `ink-testing-library` with comprehensive test coverage including:

- Positive test cases (expected behavior)
- Negative test cases (edge cases, empty data)
- Component lifecycle (updates, unmounting)
- All verification status variants

## Future Enhancements

When `@inkjs/ui` is added to dependencies, these components can be enhanced with:

- Pre-built `Badge` component for more consistent styling
- `Spinner` component for loading states
- `ProgressBar` for long-running operations
- Theme support via `ThemeProvider`
