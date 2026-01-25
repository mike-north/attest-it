#!/usr/bin/env tsx
/**
 * macOS Keychain Integration Test
 *
 * This script exercises the full end-to-end flow with the real macOS Keychain:
 * 1. Checks platform is macOS
 * 2. Creates ephemeral test identity with Keychain as key provider
 * 3. Generates keypair and stores private key in Keychain
 * 4. Sets up minimal test project config
 * 5. Creates a test seal using the Keychain-stored key
 * 6. Verifies the test seal passes validation
 * 7. Cleans up test key from Keychain
 *
 * Usage:
 *   pnpm tsx test/manual/scripts/keychain-integration.ts
 */

import {
  MacOSKeychainKeyProvider,
  createSeal,
  verifyGateSeal,
  readSealsSync,
  writeSealsSync,
  computeFingerprintSync,
  getPublicKeyFromPrivate,
} from '@attest-it/core'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import * as os from 'node:os'
import { spawn } from 'node:child_process'
import type { AttestItConfig, SealsFile } from '@attest-it/core'

// Color codes for terminal output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
}

// Status symbols
const symbols = {
  success: '✓',
  error: '✗',
  info: '→',
  skip: '⊘',
}

/**
 * Print colored status message
 */
function log(symbol: string, message: string, color: keyof typeof colors = 'reset'): void {
  console.log(`${colors[color]}${symbol} ${message}${colors.reset}`)
}

/**
 * Execute a shell command and return stdout
 */
async function execCommand(command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''

    proc.stdout.on('data', (data: Buffer) => {
      stdout += data.toString()
    })

    proc.stderr.on('data', (data: Buffer) => {
      stderr += data.toString()
    })

    proc.on('close', (code) => {
      if (code === 0) {
        resolve(stdout.trim())
      } else {
        reject(new Error(`Command failed with exit code ${String(code)}: ${stderr}`))
      }
    })

    proc.on('error', (error) => {
      reject(error)
    })
  })
}

/**
 * Delete a key from macOS Keychain
 */
async function deleteKeychainKey(itemName: string): Promise<void> {
  try {
    await execCommand('security', ['delete-generic-password', '-a', 'attest-it', '-s', itemName])
  } catch {
    // Key might not exist, ignore errors
    log(symbols.info, `Note: Could not delete key (may not exist): ${itemName}`, 'gray')
  }
}

/**
 * Main test flow
 */
