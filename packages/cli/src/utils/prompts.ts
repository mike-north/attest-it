import { confirm } from '@inquirer/prompts'
import { getTheme, BOX_CHARS } from '../components/theme.js'

export interface ConfirmOptions {
  message: string
  default?: boolean
}

/**
 * Display a visually distinctive confirmation prompt.
 *
 * Creates a styled box with yellow border to make the attestation prompt
 * stand out from test output.
 */
export async function confirmAction(options: ConfirmOptions): Promise<boolean> {
  const theme = getTheme()

  // Build the styled prompt box
  const defaultIndicator = options.default ? '(Y/n)' : '(y/N)'
  const message = `${options.message}? ${defaultIndicator}`
  const boxWidth = Math.max(message.length + 2, 40)
  const contentPadding = ' '.repeat(boxWidth - message.length - 1)

  // Box drawing with yellow border
  const topBorder = theme.yellow(`${BOX_CHARS.topLeft}${BOX_CHARS.horizontal.repeat(boxWidth)}${BOX_CHARS.topRight}`)
  const bottomBorder = theme.yellow(`${BOX_CHARS.bottomLeft}${BOX_CHARS.horizontal.repeat(boxWidth)}${BOX_CHARS.bottomRight}`)

  // Content line with yellow border and normal text
  const contentLine = theme.yellow(BOX_CHARS.vertical) +
                      ` ${message}${contentPadding}` +
                      theme.yellow(BOX_CHARS.vertical)

  // Display the styled box
  console.log('')
  console.log(topBorder)
  console.log(contentLine)
  console.log(bottomBorder)
  console.log('')

  // Get the actual confirmation
  return confirm({
    message: '', // Empty message since we displayed it above
    default: options.default ?? false,
    theme: {
      prefix: '', // Remove default prefix
    },
  })
}
