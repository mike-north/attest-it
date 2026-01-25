#!/usr/bin/env npx tsx
/**
 * Dogfood wrapper script for running attest-it manual tests.
 *
 * This script creates an ephemeral test identity fixture, then runs
 * `attest-it run` with ATTEST_IT_HOME pointing to that fixture.
 * This allows the outer seal creation to use a test identity instead
 * of the user's real identity.
 *
 * The keypair used here matches the `dogfood-test` identity in the
 * project's .attest-it/config.yaml. This is a test-only key with no
 * security implications.
 *
 * Usage:
 *   pnpm dogfood:run
 *   pnpm dogfood:run -- --filter 1password*
 */

import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { spawn } from 'node:child_process'

/**
 * Static keypair for dogfood testing.
 * This matches the dogfood-test identity in .attest-it/config.yaml.
 * This is a test-only key - do not use for real attestations.
 */
const DOGFOOD_PRIVATE_KEY = `-----BEGIN PRIVATE KEY-----
MC4CAQAwBQYDK2VwBCIEIEjLNhIiBOcm9b1dnsvNbRVcjn+LRD36hVph2PR3oE/D
-----END PRIVATE KEY-----
`

const DOGFOOD_PUBLIC_KEY = 'NVLUus5VrRJvQsux1EJxrGCeg7xkAdthX5Z983Iy5Ac='

/**
 * Create a temporary identity fixture directory.
 * Returns the path to the fixture directory.
 */
function createIdentityFixture(): string {
  // Create temp directory
  const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'attest-it-dogfood-'))

  // Write private key to filesystem
  const privateKeyPath = path.join(fixtureDir, 'private.pem')
  fs.writeFileSync(privateKeyPath, DOGFOOD_PRIVATE_KEY, { mode: 0o600 })

  // Create identity config.yaml
  const configYaml = `activeIdentity: dogfood-test
identities:
  dogfood-test:
    name: Dogfood Test Identity
    publicKey: ${DOGFOOD_PUBLIC_KEY}
    privateKey:
      type: file
      path: ${privateKeyPath}
`
  fs.writeFileSync(path.join(fixtureDir, 'config.yaml'), configYaml)

  console.log(`Created dogfood identity fixture at: ${fixtureDir}`)

  return fixtureDir
}

/**
 * Run attest-it with the dogfood identity fixture.
 */
async function runWithFixture(fixtureDir: string, args: string[]): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn('pnpm', ['attest-it', 'run', ...args], {
      stdio: 'inherit',
      env: {
        ...process.env,
        ATTEST_IT_HOME: fixtureDir,
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
 * Clean up the fixture directory.
 */
function cleanupFixture(fixtureDir: string): void {
  try {
    fs.rmSync(fixtureDir, { recursive: true, force: true })
    console.log(`Cleaned up fixture: ${fixtureDir}`)
  } catch (err) {
    console.warn(`Failed to clean up fixture: ${err instanceof Error ? err.message : String(err)}`)
  }
}

/**
 * Main entry point.
 */
async function main(): Promise<void> {
  // Get any additional args to pass to attest-it run
  const args = process.argv.slice(2)

  // Create the identity fixture
  const fixtureDir = createIdentityFixture()

  // Ensure cleanup on exit
  const cleanup = () => cleanupFixture(fixtureDir)
  process.on('SIGINT', () => {
    cleanup()
    process.exit(130)
  })
  process.on('SIGTERM', () => {
    cleanup()
    process.exit(143)
  })

  try {
    // Run attest-it with the fixture
    const exitCode = await runWithFixture(fixtureDir, args)
    cleanup()
    process.exit(exitCode)
  } catch (err) {
    console.error(`Error: ${err instanceof Error ? err.message : String(err)}`)
    cleanup()
    process.exit(1)
  }
}

void main()
