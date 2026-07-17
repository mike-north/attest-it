import { Command } from 'commander'
import { loadLocalConfig } from '@attest-it/core'
import { log, error } from '../../utils/output.js'
import { ExitCode } from '../../utils/exit-codes.js'
import { getTheme } from '../../components/theme.js'
import { stringify as stringifyYaml } from 'yaml'

export const exportCommand = new Command('export')
  .description('Export identity for team onboarding (YAML snippet)')
  .argument('[slug]', 'Identity slug to export (defaults to active identity)')
  .action(async (slug?: string) => {
    await runExport(slug)
  })

/**
 * Run the export command to output a YAML snippet for the project's policy file.
 * @public
 */
export async function runExport(slug?: string): Promise<void> {
  try {
    const config = await loadLocalConfig()

    if (!config) {
      error('No identities configured')
      process.exit(ExitCode.CONFIG_ERROR)
    }

    const theme = getTheme()

    // Determine which identity to export
    const targetSlug = slug ?? config.activeIdentity

    const identity = config.identities[targetSlug]
    if (!identity) {
      error(`Identity "${targetSlug}" not found`)
      process.exit(ExitCode.CONFIG_ERROR)
    }

    log('')
    log(theme.blue.bold()('Team Configuration YAML:'))
    log('')
    log(theme.muted('# Add this to your project policy file (.attest-it/policy.yaml)'))
    log('')

    // Build export object (only include fields that are present)
    const exportData: Record<string, unknown> = {
      name: identity.name,
      publicKey: identity.publicKey,
    }

    if (identity.email) {
      exportData.email = identity.email
    }

    if (identity.github) {
      exportData.github = identity.github
    }

    // Create YAML with slug as key
    const yamlData = {
      [targetSlug]: exportData,
    }

    const yamlString = stringifyYaml(yamlData)

    log(yamlString)
    log('')
    log(theme.muted('# The team owner can add this to the "team:" section'))
    log('')
  } catch (err) {
    if (err instanceof Error) {
      error(err.message)
    } else {
      error('Unknown error occurred')
    }
    process.exit(ExitCode.CONFIG_ERROR)
  }
}
