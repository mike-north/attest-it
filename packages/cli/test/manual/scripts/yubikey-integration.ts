#!/usr/bin/env tsx
/**
 * YubiKey Integration Test
 *
 * This script exercises the full end-to-end flow with a real YubiKey,
 * creating an ephemeral Level 1 test seal and verifying it works correctly.
 *
 * Test Flow:
 * 1. Check `ykman` CLI is installed
 * 2. List connected YubiKeys
 * 3. Select YubiKey if multiple are connected
 * 4. Verify HMAC challenge-response is configured on slot 2
 * 5. Create ephemeral test project
 * 6. Generate keypair encrypted with YubiKey
 * 7. Test key retrieval
 * 8. Create a test seal using the YubiKey-stored key
 * 9. Verify the seal passes validation
 * 10. Cleanup: delete encrypted key file, remove temp directory
 * 11. Print success/failure summary
 *
 * Usage:
 *   pnpm tsx test/manual/scripts/yubikey-integration.ts [--no-cleanup]
 *
 * Options:
 *   --no-cleanup  Keep the encrypted key file and temp project for inspection
 */

import {
  isYubiKeyInstalled,
  isYubiKeyConnected,
  listYubiKeyDevices,
  isYubiKeyChallengeResponseConfigured,
  VaultKeyProvider,
  getIdentityConfigDir,
} from '@attest-it/core'
import type { YubiKeyInfo } from '@attest-it/core'
import { BackendRegistry } from 'vaultkeeper'
import { select } from '@inquirer/prompts'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
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
 * Test context for cleanup.
 */
interface TestContext {
  project?: Project
  secretId?: string
}

/**
 * Main test function.
 */
