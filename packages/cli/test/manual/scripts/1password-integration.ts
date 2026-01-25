#!/usr/bin/env tsx
/**
 * 1Password Integration Test
 *
 * This script exercises the full end-to-end flow with a real 1Password vault,
 * creating an ephemeral Level 1 test seal and verifying it works correctly.
 *
 * Test Flow:
 * 1. Check `op` CLI is installed
 * 2. List and select 1Password account
 * 3. List and select vault for test key storage
 * 4. Create ephemeral test identity with 1Password key provider
 * 5. Generate keypair and store private key in 1Password
 * 6. Set up minimal test project with a simple gate
 * 7. Create a test seal using the 1Password-stored key
 * 8. Verify the seal passes validation
 * 9. Cleanup: delete test item from 1Password, remove temp directory
 * 10. Print success/failure summary
 *
 * Usage:
 *   pnpm tsx test/manual/scripts/1password-integration.ts [--no-cleanup]
 *
 * Options:
 *   --no-cleanup  Keep the test item in 1Password and temp project for inspection
 */

import { OnePasswordKeyProvider } from '@attest-it/core'
import type { OnePasswordAccount, OnePasswordVault, InaccessibleAccount } from '@attest-it/core'
import { select } from '@inquirer/prompts'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { execa } from 'execa'
import { createProjectFixture } from '../../helpers/fixture-factory.js'
import type { Project } from 'fixturify-project'

// ANSI color codes for terminal output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
}

const checkmark = '✓'
const crossmark = '✗'

/**
 * Parse command line arguments.
 */
function parseArgs(): { shouldCleanup: boolean } {
  const args = process.argv.slice(2)
  return {
    shouldCleanup: !args.includes('--no-cleanup'),
  }
}

/**
 * Print a step message with color.
 */
function step(message: string): void {
  console.log(`\n${colors.bright}${colors.blue}==> ${message}${colors.reset}`)
}

/**
 * Print a success message.
 */
function success(message: string): void {
  console.log(`${colors.green}${checkmark} ${message}${colors.reset}`)
}

/**
 * Print an error message.
 */
function error(message: string): void {
  console.log(`${colors.red}${crossmark} ${message}${colors.reset}`)
}

/**
 * Print a warning message.
 */
function warn(message: string): void {
  console.log(`${colors.yellow}⚠ ${message}${colors.reset}`)
}

/**
 * Print an info message.
 */
function info(message: string): void {
  console.log(`${colors.cyan}ℹ ${message}${colors.reset}`)
}

/**
 * Print a phase banner to distinguish test setup from user-facing flow validation.
 */
function phaseBanner(phase: 'setup' | 'validation', title: string, description: string): void {
  const isSetup = phase === 'setup'
  const bgColor = isSetup ? colors.yellow : colors.green
  const label = isSetup ? '🔧 TEST SETUP' : '👁️  USER-FACING FLOW'

  console.log()
  console.log(`${bgColor}${colors.bright}${'█'.repeat(80)}${colors.reset}`)
  console.log(`${bgColor}${colors.bright}█${' '.repeat(78)}█${colors.reset}`)
  console.log(`${bgColor}${colors.bright}█  ${label.padEnd(76)}█${colors.reset}`)
  console.log(`${bgColor}${colors.bright}█  ${title.padEnd(76)}█${colors.reset}`)
  console.log(`${bgColor}${colors.bright}█${' '.repeat(78)}█${colors.reset}`)
  console.log(`${bgColor}${colors.bright}${'█'.repeat(80)}${colors.reset}`)
  console.log()
  console.log(`${colors.dim}${description}${colors.reset}`)
  console.log()
}

/**
 * Test context for cleanup.
 */
interface TestContext {
  project?: Project
  itemName?: string
  vault?: string
  account?: string
}

/**
 * Main test function.
 */
