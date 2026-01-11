#!/usr/bin/env node
/**
 * Script to generate test fixtures for the GitHub Action.
 * Run with: node packages/github-action/test/fixtures/generate-fixtures.mjs
 *
 * This script uses the actual @attest-it/core library to ensure
 * the attestation format and signatures are correct.
 */
import { writeFileSync, mkdirSync, copyFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import {
  computeFingerprint,
  createAttestation,
  writeSignedAttestations,
} from '../../../core/dist/index.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

// Paths
const coreTestKeys = join(__dirname, '../../../core/test/fixtures/test-keys')
const validFixture = join(__dirname, 'valid-attestation')
const missingFixture = join(__dirname, 'missing-attestation')

// Create directories
mkdirSync(join(validFixture, '.attest-it'), { recursive: true })
mkdirSync(join(validFixture, 'src'), { recursive: true })
mkdirSync(join(missingFixture, '.attest-it'), { recursive: true })
mkdirSync(join(missingFixture, 'src'), { recursive: true })

// Copy test keys to fixtures (using RSA keys for broader OpenSSL compatibility)
copyFileSync(
  join(coreTestKeys, 'test-rsa-public.pem'),
  join(validFixture, '.attest-it', 'pubkey.pem')
)
copyFileSync(
  join(coreTestKeys, 'test-rsa-public.pem'),
  join(missingFixture, '.attest-it', 'pubkey.pem')
)

// Create a simple source file to fingerprint
const srcContent = `// Test file for attestation fixture
export function hello() {
  return 'Hello, World!'
}
`
writeFileSync(join(validFixture, 'src', 'index.ts'), srcContent)
writeFileSync(join(missingFixture, 'src', 'index.ts'), srcContent)

// Config with 10-year expiry (3650 days)
const config = `version: 1

settings:
  maxAgeDays: 3650
  publicKeyPath: .attest-it/pubkey.pem
  attestationsPath: .attest-it/attestations.json

suites:
  unit-tests:
    description: Unit test suite
    packages:
      - src
    command: echo "tests passed"
`

writeFileSync(join(validFixture, '.attest-it', 'config.yaml'), config)
writeFileSync(join(missingFixture, '.attest-it', 'config.yaml'), config)

// Compute fingerprint using the core library
const fingerprintResult = await computeFingerprint({
  packages: ['src'],
  baseDir: validFixture,
})

console.log('Computed fingerprint:', fingerprintResult.fingerprint)

// Create attestation using the core library
const attestation = createAttestation({
  suite: 'unit-tests',
  fingerprint: fingerprintResult.fingerprint,
  command: 'echo "tests passed"',
  attestedBy: 'test-fixture-generator',
})

console.log('Created attestation:', JSON.stringify(attestation, null, 2))

// Write signed attestations using the core library
const privateKeyPath = join(coreTestKeys, 'test-rsa-private.pem')
const attestationsPath = join(validFixture, '.attest-it', 'attestations.json')

await writeSignedAttestations({
  attestations: [attestation],
  privateKeyPath,
  filePath: attestationsPath,
})

console.log('Wrote signed attestations to:', attestationsPath)

// For missing-attestation fixture, don't create attestations.json
// (the config exists but no attestations)

console.log('\nFixtures generated successfully!')
console.log('- Valid attestation:', validFixture)
console.log('- Missing attestation:', missingFixture)
