#!/usr/bin/env node
/**
 * Script to generate test fixtures for the GitHub Action.
 * Run with: node packages/github-action/test/fixtures/generate-fixtures.mjs
 *
 * This script uses the actual @attest-it/core library to ensure
 * the attestation format and signatures are correct.
 */
import { writeFileSync, mkdirSync, copyFileSync, readFileSync } from 'fs'
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
const splitConfigFixture = join(__dirname, 'split-config-valid')

// Read the public key in base64 format for policy files
const pubKeyPem = readFileSync(join(coreTestKeys, 'test-rsa-public.pem'), 'utf8')
// Extract the base64 content (remove header/footer and newlines)
const pubKeyBase64 = pubKeyPem
  .replace(/-----BEGIN PUBLIC KEY-----/, '')
  .replace(/-----END PUBLIC KEY-----/, '')
  .replace(/\n/g, '')
  .trim()

// Create directories
for (const fixture of [validFixture, missingFixture, splitConfigFixture]) {
  mkdirSync(join(fixture, '.attest-it'), { recursive: true })
  mkdirSync(join(fixture, 'src'), { recursive: true })
}

// Copy test keys to fixtures (using RSA keys for broader OpenSSL compatibility)
for (const fixture of [validFixture, missingFixture, splitConfigFixture]) {
  copyFileSync(
    join(coreTestKeys, 'test-rsa-public.pem'),
    join(fixture, '.attest-it', 'pubkey.pem'),
  )
}

// Create a simple source file to fingerprint
const srcContent = `// Test file for attestation fixture
export function hello() {
  return 'Hello, World!'
}
`
for (const fixture of [validFixture, missingFixture, splitConfigFixture]) {
  writeFileSync(join(fixture, 'src', 'index.ts'), srcContent)
}

// Policy config (security-critical settings)
const policyConfig = `version: 1

settings:
  maxAgeDays: 3650
  publicKeyPath: .attest-it/pubkey.pem
  attestationsPath: .attest-it/attestations.json

team:
  developer:
    name: Test Developer
    publicKey: ${pubKeyBase64}

gates:
  unit-tests:
    name: Unit Tests
    description: Unit test suite for the project
    authorizedSigners:
      - developer
    fingerprint:
      paths:
        - src/**/*.ts
    maxAge: 3650d
`

// Operational config (references the gate and includes packages for fingerprinting)
const operationalConfig = `version: 1

suites:
  unit-tests:
    gate: unit-tests
    description: Unit test suite
    command: echo "tests passed"
    packages:
      - src
`

// Write config files for all fixtures
for (const fixture of [validFixture, missingFixture, splitConfigFixture]) {
  writeFileSync(join(fixture, '.attest-it', 'policy.yaml'), policyConfig)
  writeFileSync(join(fixture, '.attest-it', 'config.yaml'), operationalConfig)
}

// Compute fingerprint using the suite's packages config
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
  attestedBy: 'developer',
})

console.log('Created attestation:', JSON.stringify(attestation, null, 2))

// Write signed attestations using the core library for valid fixtures
const privateKeyPath = join(coreTestKeys, 'test-rsa-private.pem')

for (const fixture of [validFixture, splitConfigFixture]) {
  const attestationsPath = join(fixture, '.attest-it', 'attestations.json')
  await writeSignedAttestations({
    attestations: [attestation],
    privateKeyPath,
    filePath: attestationsPath,
  })
  console.log('Wrote signed attestations to:', attestationsPath)
}

// For missing-attestation fixture, don't create attestations.json
// (the config exists but no attestations)

console.log('\nFixtures generated successfully!')
console.log('- Valid attestation:', validFixture)
console.log('- Missing attestation:', missingFixture)
console.log('- Split config valid:', splitConfigFixture)
