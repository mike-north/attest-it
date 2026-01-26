#!/usr/bin/env npx tsx
/**
 * Dogfood wrapper script for running attest-it manual tests.
 *
 * This script runs `attest-it run` with ATTEST_IT_ALLOW_DIRTY=1 to bypass
 * the dirty working tree check. This is needed when dogfooding the tool
 * while actively developing it.
 *
 * Seals are created using your real identity from ~/.config/attest-it/config.yaml.
 *
 * Usage:
 *   pnpm dogfood:run
 *   pnpm dogfood:run -- --filter 1password*
 */

import { spawn } from 'node:child_process'

/**
 * Run attest-it with ATTEST_IT_ALLOW_DIRTY to bypass dirty working tree check.
 */
async function runAttestIt(args: string[]): Promise<number> {
  return new Promise((resolve) => {
    console.log('Running attest-it run with ATTEST_IT_ALLOW_DIRTY=1...\n')

    const child = spawn('pnpm', ['attest-it', 'run', ...args], {
      stdio: 'inherit',
      env: {
        ...process.env,
        ATTEST_IT_ALLOW_DIRTY: '1',
      },
    })

    child.on('close', (code) => {
      resolve(code ?? 1)
    })

    child.on('error', (err) => {
      console.error(`Failed to run attest-it: ${err.message}`)
      resolve(1)
    })
  })
}

/**
 * Main entry point.
 */
async function main(): Promise<void> {
  // Get any additional args to pass to attest-it run
  const args = process.argv.slice(2)

  const exitCode = await runAttestIt(args)

  // Exit code 2 means "no work to do" (all suites valid) - treat as success for dogfooding
  if (exitCode === 2) {
    process.exit(0)
  }
  process.exit(exitCode)
}

void main()
