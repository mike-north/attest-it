/**
 * Fixture factory utilities for creating realistic test projects using fixturify-project.
 * These fixtures are used to test the interactive CLI experience with various project states.
 */

import { Project } from 'fixturify-project'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execa } from 'execa'
import { generateEd25519KeyPair, createSeal, type SealsFile } from '@attest-it/core'

export interface SuiteConfig {
  name: string
  command: string
  maxAge?: string
  groups?: string[]
}

export interface ProjectFixtureOptions {
  name?: string
  suites?: SuiteConfig[]
  /**
   * Whether to initialize as a git repository
   */
  initGit?: boolean
  /**
   * Additional files to include in the project
   */
  files?: Record<string, string>
}

/**
 * Default passing test suite
 */
const DEFAULT_PASSING_SUITE: SuiteConfig = {
  name: 'example',
  command: 'node -e "console.log(\'test passed\')"',
  maxAge: '30d',
  groups: ['unit-tests'],
}

/**
 * Default failing test suite
 */
const DEFAULT_FAILING_SUITE: SuiteConfig = {
  name: 'failing',
  command: 'node -e "process.exit(1)"',
  maxAge: '30d',
  groups: ['unit-tests'],
}

/**
 * Stored keypair for the fixture (set by createProjectFixture)
 * This allows tests to access the keys for creating seals
 */
export interface FixtureKeyPair {
  publicKey: string
  privateKey: string
}

// Store keypairs per project for tests to access
const fixtureKeyPairs = new Map<string, FixtureKeyPair>()

/**
 * Get the keypair for a fixture project
 */
export function getFixtureKeyPair(projectDir: string): FixtureKeyPair {
  const keyPair = fixtureKeyPairs.get(projectDir)
  if (!keyPair) {
    throw new Error(`No keypair found for project: ${projectDir}`)
  }
  return keyPair
}

/**
 * Creates a realistic attest-it project fixture with Ed25519 keys and new config format
 */
export async function createProjectFixture(options: ProjectFixtureOptions = {}): Promise<Project> {
  const {
    name = 'test-project',
    suites = [DEFAULT_PASSING_SUITE],
    initGit = true,
    files = {},
  } = options

  // Create the project
  const project = new Project(name, { root: tmpdir() })

  // Generate Ed25519 keypair upfront (seal verification requires Ed25519)
  const keyPair = generateEd25519KeyPair()
  fixtureKeyPairs.set(project.baseDir, keyPair)

  // Add package.json
  project.files['package.json'] = JSON.stringify(
    {
      name,
      version: '1.0.0',
      private: true,
      scripts: {
        test: 'echo "Tests run"',
      },
    },
    null,
    2,
  )

  // Generate YAML content with new config format (team, gates, suites)
  const yamlLines = ['version: 1', '']

  // Add settings section
  const privateKeyPath = '.attest-it/private.pem'
  const publicKeyPath = '.attest-it/pubkey.pem'
  const sealsPath = '.attest-it/seals.json'

  yamlLines.push('settings:')
  yamlLines.push(`  publicKeyPath: ${publicKeyPath}`)
  yamlLines.push(`  attestationsPath: ${sealsPath}`)
  yamlLines.push('  keyProvider:')
  yamlLines.push('    type: filesystem')
  yamlLines.push('    options:')
  yamlLines.push(`      privateKeyPath: ${privateKeyPath}`)

  // Add default max age if any suite has one
  const maxAges = suites.map((s) => s.maxAge).filter((age): age is string => age !== undefined)
  if (maxAges.length > 0) {
    const firstMaxAge = maxAges[0]
    const days = parseInt(firstMaxAge.replace(/\D/g, ''), 10)
    yamlLines.push(`  maxAgeDays: ${String(days)}`)
  }
  yamlLines.push('')

  // Add team section with test user
  yamlLines.push('team:')
  yamlLines.push('  test-user:')
  yamlLines.push('    name: Test User')
  yamlLines.push(`    publicKey: ${keyPair.publicKey}`)
  yamlLines.push('')

  // Add gates section - one gate per suite
  yamlLines.push('gates:')
  suites.forEach((suite) => {
    const gateId = `${suite.name}-gate`
    yamlLines.push(`  ${gateId}:`)
    yamlLines.push(`    name: "${suite.name} Gate"`)
    yamlLines.push(`    description: "Gate for ${suite.name}"`)
    yamlLines.push('    authorizedSigners:')
    yamlLines.push('      - test-user')
    yamlLines.push('    fingerprint:')
    yamlLines.push('      paths:')
    yamlLines.push('        - .')
    yamlLines.push('      exclude:')
    yamlLines.push('        - .attest-it/**')
    yamlLines.push(`    maxAge: ${suite.maxAge ?? '30d'}`)
  })
  yamlLines.push('')

  // Add suites section referencing gates
  yamlLines.push('suites:')
  suites.forEach((suite) => {
    const gateId = `${suite.name}-gate`
    yamlLines.push(`  ${suite.name}:`)
    yamlLines.push(`    description: "Test suite: ${suite.name}"`)
    yamlLines.push(`    gate: ${gateId}`)
    yamlLines.push(`    command: ${suite.command}`)
  })

  const yamlContent = yamlLines.join('\n')

  project.files['.attest-it'] = {
    'config.yaml': yamlContent,
    'private.pem': keyPair.privateKey,
    'pubkey.pem': `-----BEGIN PUBLIC KEY-----\n${keyPair.publicKey}\n-----END PUBLIC KEY-----\n`,
    '.gitkeep': '',
  }

  // Add any additional files
  for (const [filePath, content] of Object.entries(files)) {
    const parts = filePath.split('/')
    if (parts.length === 1) {
      project.files[filePath] = content
    } else {
      // Build nested directory structure
      /* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment */
      let current: any = project.files
      for (let i = 0; i < parts.length - 1; i++) {
        const part = parts[i]
        if (part) {
          current[part] ??= {}
          current = current[part]
        }
      }
      const fileName = parts[parts.length - 1]
      if (fileName) {
        current[fileName] = content
      }
      /* eslint-enable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment */
    }
  }

  // Write the project to disk
  await project.write()

  // Force file system sync
  const { readFile } = await import('node:fs/promises')
  const configPath = join(project.baseDir, '.attest-it', 'config.yaml')
  await readFile(configPath, 'utf-8')

  // Initialize git if requested
  if (initGit) {
    await execa('git', ['init'], { cwd: project.baseDir })
    await execa('git', ['config', 'user.name', 'Test User'], { cwd: project.baseDir })
    await execa('git', ['config', 'user.email', 'test@example.com'], { cwd: project.baseDir })
    await execa('git', ['add', '.'], { cwd: project.baseDir })
    await execa('git', ['commit', '-m', 'Initial commit'], { cwd: project.baseDir })
  }

  return project
}

