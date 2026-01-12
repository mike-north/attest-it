import { confirm } from '@inquirer/prompts'

export interface ConfirmOptions {
  message: string
  default?: boolean
}

export async function confirmAction(options: ConfirmOptions): Promise<boolean> {
  return confirm({
    message: options.message,
    default: options.default ?? false,
  })
}
