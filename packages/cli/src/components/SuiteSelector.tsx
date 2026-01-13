import * as React from 'react'
import { Box, Text, useInput } from 'ink'
import { Header } from './Header.js'
import { SuiteTable } from './SuiteTable.js'
import { SelectionPrompt } from './SelectionPrompt.js'
import type { SuiteStatus } from '../commands/run-utils.js'

interface SuiteSelectorProps {
  /** All suites needing attestation */
  pendingSuites: SuiteStatus[]
  /** Valid suites (for "Already valid" display) */
  validSuites: SuiteStatus[]
  /** Available groups from config */
  groups?: Record<string, string[]> | undefined
  /** Called when user confirms selection */
  onSelect: (selectedSuites: string[]) => void
  /** Called when user exits */
  onExit: () => void
}

/**
 * Main suite selection UI component.
 *
 * Displays:
 * 1. Header with pending count
 * 2. Table of pending suites with checkboxes
 * 3. List of already valid suites
 * 4. Selection prompt with keyboard shortcuts
 *
 * Keyboard controls:
 * - a: Select all pending
 * - n: None/exit
 * - 1-9: Toggle individual suite by number
 * - g1, g2, etc: Select group (if groups available)
 * - Enter: Confirm selection
 * - Space: Toggle current suite
 * - Up/Down: Navigate
 */
export function SuiteSelector({
  pendingSuites,
  validSuites,
  groups,
  onSelect,
  onExit,
}: SuiteSelectorProps): React.ReactElement {
  const [selectedSuites, setSelectedSuites] = React.useState<Set<string>>(new Set())
  const [cursorIndex, setCursorIndex] = React.useState(0)

  /**
   * Toggle suite selection state
   */
  const toggleSuite = React.useCallback((suiteName: string) => {
    setSelectedSuites((prev) => {
      const next = new Set(prev)
      if (next.has(suiteName)) {
        next.delete(suiteName)
      } else {
        next.add(suiteName)
      }
      return next
    })
  }, [])

  useInput((input, key) => {
    // 'a' - select all pending
    if (input === 'a') {
      setSelectedSuites(new Set(pendingSuites.map((s) => s.name)))
      return
    }

    // 'n' - none/exit
    if (input === 'n') {
      onExit()
      return
    }

    // Numbers 1-9 - toggle by number
    if (/^[1-9]$/.test(input)) {
      const idx = parseInt(input, 10) - 1
      if (idx < pendingSuites.length) {
        // eslint-disable-next-line security/detect-object-injection -- idx is bounds-checked against pendingSuites.length
        const suite = pendingSuites[idx]
        if (suite) {
          toggleSuite(suite.name)
        }
      }
      return
    }

    // Handle group shortcuts like 'g1', 'g2'
    if (input.startsWith('g') && groups) {
      const groupIdx = parseInt(input.slice(1), 10) - 1
      const groupNames = Object.keys(groups)
      if (groupIdx >= 0 && groupIdx < groupNames.length) {
        // eslint-disable-next-line security/detect-object-injection -- groupIdx is bounds-checked against groupNames.length
        const groupName = groupNames[groupIdx]
        if (groupName) {
          // eslint-disable-next-line security/detect-object-injection -- groupName is from Object.keys, so it's safe
          const groupSuites: string[] = groups[groupName] ?? []
          // Add all suites in this group to selection
          const newSelected = new Set(selectedSuites)
          groupSuites.forEach((s: string) => newSelected.add(s))
          setSelectedSuites(newSelected)
        }
      }
      return
    }

    // Enter - confirm selection
    if (key.return) {
      onSelect(Array.from(selectedSuites))
      return
    }

    // Space - toggle current
    if (input === ' ') {
      // eslint-disable-next-line security/detect-object-injection -- cursorIndex is bounds-checked via Math.min/Math.max
      const currentSuite = pendingSuites[cursorIndex]
      if (currentSuite) {
        toggleSuite(currentSuite.name)
      }
      return
    }

    // Arrow navigation
    if (key.upArrow) {
      setCursorIndex(Math.max(0, cursorIndex - 1))
      return
    }
    if (key.downArrow) {
      setCursorIndex(Math.min(pendingSuites.length - 1, cursorIndex + 1))
      return
    }
  })

  return (
    <Box flexDirection="column">
      {/* Header showing pending count */}
      <Header pendingCount={pendingSuites.length} />

      <Box marginY={1}>
        {/* Table of pending suites with numbers and checkboxes */}
        <SuiteTable suites={pendingSuites} selectable={true} selected={selectedSuites} />
      </Box>

      {/* Show valid suites if any */}
      {validSuites.length > 0 && (
        <Box marginY={1} flexDirection="column">
          <Text dimColor>Already valid:</Text>
          {validSuites.map((s) => (
            <Text key={s.name} dimColor>
              {'  '}✓ {s.name} (attested {String(s.age ?? 0)} days ago)
            </Text>
          ))}
        </Box>
      )}

      {/* Selection prompt */}
      <SelectionPrompt
        message="Select suites to run:"
        options={[
          { label: 'All pending', value: 'all', hint: 'a' },
          { label: 'By number', value: 'number', hint: '1-9' },
          { label: 'None/exit', value: 'none', hint: 'n' },
        ]}
        groups={
          groups
            ? Object.keys(groups).map((name, i) => ({
                name: `g${String(i + 1)}`,
                label: name,
              }))
            : undefined
        }
        onSelect={() => {
          /* Handled by useInput */
        }}
      />

      {/* Current selection count */}
      <Text color="cyan">{selectedSuites.size} selected. Press Enter to confirm.</Text>
    </Box>
  )
}
