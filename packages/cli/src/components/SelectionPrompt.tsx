import * as React from 'react'
import { Box, Text, useInput } from 'ink'

interface SelectionOption {
  /** Display label */
  label: string
  /** Value returned when selected */
  value: string
  /** Optional keyboard shortcut hint */
  hint?: string
}

/**
 * Group option with a keyboard shortcut.
 */
interface GroupOption {
  /** Keyboard shortcut (e.g., "g1") */
  name: string
  /** Group display name */
  label: string
  /** Optional description (e.g., "select all in unit-tests") */
  description?: string | undefined
}

export interface SelectionPromptProps {
  /** Question to display */
  message: string
  /** Available options */
  options: SelectionOption[]
  /** Callback when option selected */
  onSelect: (value: string) => void
  /** Show group options if available */
  groups?: GroupOption[] | undefined
}

/**
 * Displays a selection prompt with keyboard hints.
 *
 * Example output:
 * Select suites to run:
 *   [a] All pending    [1-4] By number    [n] None/exit
 *   [g1] ui-tests      [g2] behavior-tests
 */
export function SelectionPrompt({
  message,
  options,
  onSelect,
  groups,
}: SelectionPromptProps): React.ReactElement {
  useInput((input) => {
    // Check if input matches any option's hint
    const matchedOption = options.find((opt) => opt.hint === input)
    if (matchedOption) {
      onSelect(matchedOption.value)
      return
    }

    // Check if input matches a group name
    if (groups) {
      const matchedGroup = groups.find((group) => group.name === input)
      if (matchedGroup) {
        onSelect(matchedGroup.name)
      }
    }
  })

  return (
    <Box flexDirection="column">
      <Text bold>{message}</Text>
      <Box marginTop={1} gap={2}>
        {options.map((option) => (
          <Text key={option.value}>
            {option.hint && (
              <>
                <Text color="cyan">[{option.hint}]</Text>{' '}
              </>
            )}
            {option.label}
          </Text>
        ))}
      </Box>
      {groups && groups.length > 0 && (
        <Box marginTop={1} flexDirection="column">
          <Text dimColor>Groups (type shortcut to select all suites in group):</Text>
          <Box gap={3} marginTop={1}>
            {groups.map((group) => (
              <Text key={group.name}>
                <Text color="cyan">[{group.name}]</Text> {group.label}
                {group.description && <Text dimColor> - {group.description}</Text>}
              </Text>
            ))}
          </Box>
        </Box>
      )}
    </Box>
  )
}