async function main(): Promise<void> {
  console.log(`\n${colors.cyan}${'='.repeat(80)}`)
  console.log('macOS Keychain Integration Test')
  console.log(`${'='.repeat(80)}${colors.reset}\n`)

  let tempDir: string | null = null
  let testItemName: string | null = null
  let exitCode = 0

  try {
    // Step 1: Check platform is macOS
    log(symbols.info, 'Checking platform compatibility...', 'blue')
    if (!MacOSKeychainKeyProvider.isAvailable()) {
      log(symbols.skip, 'Not running on macOS - skipping test', 'yellow')
      process.exit(78) // EX_CONFIG - system configuration does not allow this
    }
    log(symbols.success, 'Running on macOS', 'green')

    // Step 2: Generate unique test item name
    const timestamp = Date.now()
    testItemName = `attest-it-test-${timestamp.toString()}`
    log(symbols.info, `Using test item name: ${testItemName}`, 'cyan')

    // Step 3: Create test identity with Keychain provider
    log(symbols.info, 'Creating MacOS Keychain key provider...', 'blue')
    const provider = new MacOSKeychainKeyProvider({ itemName: testItemName })
    log(symbols.success, 'Key provider created', 'green')

    // Step 4: Create temporary directory for test project
    log(symbols.info, 'Creating temporary test project...', 'blue')
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'attest-it-keychain-test-'))
    const attestItDir = path.join(tempDir, '.attest-it')
    await fs.mkdir(attestItDir, { recursive: true })
    log(symbols.success, `Test project: ${tempDir}`, 'green')

    // Step 5: Generate keypair and store in Keychain
    console.log(`\n${colors.yellow}${'─'.repeat(80)}`)
    console.log(`${symbols.info} KEYCHAIN ACCESS WARNING`)
    console.log(`${'─'.repeat(80)}${colors.reset}`)
    console.log(
      `${colors.yellow}The next step will generate an Ed25519 keypair and store the private key`,
    )
    console.log(`in your macOS Keychain. You may be prompted to allow access.`)
    console.log(``)
    console.log(`This is expected behavior for testing keychain integration.`)
    console.log(`The test key will be deleted automatically when the test completes.`)
    console.log(`${'─'.repeat(80)}${colors.reset}\n`)

    log(symbols.info, 'Generating keypair and storing in Keychain...', 'blue')
    const publicKeyPath = path.join(attestItDir, 'test-pubkey.pem')
    const keygenResult = await provider.generateKeyPair({
      publicKeyPath,
      force: true,
    })
    log(symbols.success, `Public key: ${keygenResult.publicKeyPath}`, 'green')
    log(symbols.success, `Private key: ${keygenResult.storageDescription}`, 'green')

    // Step 6: Verify key exists in Keychain
    log(symbols.info, 'Verifying key exists in Keychain...', 'blue')
    const keyExists = await provider.keyExists(keygenResult.privateKeyRef)
    if (!keyExists) {
      throw new Error('Key was not stored in Keychain')
    }
    log(symbols.success, 'Key verified in Keychain', 'green')

    // Step 7: Retrieve private key from Keychain to derive public key
    log(symbols.info, 'Retrieving private key from Keychain...', 'blue')
    const keyRetrieval = await provider.getPrivateKey(keygenResult.privateKeyRef)
    const privateKeyPem = await fs.readFile(keyRetrieval.keyPath, 'utf8')
    log(symbols.success, 'Private key retrieved from Keychain', 'green')

    // Step 8: Derive raw 32-byte public key from private key for config
    // The team config expects the raw Ed25519 public key (32 bytes, base64 encoded)
    // NOT the full SPKI-encoded PEM content
    log(symbols.info, 'Deriving public key from private key...', 'blue')
    const publicKeyBase64 = getPublicKeyFromPrivate(privateKeyPem)
    log(symbols.success, 'Public key derived successfully', 'green')

    // Step 9: Create minimal test project config
    log(symbols.info, 'Creating test project configuration...', 'blue')
    const config: AttestItConfig = {
      version: 1,
      settings: {
        maxAgeDays: 30,
        publicKeyPath: '.attest-it/test-pubkey.pem',
        attestationsPath: '.attest-it/attestations.json',
      },
      team: {
        'test-user': {
          publicKey: publicKeyBase64,
          name: 'Test User',
          email: 'test@example.com',
        },
      },
      gates: {
        'test-gate': {
          name: 'Test Gate',
          description: 'Test gate for keychain integration test',
          fingerprint: {
            paths: ['src/**/*'],
          },
          maxAge: '30d',
          authorizedSigners: ['test-user'],
        },
      },
      suites: {},
    }
    log(symbols.success, 'Configuration created', 'green')

    // Step 10: Create test source files for fingerprinting
    log(symbols.info, 'Creating test source files...', 'blue')
    const srcDir = path.join(tempDir, 'src')
    await fs.mkdir(srcDir, { recursive: true })
    await fs.writeFile(path.join(srcDir, 'test.js'), 'console.log("test");\n')
    log(symbols.success, 'Test files created', 'green')

    // Step 11: Compute fingerprint for the gate
    log(symbols.info, 'Computing fingerprint...', 'blue')
    const fingerprintResult = computeFingerprintSync({
      packages: ['src'], // Package directories to include
      baseDir: tempDir,
    })
    log(
      symbols.success,
      `Fingerprint: ${fingerprintResult.fingerprint} (${fingerprintResult.fileCount.toString()} files)`,
      'green',
    )

    // Step 12: Create a test seal using the Keychain-stored key
    // Note: createSeal expects a PEM-encoded private key (full PEM string with headers)
    log(symbols.info, 'Creating test seal...', 'blue')
    const seal = createSeal({
      gateId: 'test-gate',
      fingerprint: fingerprintResult.fingerprint,
      sealedBy: 'test-user',
      privateKey: privateKeyPem,
    })
    log(symbols.success, `Seal created at ${seal.timestamp}`, 'green')

    // Step 13: Write seal to seals.json
    log(symbols.info, 'Writing seal to seals.json...', 'blue')
    const sealsFile: SealsFile = {
      version: 1,
      seals: {
        'test-gate': seal,
      },
    }
    writeSealsSync(tempDir, sealsFile)
    log(symbols.success, 'Seal written to file', 'green')

    // Step 14: Verify the seal
    log(symbols.info, 'Verifying seal...', 'blue')
    const loadedSeals = readSealsSync(tempDir)
    const verificationResult = verifyGateSeal(
      config,
      'test-gate',
      loadedSeals,
      fingerprintResult.fingerprint,
    )

    if (verificationResult.state !== 'VALID') {
      throw new Error(
        `Seal verification failed: ${verificationResult.state} - ${verificationResult.message ?? 'unknown error'}`,
      )
    }
    log(symbols.success, 'Seal verification passed', 'green')

    // Step 15: Clean up private key cleanup callback
    log(symbols.info, 'Cleaning up temporary private key file...', 'blue')
    await keyRetrieval.cleanup()
    log(symbols.success, 'Temporary key file cleaned up', 'green')

    // Success!
    console.log(`\n${colors.green}${'='.repeat(80)}`)
    console.log(`${symbols.success} All tests passed!`)
    console.log(`${'='.repeat(80)}${colors.reset}\n`)
  } catch (error) {
    // Test failed
    console.log(`\n${colors.red}${'='.repeat(80)}`)
    log(symbols.error, 'Test failed', 'red')
    console.log(`${'='.repeat(80)}${colors.reset}\n`)

    if (error instanceof Error) {
      console.error(`${colors.red}Error: ${error.message}${colors.reset}`)
      if (error.stack) {
        console.error(`${colors.gray}${error.stack}${colors.reset}`)
      }
    } else {
      console.error(`${colors.red}Error: ${String(error)}${colors.reset}`)
    }

    exitCode = 1
  } finally {
    // Cleanup
    console.log(`\n${colors.blue}Cleaning up...${colors.reset}`)

    // Delete test key from Keychain
    if (testItemName) {
      log(symbols.info, 'Deleting test key from Keychain...', 'blue')
      await deleteKeychainKey(testItemName)
      log(symbols.success, 'Test key deleted from Keychain', 'green')
    }

    // Remove temporary directory
    if (tempDir) {
      log(symbols.info, 'Removing temporary directory...', 'blue')
      try {
        await fs.rm(tempDir, { recursive: true, force: true })
        log(symbols.success, 'Temporary directory removed', 'green')
      } catch (error) {
        log(
          symbols.error,
          `Failed to remove temp directory: ${error instanceof Error ? error.message : String(error)}`,
          'red',
        )
      }
    }

    console.log(`${colors.blue}Cleanup complete${colors.reset}\n`)
  }

  process.exit(exitCode)
}

// Run the main function
main().catch((error: unknown) => {
  console.error(
    `${colors.red}Fatal error: ${error instanceof Error ? error.message : String(error)}${colors.reset}`,
  )
  process.exit(1)
})