async function runIntegrationTest(): Promise<boolean> {
  const { shouldCleanup } = parseArgs()
  const ctx: TestContext = {}

  console.log(`${colors.bright}${colors.cyan}`)
  console.log('='.repeat(80))
  console.log('1Password Integration Test')
  console.log('='.repeat(80))
  console.log(colors.reset)
  console.log('This test will:')
  console.log('  1. Create an ephemeral test identity with 1Password key provider')
  console.log('  2. Generate a keypair and store the private key in your 1Password vault')
  console.log('  3. Create a test seal using the stored key')
  console.log('  4. Verify the seal passes validation')
  console.log('  5. Clean up the test item from 1Password')
  console.log()

  try {
    phaseBanner(
      'setup',
      'Configuring 1Password Test Environment',
      'The following steps configure test infrastructure. UX does not need to be polished.\nYou may see 1Password authentication prompts - this is expected.',
    )

    // Step 1: Check if op CLI is installed
    step('Step 1: Checking if 1Password CLI is installed')
    const isInstalled = await OnePasswordKeyProvider.isInstalled()
    if (!isInstalled) {
      error('1Password CLI (op) is not installed or not in PATH')
      info('Install from: https://developer.1password.com/docs/cli/get-started/')
      return false
    }
    success('1Password CLI is installed')

    // Step 2: List accounts
    step('Step 2: Listing 1Password accounts')
    const { accounts, inaccessible } = await OnePasswordKeyProvider.listAccounts()
    if (accounts.length === 0) {
      error('No 1Password accounts found')
      info('Sign in to 1Password CLI with: op account add')
      return false
    }
    success(`Found ${String(accounts.length)} accessible account(s)`)

    // Display accessible accounts for user
    console.log('\nAvailable accounts:')
    accounts.forEach((account, index) => {
      const accountNumber = String(index + 1)
      console.log(`  ${accountNumber}. ${account.name} (${account.url})`)
    })

    // Display inaccessible accounts with reasons (so users understand why they're not offered)
    if (inaccessible.length > 0) {
      console.log(`\n${colors.yellow}Accounts not available (${String(inaccessible.length)}):${colors.reset}`)
      inaccessible.forEach((account: InaccessibleAccount) => {
        console.log(`  ${colors.dim}- ${account.email} (${account.url})${colors.reset}`)
        console.log(`    ${colors.dim}Reason: ${account.reason}${colors.reset}`)
      })
    }

    // Step 3: Select account
    step('Step 3: Selecting account')
    // Type assertion: accounts from listAccounts() have guaranteed `name` property
    let selectedAccount: OnePasswordAccount & { name: string }
    if (accounts.length === 1) {
      selectedAccount = accounts[0]
      success(`Using only account: ${selectedAccount.name}`)
    } else {
      // Use account_uuid as the selection value (guaranteed unique)
      const selectedUuid = await select({
        message: 'Select a 1Password account:',
        choices: accounts.map((account) => ({
          name: `${account.name} (${account.url})`,
          value: account.account_uuid,
        })),
      })
      const found = accounts.find((a) => a.account_uuid === selectedUuid)
      if (!found) {
        throw new Error('Selected account not found')
      }
      selectedAccount = found
      success(`Selected: ${selectedAccount.name}`)
    }
    ctx.account = selectedAccount.account_uuid

    // Step 4: List vaults
    step('Step 4: Listing vaults')
    const vaults = await OnePasswordKeyProvider.listVaults(selectedAccount.account_uuid)
    if (vaults.length === 0) {
      error('No vaults found in account')
      return false
    }
    success(`Found ${String(vaults.length)} vault(s)`)

    // Display vaults for user
    console.log('\nAvailable vaults:')
    vaults.forEach((vault: OnePasswordVault, index) => {
      const vaultNumber = String(index + 1)
      console.log(`  ${vaultNumber}. ${vault.name}`)
    })

    // Step 5: Select vault
    step('Step 5: Selecting vault for test key storage')
    const vaultName = await select({
      message: 'Select a vault for storing the test key:',
      choices: vaults.map((vault: OnePasswordVault) => ({
        name: vault.name,
        value: vault.name,
      })),
    })
    success(`Selected vault: ${vaultName}`)
    ctx.vault = vaultName

    // Step 6: Create test project
    step('Step 6: Creating ephemeral test project')
    const project = await createProjectFixture({
      name: '1password-integration-test',
      suites: [
        {
          name: 'simple-test',
          command: 'node -e "console.log(\'Test passed\')"',
          maxAge: '30d',
        },
      ],
    })
    ctx.project = project
    success(`Project created at: ${project.baseDir}`)

    // Step 7: Generate keypair with 1Password provider
    step('Step 7: Generating keypair and storing in 1Password')
    const timestamp = String(Date.now())
    const itemName = `attest-it-test-${timestamp}`
    ctx.itemName = itemName
    info(`Item name: ${itemName}`)

    const provider = new OnePasswordKeyProvider({
      accountUuid: selectedAccount.account_uuid,
      vault: vaultName,
      itemName,
    })

    const publicKeyPath = path.join(project.baseDir, '.attest-it', 'test-pubkey.pem')
    const keyGenResult = await provider.generateKeyPair({
      publicKeyPath,
      force: true,
    })
    success('Keypair generated and private key stored in 1Password')
    info(`Private key ref: ${keyGenResult.privateKeyRef}`)
    info(`Public key path: ${keyGenResult.publicKeyPath}`)
    info(`Storage: ${keyGenResult.storageDescription}`)

    // Step 8: Verify key exists in 1Password
    step('Step 8: Verifying key exists in 1Password')
    const keyExists = await provider.keyExists(itemName)
    if (!keyExists) {
      throw new Error('Key was not found in 1Password after upload')
    }
    success('Key verified in 1Password')

    // Step 9: Test retrieving the key
    step('Step 9: Testing key retrieval')
    const retrievalResult = await provider.getPrivateKey(itemName)
    try {
      // Verify the file exists and has content
      const keyContent = await fs.readFile(retrievalResult.keyPath, 'utf-8')
      if (!keyContent.includes('BEGIN PRIVATE KEY')) {
        throw new Error('Retrieved key does not appear to be a valid PEM private key')
      }
      success('Key retrieved successfully from 1Password')
      info(`Temporary key path: ${retrievalResult.keyPath}`)
    } finally {
      // Cleanup temp key
      await retrievalResult.cleanup()
      success('Temporary key cleaned up')
    }

    phaseBanner(
      'validation',
      'Testing Seal Creation & Verification',
      'The following steps exercise the actual user-facing seal workflow.\nScrutinize UX, error messages, and behavior here.',
    )

    // Step 10: Create a seal using the 1Password-stored key
    step('Step 10: Creating test seal with 1Password key')
    const { computeFingerprintSync, createSeal, writeSeals } = await import('@attest-it/core')

    // Read the public key we generated (already base64-encoded raw Ed25519 key)
    const publicKeyBase64 = (await fs.readFile(publicKeyPath, 'utf-8')).trim()

    // Update the project config to use the test identity
    const configPath = path.join(project.baseDir, '.attest-it', 'config.yaml')
    const configContent = await fs.readFile(configPath, 'utf-8')
    // Use exec() instead of match() for regex
    const lines = configContent.split('\n')
    let inTeamSection = false
    let inTestUser = false
    const teamPattern = /^\s{2}test-user:/
    const publicKeyPattern = /^\s{4}publicKey:/
    const sectionPattern = /^[a-z]/
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      if (line === undefined) continue
      if (line.startsWith('team:')) {
        inTeamSection = true
      } else if (inTeamSection && teamPattern.exec(line)) {
        inTestUser = true
      } else if (inTeamSection && inTestUser && publicKeyPattern.exec(line)) {
        lines[i] = `    publicKey: ${publicKeyBase64}`
        break
      } else if (sectionPattern.exec(line)) {
        // New top-level section
        inTeamSection = false
        inTestUser = false
      }
    }
    const updatedConfig = lines.join('\n')
    await fs.writeFile(configPath, updatedConfig, 'utf-8')

    // Compute fingerprint for the gate
    const fingerprint = computeFingerprintSync({
      packages: ['.'],
      ignore: ['.attest-it/**'],
      baseDir: project.baseDir,
    })
    info(`Fingerprint: ${fingerprint.fingerprint}`)

    // Retrieve the private key for signing
    const { keyPath, cleanup } = await provider.getPrivateKey(itemName)
    try {
      // Read the private key (PEM format needed for createSeal)
      const privateKeyPem = await fs.readFile(keyPath, 'utf-8')

      // Create the seal
      const gateId = 'simple-test-gate'
      const seal = createSeal({
        gateId,
        fingerprint: fingerprint.fingerprint,
        sealedBy: 'test-user',
        privateKey: privateKeyPem,
      })
      success('Seal created successfully')

      // Write the seal to disk
      const sealsPath = path.join(project.baseDir, '.attest-it', 'seals.json')
      await writeSeals(sealsPath, {
        version: 1,
        seals: { [gateId]: seal },
      })
      success('Seal written to disk')
    } finally {
      await cleanup()
    }

    // Step 11: Verify the seal
    step('Step 11: Verifying the seal')
    const { verifyGateSeal, loadConfigSync, readSealsSync } = await import('@attest-it/core')

    const config = loadConfigSync(configPath)
    const gateId = 'simple-test-gate'
    const sealsPath = path.join(project.baseDir, '.attest-it', 'seals.json')
    const sealsFile = readSealsSync(sealsPath)

    // Compute current fingerprint again
    const currentFingerprint = computeFingerprintSync({
      packages: ['.'],
      ignore: ['.attest-it/**'],
      baseDir: project.baseDir,
    })

    const verificationResult = verifyGateSeal(
      config,
      gateId,
      sealsFile,
      currentFingerprint.fingerprint,
    )

    if (verificationResult.state === 'VALID') {
      success('Seal verification passed!')
      if (verificationResult.seal) {
        info(`Sealed by: ${verificationResult.seal.sealedBy}`)
        info(`Sealed at: ${new Date(verificationResult.seal.timestamp).toISOString()}`)
      }
    } else {
      throw new Error(
        `Seal verification failed: ${verificationResult.state}${verificationResult.message ? ` - ${verificationResult.message}` : ''}`,
      )
    }

    // Success!
    console.log()
    console.log(`${colors.bright}${colors.green}`)
    console.log('='.repeat(80))
    console.log(`${checkmark} All tests passed!`)
    console.log('='.repeat(80))
    console.log(colors.reset)

    return true
  } catch (testError) {
    error(`Test failed: ${testError instanceof Error ? testError.message : String(testError)}`)
    if (testError instanceof Error && testError.stack) {
      console.error(colors.dim, testError.stack, colors.reset)
    }
    return false
  } finally {
    // Cleanup
    if (shouldCleanup) {
      step('Cleanup: Removing test artifacts')

      // Delete the 1Password item
      if (ctx.itemName && ctx.vault) {
        try {
          const args = ['item', 'delete', ctx.itemName, '--vault', ctx.vault]
          if (ctx.account) {
            args.push('--account', ctx.account)
          }
          await execa('op', args)
          success(`Deleted 1Password item: ${ctx.itemName}`)
        } catch (cleanupError) {
          warn(
            `Failed to delete 1Password item: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`,
          )
          info(`You may need to manually delete the item: ${ctx.itemName}`)
        }
      }

      // Clean up temp project
      if (ctx.project) {
        try {
          // Project.dispose() returns void, not a Promise
          ctx.project.dispose()
          success('Removed temporary project')
        } catch (cleanupError: unknown) {
          const errorMessage =
            cleanupError instanceof Error ? cleanupError.message : String(cleanupError)
          warn(`Failed to remove temp project: ${errorMessage}`)
        }
      }
    } else {
      warn('Cleanup skipped (--no-cleanup flag)')
      if (ctx.project) {
        info(`Project directory: ${ctx.project.baseDir}`)
      }
      if (ctx.itemName) {
        info(`1Password item: ${ctx.itemName}`)
      }
    }
  }
}

/**
 * Main entry point.
 */
async function main(): Promise<void> {
  const passed = await runIntegrationTest()
  process.exit(passed ? 0 : 1)
}

// Run if executed directly
const scriptPath = process.argv[1]
if (scriptPath && import.meta.url === `file://${scriptPath}`) {
  void main().catch((err: unknown) => {
    console.error('Unexpected error:', err)
    process.exit(1)
  })
}
