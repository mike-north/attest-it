import { Command } from 'commander'
import { listCommand } from './list.js'
import { addCommand } from './add.js'
import { joinCommand } from './join.js'
import { removeCommand } from './remove.js'

export const teamCommand = new Command('team')
  .description('Manage team members and authorizations')
  .addCommand(listCommand)
  .addCommand(addCommand)
  .addCommand(joinCommand)
  .addCommand(removeCommand)
