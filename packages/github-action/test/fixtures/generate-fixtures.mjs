#!/usr/bin/env node
/**
 * Script to generate test fixtures for the GitHub Action.
 * Run with: node packages/github-action/test/fixtures/generate-fixtures.mjs
 */
import { writeFileSync, mkdirSync, copyFileSync, readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { execSync } from 'child_process'
import { createHash } from 'crypto'

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

// Compute fingerprint using the same algorithm as @attest-it/core
// 1. For each file: sha256(normalizedPath + '\0' + content) → Buffer
// 2. Sort by relative path
// 3. Concatenate all Buffers
// 4. Final: sha256:(sha256(concatenated).hex())

const srcFile = join(validFixture, 'src', 'index.ts')
const srcData = readFileSync(srcFile)
const normalizedPath = 'src/index.ts'

// Compute file hash: sha256(path + '\0' + content)
const fileHash = createHash('sha256')
fileHash.update(normalizedPath)
fileHash.update('\0')
fileHash.update(srcData)
const fileHashBuffer = fileHash.digest()

// Final fingerprint: sha256 of concatenated file hashes (just one file here)
const finalHash = createHash('sha256').update(fileHashBuffer).digest('hex')
const fingerprint = `sha256:${finalHash}`

console.log('Computed fingerprint:', fingerprint)

// Create attestation
const attestation = {
  suite: 'unit-tests',
  fingerprint,
  attestedAt: new Date().toISOString(),
  attestedBy: 'test-fixture-generator',
  command: 'echo "tests passed"',
  exitCode: 0
}

// Canonicalize attestations (sorted keys, compact JSON)
function canonicalize(attestations) {
  const sortedKeys = ['attestedAt', 'attestedBy', 'command', 'exitCode', 'fingerprint', 'suite']
  return JSON.stringify(attestations.map(a => {
    const sorted = {}
    for (const key of sortedKeys) {
      if (key in a) sorted[key] = a[key]
    }
    return sorted
  }))
}

const canonical = canonicalize([attestation])
console.log('Canonical attestations:', canonical)

// Sign with RSA private key using openssl
const privateKeyPath = join(coreTestKeys, 'test-rsa-private.pem')
const signatureB64 = execSync(
  `printf '%s' '${canonical}' | openssl pkeyutl -sign -inkey "${privateKeyPath}" | base64`,
  { encoding: 'utf8' }
).trim()

console.log('Signature (base64):', signatureB64.substring(0, 50) + '...')

// Create attestations file
const attestationsFile = {
  schemaVersion: '1',
  attestations: [attestation],
  signature: signatureB64
}

writeFileSync(
  join(validFixture, '.attest-it', 'attestations.json'),
  JSON.stringify(attestationsFile, null, 2)
)

// For missing-attestation fixture, don't create attestations.json
// (the config exists but no attestations)

console.log('\nFixtures generated successfully!')
console.log('- Valid attestation:', validFixture)
console.log('- Missing attestation:', missingFixture)
