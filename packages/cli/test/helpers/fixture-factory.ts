/**
 * Fixture factory utilities for creating realistic test projects using fixturify-project.
 * These fixtures are used to test the interactive CLI experience with various project states.
 */

import { Project } from 'fixturify-project'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execa } from 'execa'
import { wrapWithSignatureErrorDetection } from './ai-friendly-errors.js'

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
 * Creates a realistic attest-it project fixture
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

  // Add .attest-it/config.yaml
  // Build suites as an object (not array)
  const suitesObj: Record<string, unknown> = {}
  suites.forEach((suite) => {
    const config: Record<string, unknown> = {
      description: `Test suite: ${suite.name}`,
      command: suite.command,
      packages: ['.'], // Required field - defaults to current directory
    }
    // Note: groups are not supported by the actual config schema
    suitesObj[suite.name] = config
  })

  // Generate YAML content with correct format
  const yamlLines = ['version: 1', '']

  // Add settings section with absolute paths for CI reliability
  const privateKeyPath = join(project.baseDir, '.attest-it', 'private.pem')
  const publicKeyPath = join(project.baseDir, '.attest-it', 'pubkey.pem')
  const attestationsPath = join(project.baseDir, '.attest-it', 'attestations.json')

  yamlLines.push('settings:')
  yamlLines.push(`  privateKeyPath: ${privateKeyPath}`)
  yamlLines.push(`  publicKeyPath: ${publicKeyPath}`)
  yamlLines.push(`  attestationsPath: ${attestationsPath}`)

  // Add default max age if any suite has one
  const maxAges = suites.map((s) => s.maxAge).filter((age): age is string => age !== undefined)
  if (maxAges.length > 0) {
    // Parse the first maxAge (e.g., "30d" -> 30)
    const firstMaxAge = maxAges[0]
    const days = parseInt(firstMaxAge.replace(/\D/g, ''), 10)
    yamlLines.push(`  maxAgeDays: ${days}`)
  }
  yamlLines.push('')

  // Add suites as object
  yamlLines.push('suites:')
  Object.entries(suitesObj).forEach(([suiteName, suiteConfig]) => {
    const cfg = suiteConfig as Record<string, unknown>
    yamlLines.push(`  ${suiteName}:`)
    yamlLines.push(`    description: "${cfg.description}"`)
    yamlLines.push(`    command: ${cfg.command}`)
    if (cfg.packages && Array.isArray(cfg.packages)) {
      yamlLines.push(`    packages:`)
      cfg.packages.forEach((pkg: string) => {
        yamlLines.push(`      - ${pkg}`)
      })
    }
    // Add ignore pattern to exclude .attest-it directory from fingerprinting
    yamlLines.push(`    ignore:`)
    yamlLines.push(`      - .attest-it/**`)
  })

  const yamlContent = yamlLines.join('\n')

  project.files['.attest-it'] = {
    'config.yaml': yamlContent,
    '.gitkeep': '',
  }

  // Add any additional files
  Object.entries(files).forEach(([path, content]) => {
    // Handle nested paths
    const parts = path.split('/')
    if (parts.length === 1) {
      project.files[path] = content
    } else {
      // Create nested structure
      let current = project.files as Record<string, unknown>
      for (let i = 0; i < parts.length - 1; i++) {
        if (!current[parts[i]]) {
          current[parts[i]] = {}
        }
        current = current[parts[i]] as Record<string, unknown>
      }
      current[parts[parts.length - 1]] = content
    }
  })

  // Write the project to disk
  await project.write()

  // Force file system sync - especially important in CI
  // Read the config file to ensure write completed
  const { readFile } = await import('node:fs/promises')
  const configPath = join(project.baseDir, '.attest-it', 'config.yaml')
  await readFile(configPath, 'utf-8')

  // Initialize git if requested
  if (initGit) {
    await execa('git', ['init'], { cwd: project.baseDir })
    await execa('git', ['config', 'user.name', 'Test User'], {
      cwd: project.baseDir,
    })
    await execa('git', ['config', 'user.email', 'test@example.com'], {
      cwd: project.baseDir,
    })
    await execa('git', ['add', '.'], { cwd: project.baseDir })
    await execa('git', ['commit', '-m', 'Initial commit'], {
      cwd: project.baseDir,
    })
  }

  // Note: Don't generate keypair here - let tests call setupProject() to do it
  // This ensures the keypair is generated and committed BEFORE creating attestations

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
 * Create a real attestation by running the CLI.
 *
 * This runs the actual test suite and generates a cryptographically signed
 * attestation, ensuring tests validate real-world behavior.
 *
 * @param projectDir - Absolute path to the project directory
 * @param suiteName - Name of the suite to attest (must exist in config)
 * @param cliPath - Absolute path to the attest-it CLI executable
 * @param retries - Number of retries for flaky CI environments (default: 2)
 * @throws {Error} If the suite doesn't exist or attestation creation fails
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

  for (let attempt = 0; attempt <= retries; attempt++) {
    const result = await execa('node', [cliPath, 'run', '--suite', suiteName, '--yes'], {
      cwd: projectDir,
      reject: false,
    })

    if (result.exitCode === 0) {
      return // Success!
    }

    // Save error for potential retry
    lastError = new Error(
      `Failed to create attestation for suite "${suiteName}" (attempt ${attempt + 1}/${retries + 1}):\n` +
        `Exit code: ${result.exitCode}\n` +
        `Stdout: ${result.stdout}\n` +
        `Stderr: ${result.stderr}`,
    )

    // If it's a config/key error and we have retries left, wait and retry
    // Exit code 3 = CONFIG_ERROR, Exit code 5 = MISSING_KEY
    if (attempt < retries && (result.exitCode === 3 || result.exitCode === 5)) {
      if (process.env.CI) {
        console.log(
          `Retrying attestation creation (attempt ${attempt + 2}/${retries + 1}) after ${200 * (attempt + 1)}ms...`,
        )
      }
      await new Promise((resolve) => setTimeout(resolve, 200 * (attempt + 1)))
      continue
    }

    break
  }

  throw lastError!
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
