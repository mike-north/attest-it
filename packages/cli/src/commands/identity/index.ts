import { Command } from 'commander'
import { listCommand } from './list.js'
import { createCommand } from './create.js'
import { useCommand } from './use.js'
import { showCommand } from './show.js'
import { removeCommand } from './remove.js'
import { exportCommand } from './export.js'
import { migrateCommand } from './migrate.js'

export const identityCommand = new Command('identity')
  .description('Manage local identities and keypairs')
  .addCommand(listCommand)
  .addCommand(createCommand)
  .addCommand(useCommand)
  .addCommand(showCommand)
  .addCommand(removeCommand)
  .addCommand(exportCommand)
  .addCommand(migrateCommand)
