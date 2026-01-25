#!/usr/bin/env npx tsx
/**
 * Dogfood wrapper script for running attest-it manual tests.
 *
 * This script:
 * 1. Generates an ephemeral Ed25519 keypair
 * 2. Adds the test identity to the project's .attest-it/config.yaml
 *    (team section + authorizedSigners for all gates)
 * 3. Creates an identity fixture in a temp directory
 * 4. Runs `attest-it run` with ATTEST_IT_HOME pointing to the fixture
 * 5. Cleans up: removes identity from project config, deletes temp fixture
 *
 * This simulates the flow of a new team member being added, without
 * requiring a real credential store or permanent config changes.
 *
 * Usage:
 *   pnpm dogfood:run
 *   pnpm dogfood:run -- --filter 1password*
 */

import * as crypto from 'node:crypto'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { spawn } from 'node:child_process'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'

const IDENTITY_SLUG = 'dogfood-test'
const IDENTITY_NAME = 'Dogfood Test Identity'
const PROJECT_CONFIG_PATH = '.attest-it/config.yaml'

interface ProjectConfig {
  version: number
  settings: Record<string, unknown>
  team: Record<string, { name: string; publicKey: string }>
  gates: Record<string, { authorizedSigners: string[]; [key: string]: unknown }>
  suites: Record<string, unknown>
  groups?: Record<string, string[]>
}

interface DogfoodContext {
  fixtureDir: string
  publicKeyBase64: string
  originalConfig: string
}

/**
 * Generate an Ed25519 keypair.
 */
function generateKeypair(): { privateKeyPem: string; publicKeyBase64: string } {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519')

  // Export private key as PEM
  const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string

  // Export public key as raw bytes then base64 (to match attest-it format)
  const publicKeyDer = publicKey.export({ type: 'spki', format: 'der' })
  // Ed25519 SPKI is 44 bytes: 12 byte header + 32 byte key. Extract the raw key.
  const rawKeyBytes = publicKeyDer.subarray(12)
  const publicKeyBase64 = rawKeyBytes.toString('base64')

  return { privateKeyPem, publicKeyBase64 }
}

/**
 * Add the dogfood identity to the project config.
 */
function addIdentityToProjectConfig(publicKeyBase64: string): string {
  const configPath = path.resolve(PROJECT_CONFIG_PATH)
  const originalConfig = fs.readFileSync(configPath, 'utf8')

  const config = parseYaml(originalConfig) as ProjectConfig

  // Add to team section
  config.team[IDENTITY_SLUG] = {
    name: IDENTITY_NAME,
    publicKey: publicKeyBase64,
  }

  // Add to authorizedSigners for all gates
  for (const gateId of Object.keys(config.gates)) {
    const gate = config.gates[gateId]
    if (!gate.authorizedSigners.includes(IDENTITY_SLUG)) {
      gate.authorizedSigners.push(IDENTITY_SLUG)
    }
  }

  // Write updated config
  fs.writeFileSync(configPath, stringifyYaml(config))
  console.log(`Added ${IDENTITY_SLUG} to project config`)

  return originalConfig
}

/**
 * Restore the original project config.
 */
function restoreProjectConfig(originalConfig: string): void {
  const configPath = path.resolve(PROJECT_CONFIG_PATH)
  fs.writeFileSync(configPath, originalConfig)
  console.log('Restored original project config')
}

/**
 * Create a temporary identity fixture directory.
 */
function createIdentityFixture(
  privateKeyPem: string,
  publicKeyBase64: string,
): string {
  // Create temp directory
  const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'attest-it-dogfood-'))

  // Write private key to filesystem
  const privateKeyPath = path.join(fixtureDir, 'private.pem')
  fs.writeFileSync(privateKeyPath, privateKeyPem, { mode: 0o600 })

  // Create identity config.yaml
  const configYaml = `activeIdentity: ${IDENTITY_SLUG}
identities:
  ${IDENTITY_SLUG}:
    name: ${IDENTITY_NAME}
    publicKey: ${publicKeyBase64}
    privateKey:
      type: file
      path: ${privateKeyPath}
`
  fs.writeFileSync(path.join(fixtureDir, 'config.yaml'), configYaml)

  console.log(`Created identity fixture at: ${fixtureDir}`)

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
 * Clean up all dogfood artifacts.
 */
function cleanup(ctx: DogfoodContext): void {
  // Restore project config
  try {
    restoreProjectConfig(ctx.originalConfig)
  } catch (err) {
    console.warn(`Failed to restore project config: ${err instanceof Error ? err.message : String(err)}`)
  }

  // Remove fixture directory
  try {
    fs.rmSync(ctx.fixtureDir, { recursive: true, force: true })
    console.log(`Cleaned up fixture: ${ctx.fixtureDir}`)
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

  console.log('Setting up dogfood test identity...\n')

  // Generate keypair
  const { privateKeyPem, publicKeyBase64 } = generateKeypair()
  console.log(`Generated keypair with public key: ${publicKeyBase64}`)

  // Add identity to project config
  const originalConfig = addIdentityToProjectConfig(publicKeyBase64)

  // Create the identity fixture
  const fixtureDir = createIdentityFixture(privateKeyPem, publicKeyBase64)

  const ctx: DogfoodContext = {
    fixtureDir,
    publicKeyBase64,
    originalConfig,
  }

  // Ensure cleanup on exit
  const doCleanup = () => cleanup(ctx)
  process.on('SIGINT', () => {
    console.log('\nInterrupted, cleaning up...')
    doCleanup()
    process.exit(130)
  })
  process.on('SIGTERM', () => {
    console.log('\nTerminated, cleaning up...')
    doCleanup()
    process.exit(143)
  })

  console.log('\nStarting attest-it run...\n')

  try {
    // Run attest-it with the fixture
    const exitCode = await runWithFixture(fixtureDir, args)
    doCleanup()
    process.exit(exitCode)
  } catch (err) {
    console.error(`Error: ${err instanceof Error ? err.message : String(err)}`)
    doCleanup()
    process.exit(1)
  }
}

void main()
