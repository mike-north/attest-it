#!/usr/bin/env npx tsx
/**
 * Generate JSON schemas from Zod schemas.
 *
 * This script generates JSON schema files from our Zod validation schemas,
 * ensuring they stay in sync with the actual validation logic.
 *
 * Usage: pnpm --filter @attest-it/core generate-schemas
 */

import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { zodToJsonSchema } from 'zod-to-json-schema'
import { policySchema } from '../src/config/policy-schema.js'
import { operationalSchema } from '../src/config/operational-schema.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const schemasDir = join(__dirname, '../../../schemas')

// Ensure schemas directory exists
mkdirSync(schemasDir, { recursive: true })

/**
 * Generate a JSON schema file from a Zod schema.
 */
function generateSchema(
  name: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  zodSchema: any,
  title: string,
  description: string,
): void {
  const jsonSchema = zodToJsonSchema(zodSchema, {
    name,
    $refStrategy: 'none', // Inline all definitions for better readability
  })

  // Add metadata
  const schemaWithMeta = {
    $schema: 'http://json-schema.org/draft-07/schema#',
    $id: `https://attest-it.dev/schemas/${name}.schema.json`,
    title,
    description,
    ...jsonSchema,
  }

  const outputPath = join(schemasDir, `${name}.schema.json`)
  writeFileSync(outputPath, JSON.stringify(schemaWithMeta, null, 2) + '\n')
  console.log(`Generated: ${outputPath}`)
}

// Generate policy schema
generateSchema(
  'policy',
  policySchema,
  'attest-it Policy Configuration',
  'Policy configuration schema for attest-it. Contains security-critical settings like team members, gates, and authorization rules.',
)

// Generate operational/config schema
generateSchema(
  'config',
  operationalSchema,
  'attest-it Operational Configuration',
  'Operational configuration schema for attest-it. Contains suite definitions and command execution settings.',
)

console.log('\nJSON schemas generated successfully!')