/**
 * Verify that a project is ready for CLI operations.
 *
 * This ensures the config file is properly written and readable, addressing
 * CI file system sync issues.
 *
 * @param projectDir - Absolute path to the project directory
 * @throws {Error} If the config file is not readable or invalid
 */
export async function verifyProjectReady(projectDir: string): Promise<void> {
  const { readFile } = await import('node:fs/promises')
  const configPath = join(projectDir, '.attest-it', 'config.yaml')

  // Verify config exists and is readable
  const content = await readFile(configPath, 'utf-8')

  if (!content.includes('version: 1')) {
    throw new Error(`Config file at ${configPath} not properly written`)
  }

  // Small delay for CI file system latency
  if (process.env.CI) {
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
}

/**
 * Run a suite's tests without creating attestation, then create seal directly.
 *
 * This runs the actual test suite and generates a cryptographically signed
 * seal using the new Ed25519-based seal system (not the old RSA-based
 * attestation system).
 *
 * @param projectDir - Absolute path to the project directory
 * @param suiteName - Name of the suite to run and seal (must exist in config)
 * @param cliPath - Absolute path to the attest-it CLI executable
 * @param retries - Number of retries for flaky CI environments (default: 2)
 * @throws {Error} If the suite doesn't exist or seal creation fails
 * @example
 * await createRealAttestation(
 *   '/tmp/test-project',
 *   'unit-tests',
 *   '/path/to/cli/dist/bin/attest-it.js'
 * );
 */
export async function createRealAttestation(
  projectDir: string,
  suiteName: string,
  cliPath: string,
  retries = 2,
): Promise<void> {
  let lastError: Error | undefined
  const gateId = `${suiteName}-gate`

  for (let attempt = 0; attempt <= retries; attempt++) {
    // Run tests WITHOUT attestation (--no-attest) to avoid RSA signing
    const result = await execa('node', [cliPath, 'run', '--suite', suiteName, '--no-attest'], {
      cwd: projectDir,
      reject: false,
    })

    if (result.exitCode !== 0) {
      lastError = new Error(
        `Failed to run tests for suite "${suiteName}" (attempt ${String(attempt + 1)}/${String(retries + 1)}):\n` +
          `Exit code: ${String(result.exitCode ?? 'unknown')}\n` +
          `Stdout: ${result.stdout}\n` +
          `Stderr: ${result.stderr}`,
      )

      if (attempt < retries && (result.exitCode === 3 || result.exitCode === 5)) {
        if (process.env.CI) {
          console.log(
            `Retrying test run (attempt ${String(attempt + 2)}/${String(retries + 1)}) after ${String(200 * (attempt + 1))}ms...`,
          )
        }
        await new Promise((resolve) => setTimeout(resolve, 200 * (attempt + 1)))
        continue
      }

      break
    }

    // Tests passed - now create seal directly using Ed25519
    try {
      const { computeFingerprintSync } = await import('@attest-it/core')

      // Compute fingerprint for the gate (use projectDir as baseDir)
      const fingerprint = computeFingerprintSync({
        paths: ['.'],
        exclude: ['.attest-it/**'],
        baseDir: projectDir,
      })

      // Create seal using Ed25519 keys
      await createSealDirectly(projectDir, gateId, fingerprint.fingerprint)
      return // Success!
    } catch (sealError) {
      lastError = new Error(
        `Tests passed but failed to create seal for gate "${gateId}": ${sealError instanceof Error ? sealError.message : String(sealError)}`,
      )
      break
    }
  }

  if (lastError) {
    throw lastError
  }
  throw new Error(`Unexpected error creating attestation for suite "${suiteName}"`)
}

/**
 * Create a seal directly without running the CLI (faster for unit tests).
 *
 * @param projectDir - Absolute path to the project directory
 * @param gateId - Gate identifier (not suite name - use "${suiteName}-gate")
 * @param fingerprint - The fingerprint to seal
 */
export async function createSealDirectly(
  projectDir: string,
  gateId: string,
  fingerprint: string,
): Promise<void> {
  const keyPair = getFixtureKeyPair(projectDir)
  const seal = createSeal({
    gateId,
    fingerprint,
    sealedBy: 'test-user',
    privateKey: keyPair.privateKey,
  })

  const sealsFile: SealsFile = {
    version: 1,
    seals: { [gateId]: seal },
  }

  const fs = await import('node:fs/promises')
  const sealsPath = join(projectDir, '.attest-it', 'seals.json')
  await fs.writeFile(sealsPath, JSON.stringify(sealsFile, null, 2), 'utf-8')
}

/**
 * Pre-configured fixture: Multi-suite project with various states
 */
export async function createMultiSuiteFixture(): Promise<Project> {
  return createProjectFixture({
    name: 'multi-suite-project',
    suites: [
      {
        name: 'unit-tests',
        command: 'node -e "console.log(\'unit tests passed\')"',
        maxAge: '30d',
        groups: ['tests'],
      },
      {
        name: 'integration-tests',
        command: 'node -e "console.log(\'integration tests passed\')"',
        maxAge: '7d',
        groups: ['tests'],
      },
      {
        name: 'e2e-tests',
        command: 'node -e "console.log(\'e2e tests passed\')"',
        maxAge: '14d',
        groups: ['tests', 'slow'],
      },
      {
        name: 'linting',
        command: 'node -e "console.log(\'linting passed\')"',
        maxAge: '1d',
        groups: ['quality'],
      },
      {
        name: 'type-check',
        command: 'node -e "console.log(\'type check passed\')"',
        maxAge: '1d',
        groups: ['quality'],
      },
    ],
  })
}

/**
 * Pre-configured fixture: All missing attestations
 */
export async function createAllMissingFixture(): Promise<Project> {
  return createProjectFixture({
    name: 'all-missing-project',
    suites: [
      {
        name: 'suite-1',
        command: 'node -e "console.log(\'test 1\')"',
        maxAge: '30d',
      },
      {
        name: 'suite-2',
        command: 'node -e "console.log(\'test 2\')"',
        maxAge: '30d',
      },
      {
        name: 'suite-3',
        command: 'node -e "console.log(\'test 3\')"',
        maxAge: '30d',
      },
    ],
  })
}

/**
 * Pre-configured fixture: Complex groups structure
 */
export async function createComplexGroupsFixture(): Promise<Project> {
  return createProjectFixture({
    name: 'complex-groups-project',
    suites: [
      {
        name: 'frontend-unit',
        command: 'node -e "console.log(\'frontend unit\')"',
        maxAge: '30d',
        groups: ['frontend', 'unit', 'tests'],
      },
      {
        name: 'frontend-integration',
        command: 'node -e "console.log(\'frontend integration\')"',
        maxAge: '7d',
        groups: ['frontend', 'integration', 'tests'],
      },
      {
        name: 'backend-unit',
        command: 'node -e "console.log(\'backend unit\')"',
        maxAge: '30d',
        groups: ['backend', 'unit', 'tests'],
      },
      {
        name: 'backend-integration',
        command: 'node -e "console.log(\'backend integration\')"',
        maxAge: '7d',
        groups: ['backend', 'integration', 'tests'],
      },
      {
        name: 'e2e',
        command: 'node -e "console.log(\'e2e\')"',
        maxAge: '14d',
        groups: ['e2e', 'slow', 'tests'],
      },
      {
        name: 'security-scan',
        command: 'node -e "console.log(\'security scan\')"',
        maxAge: '1d',
        groups: ['security', 'quality'],
      },
    ],
  })
}

/**
 * Pre-configured fixture: Single failing suite
 */
export async function createFailingSuiteFixture(): Promise<Project> {
  return createProjectFixture({
    name: 'failing-suite-project',
    suites: [DEFAULT_PASSING_SUITE, DEFAULT_FAILING_SUITE],
  })
}
