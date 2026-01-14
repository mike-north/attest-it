/**
 * Quick test script to verify the schemas work correctly
 */

import { parsePolicyContent } from './src/config/policy-schema.js'
import { parseOperationalContent } from './src/config/operational-schema.js'

console.log('Testing Policy Schema...')

try {
  const policyYaml = `
version: 1
settings:
  maxAgeDays: 30
team:
  alice:
    name: Alice
    publicKey: ssh-rsa AAA...
gates:
  unit-tests:
    name: Unit Tests
    description: Unit test gate
    authorizedSigners:
      - alice
    fingerprint:
      paths:
        - src/**
    maxAge: 7d
`
  const policy = parsePolicyContent(policyYaml, 'yaml')
  console.log('✓ Policy schema parses valid YAML')
  console.log('  - version:', policy.version)
  console.log('  - team members:', Object.keys(policy.team || {}).length)
  console.log('  - gates:', Object.keys(policy.gates || {}).length)
} catch (error) {
  console.error('✗ Policy schema failed:', error.message)
  process.exit(1)
}

console.log('\nTesting Operational Schema...')

try {
  const operationalYaml = `
version: 1
settings:
  defaultCommand: pnpm test
suites:
  unit:
    packages:
      - '@attest-it/core'
    command: pnpm test:unit
groups:
  fast:
    - unit
`
  const operational = parseOperationalContent(operationalYaml, 'yaml')
  console.log('✓ Operational schema parses valid YAML')
  console.log('  - version:', operational.version)
  console.log('  - suites:', Object.keys(operational.suites).length)
  console.log('  - groups:', Object.keys(operational.groups || {}).length)
} catch (error) {
  console.error('✗ Operational schema failed:', error.message)
  process.exit(1)
}

console.log('\n✓ All schema tests passed!')
