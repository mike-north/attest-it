import { confirm, input, select } from '@inquirer/prompts'

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

export interface SelectOptions<T extends string> {
  message: string
  choices: { value: T; name: string; description?: string }[]
}

export async function selectOption<T extends string>(options: SelectOptions<T>): Promise<T> {
  return select({
    message: options.message,
    choices: options.choices,
  })
}

export interface InputOptions {
  message: string
  default?: string
  validate?: (value: string) => boolean | string
}

export async function getInput(options: InputOptions): Promise<string> {
  const inputConfig: {
    message: string
    default?: string
    validate?: (value: string) => boolean | string
  } = {
    message: options.message,
  }

  if (options.default !== undefined) {
    inputConfig.default = options.default
  }

  if (options.validate !== undefined) {
    inputConfig.validate = options.validate
  }

  return input(inputConfig)
}
