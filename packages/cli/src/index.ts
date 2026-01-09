import { Command } from 'commander'
import { initCommand } from './commands/init.js'
import { statusCommand } from './commands/status.js'
import { runCommand } from './commands/run.js'
import { keygenCommand } from './commands/keygen.js'
import { pruneCommand } from './commands/prune.js'
import { verifyCommand } from './commands/verify.js'
import { setOutputOptions } from './utils/output.js'

const program = new Command()

program
  .name('attest-it')
  .description('Human-gated test attestation system')
  .version('0.0.1')
  .option('-c, --config <path>', 'Path to config file')
  .option('-v, --verbose', 'Verbose output')
  .option('-q, --quiet', 'Minimal output')

// Register commands
program.addCommand(initCommand)
program.addCommand(statusCommand)
program.addCommand(runCommand)
program.addCommand(keygenCommand)
program.addCommand(pruneCommand)
program.addCommand(verifyCommand)

export function run(): void {
  // Parse options and set global output options
  program.parse()
  const options = program.opts<{ verbose?: boolean; quiet?: boolean }>()

  const outputOptions: { verbose?: boolean; quiet?: boolean } = {}
  if (options.verbose !== undefined) {
    outputOptions.verbose = options.verbose
  }
  if (options.quiet !== undefined) {
    outputOptions.quiet = options.quiet
  }

  setOutputOptions(outputOptions)
}

export { program }