async function runIntegrationTest(): Promise<boolean> {
  const { shouldCleanup } = parseArgs()
  const ctx: TestContext = {}

  console.log(`${colors.bright}${colors.cyan}`)
  console.log('='.repeat(80))
  console.log('YubiKey Integration Test')
  console.log('='.repeat(80))
  console.log(colors.reset)
  console.log('This test will:')
  console.log('  1. Verify YubiKey is connected and configured')
  console.log('  2. Generate a keypair encrypted with YubiKey challenge-response')
  console.log('  3. Create a test seal using the encrypted key')
  console.log('  4. Verify the seal passes validation')
  console.log('  5. Clean up the encrypted key from VaultKeeper')
  console.log()

  try {
    // Step 1: Check if ykman CLI is installed
    step('Step 1: Checking if YubiKey Manager CLI is installed')
    const installed = await isYubiKeyInstalled()
    if (!installed) {
      error('YubiKey Manager CLI (ykman) is not installed or not in PATH')
      info('Install from: https://www.yubico.com/support/download/yubikey-manager/')
      // Exit code 78 indicates "configuration" error (system not configured properly)
      process.exitCode = 78
      return false
    }
    success('YubiKey Manager CLI is installed')

    // Step 2: List connected YubiKeys
    step('Step 2: Listing connected YubiKeys')
    const devices = await listYubiKeyDevices()
    if (devices.length === 0) {
      error('No YubiKey devices found')
      info('Please connect a YubiKey and try again')
      // Exit code 78 indicates "configuration" error (required hardware not available)
      process.exitCode = 78
      return false
    }
    success(`Found ${String(devices.length)} YubiKey(s)`)

    // Display devices for user
    console.log('\nConnected YubiKeys:')
    devices.forEach((device: YubiKeyInfo, index) => {
      const deviceNumber = String(index + 1)
      console.log(
        `  ${deviceNumber}. ${device.type} (Serial: ${device.serial}, Firmware: ${device.firmware})`,
      )
    })

    // Step 3: Select YubiKey
    step('Step 3: Selecting YubiKey')
    let selectedDevice: YubiKeyInfo
    if (devices.length === 1) {
      selectedDevice = devices[0]
      success(`Using only device: Serial ${selectedDevice.serial}`)
    } else {
      const deviceSerial = await select({
        message: 'Select a YubiKey:',
        choices: devices.map((device: YubiKeyInfo) => ({
          name: `${device.type} (Serial: ${device.serial}, Firmware: ${device.firmware})`,
          value: device.serial,
        })),
      })
      const found = devices.find((d: YubiKeyInfo) => d.serial === deviceSerial)
      if (!found) {
        throw new Error('Selected device not found')
      }
      selectedDevice = found
      success(`Selected: Serial ${selectedDevice.serial}`)
    }

    // Step 4: Verify HMAC challenge-response is configured
    step('Step 4: Verifying HMAC challenge-response configuration')
    const slot = 2
    const configured = await isYubiKeyChallengeResponseConfigured(slot, selectedDevice.serial)
    if (!configured) {
      error(`YubiKey slot ${String(slot)} is not configured for HMAC challenge-response`)
      info(`Configure with: ykman --device ${selectedDevice.serial} otp chalresp --generate 2`)
      warn('Note: This will overwrite any existing configuration in slot 2')
      // Exit code 78 indicates "configuration" error (device not properly configured)
      process.exitCode = 78
      return false
    }
    success(`Slot ${String(slot)} is configured for challenge-response`)

    // Step 5: Create test project
    step('Step 5: Creating ephemeral test project')
    const project = await createProjectFixture({
      name: 'yubikey-integration-test',
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

    // Step 6: Generate keypair with VaultKeyProvider (yubikey backend)
    step('Step 6: Generating keypair and encrypting with YubiKey via VaultKeeper')
    info(`Config dir: ${getIdentityConfigDir()}`)

    const backend = BackendRegistry.create('yubikey')
    const provider = new VaultKeyProvider({ backend, displayName: 'YubiKey' })

    const publicKeyPath = path.join(project.baseDir, '.attest-it', 'test-pubkey.pem')
    const keyGenResult = await provider.generateKeyPair({
      publicKeyPath,
      force: true,
    })
    ctx.secretId = keyGenResult.privateKeyRef
    success('Keypair generated and private key stored via VaultKeeper YubiKey backend')
    info(`Private key ref: ${keyGenResult.privateKeyRef}`)
    info(`Public key path: ${keyGenResult.publicKeyPath}`)
    info(`Storage: ${keyGenResult.storageDescription}`)

    // Step 7: Verify key exists
    step('Step 7: Verifying key exists in VaultKeeper')
    const keyExists = await provider.keyExists(keyGenResult.privateKeyRef)
    if (!keyExists) {
      throw new Error('Key was not stored in VaultKeeper YubiKey backend')
    }
    success('Key verified in VaultKeeper')

    // Step 8: Test retrieving the key
    step('Step 8: Testing key retrieval')
    const retrievalResult = await provider.getPrivateKey(keyGenResult.privateKeyRef)
    try {
      // Verify the file exists and has content
      const keyContent = await fs.readFile(retrievalResult.keyPath, 'utf-8')
      if (!keyContent.includes('BEGIN PRIVATE KEY')) {
        throw new Error('Retrieved key does not appear to be a valid PEM private key')
      }
      success('Key retrieved and decrypted successfully')
      info(`Temporary key path: ${retrievalResult.keyPath}`)
    } finally {
      // Cleanup temp key
      await retrievalResult.cleanup()
      success('Temporary key cleaned up')
    }

    // Step 9: Create a seal using the VaultKeeper YubiKey-backed key
    step('Step 9: Creating test seal with VaultKeeper YubiKey key')
    const { computeFingerprintSync, createSeal, writeSeals, getPublicKeyFromPrivate } =
      await import('@attest-it/core')

    // Retrieve the private key to derive the raw Ed25519 public key
    // Team config expects raw 32-byte Ed25519 public key, not SPKI-encoded
    const { keyPath: tempKeyPath, cleanup: tempCleanup } = await provider.getPrivateKey(
      keyGenResult.privateKeyRef,
    )
    let publicKeyBase64: string
    try {
      const privateKeyPem = await fs.readFile(tempKeyPath, 'utf-8')
      publicKeyBase64 = getPublicKeyFromPrivate(privateKeyPem)
    } finally {
      await tempCleanup()
    }

    // Update the project config to use the test identity
    const configPath = path.join(project.baseDir, '.attest-it', 'config.yaml')
    const configContent = await fs.readFile(configPath, 'utf-8')
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
    const { keyPath, cleanup } = await provider.getPrivateKey(keyGenResult.privateKeyRef)
    try {
      // Read the private key (PEM format)
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

    // Step 10: Verify the seal
    step('Step 10: Verifying the seal')
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

      // Note: VaultKeeper YubiKey backend secrets are managed by the backend;
      // cleanup of temp files is handled by the provider's cleanup callbacks.
      if (ctx.secretId) {
        info(`Secret ID ${ctx.secretId} is stored in VaultKeeper YubiKey backend.`)
        info('If needed, remove manually via the VaultKeeper API or YubiKey management tools.')
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
      if (ctx.secretId) {
        info(`VaultKeeper secret ID: ${ctx.secretId}`)
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
