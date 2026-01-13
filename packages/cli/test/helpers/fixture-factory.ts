/**
 * Fixture factory utilities for creating realistic test projects using fixturify-project.
 * These fixtures are used to test the interactive CLI experience with various project states.
 */

import { Project } from 'fixturify-project';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execa } from 'execa';

export interface SuiteConfig {
  name: string;
  command: string;
  maxAge?: string;
  groups?: string[];
}

export interface AttestationConfig {
  suiteName: string;
  /**
   * Number of days ago the attestation was created.
   * Positive = in the past, negative = in the future (for testing)
   */
  daysOld?: number;
  /**
   * Whether to use a different fingerprint than the current test would produce
   */
  wrongFingerprint?: boolean;
  /**
   * Whether to make the signature invalid
   */
  invalidSignature?: boolean;
}

export interface ProjectFixtureOptions {
  name?: string;
  suites?: SuiteConfig[];
  attestations?: AttestationConfig[];
  /**
   * Whether to initialize as a git repository
   */
  initGit?: boolean;
  /**
   * Whether to generate keypair
   */
  generateKeys?: boolean;
  /**
   * Additional files to include in the project
   */
  files?: Record<string, string>;
}

/**
 * Default passing test suite
 */
const DEFAULT_PASSING_SUITE: SuiteConfig = {
  name: 'example',
  command: 'node -e "console.log(\'test passed\')"',
  maxAge: '30d',
  groups: ['unit-tests'],
};

/**
 * Default failing test suite
 */
const DEFAULT_FAILING_SUITE: SuiteConfig = {
  name: 'failing',
  command: 'node -e "process.exit(1)"',
  maxAge: '30d',
  groups: ['unit-tests'],
};

/**
 * Creates a realistic attest-it project fixture
 */
export async function createProjectFixture(
  options: ProjectFixtureOptions = {},
): Promise<Project> {
  const {
    name = 'test-project',
    suites = [DEFAULT_PASSING_SUITE],
    attestations = [],
    initGit = true,
    generateKeys = true,
    files = {},
  } = options;

  // Create the project
  const project = new Project(name, { root: tmpdir() });

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
  );

  // Add .attest-it/config.yaml
  // Build suites as an object (not array)
  const suitesObj: Record<string, unknown> = {};
  suites.forEach((suite) => {
    const config: Record<string, unknown> = {
      description: `Test suite: ${suite.name}`,
      command: suite.command,
      packages: ['.'], // Required field - defaults to current directory
    };
    // Note: groups are not supported by the actual config schema
    suitesObj[suite.name] = config;
  });

  // Generate YAML content with correct format
  const yamlLines = ['version: 1', ''];

  // Add settings section
  yamlLines.push('settings:');
  yamlLines.push('  publicKeyPath: .attest-it/pubkey.pem');
  yamlLines.push('  attestationsPath: .attest-it/attestations.json');

  // Add default max age if any suite has one
  const maxAges = suites
    .map((s) => s.maxAge)
    .filter((age): age is string => age !== undefined);
  if (maxAges.length > 0) {
    // Parse the first maxAge (e.g., "30d" -> 30)
    const firstMaxAge = maxAges[0];
    const days = parseInt(firstMaxAge.replace(/\D/g, ''), 10);
    yamlLines.push(`  maxAgeDays: ${days}`);
  }
  yamlLines.push('');

  // Add suites as object
  yamlLines.push('suites:');
  Object.entries(suitesObj).forEach(([suiteName, suiteConfig]) => {
    const cfg = suiteConfig as Record<string, unknown>;
    yamlLines.push(`  ${suiteName}:`);
    yamlLines.push(`    description: "${cfg.description}"`);
    yamlLines.push(`    command: ${cfg.command}`);
    if (cfg.packages && Array.isArray(cfg.packages)) {
      yamlLines.push(`    packages:`);
      cfg.packages.forEach((pkg: string) => {
        yamlLines.push(`      - ${pkg}`);
      });
    }
  });

  const yamlContent = yamlLines.join('\n');

  project.files['.attest-it'] = {
    'config.yaml': yamlContent,
    '.gitkeep': '',
  };

  // Add any additional files
  Object.entries(files).forEach(([path, content]) => {
    // Handle nested paths
    const parts = path.split('/');
    if (parts.length === 1) {
      project.files[path] = content;
    } else {
      // Create nested structure
      let current = project.files as Record<string, unknown>;
      for (let i = 0; i < parts.length - 1; i++) {
        if (!current[parts[i]]) {
          current[parts[i]] = {};
        }
        current = current[parts[i]] as Record<string, unknown>;
      }
      current[parts[parts.length - 1]] = content;
    }
  });

  // Write the project to disk
  await project.write();

  // Initialize git if requested
  if (initGit) {
    await execa('git', ['init'], { cwd: project.baseDir });
    await execa('git', ['config', 'user.name', 'Test User'], {
      cwd: project.baseDir,
    });
    await execa('git', ['config', 'user.email', 'test@example.com'], {
      cwd: project.baseDir,
    });
    await execa('git', ['add', '.'], { cwd: project.baseDir });
    await execa('git', ['commit', '-m', 'Initial commit'], {
      cwd: project.baseDir,
    });
  }

  // Generate keypair if requested
  if (generateKeys) {
    const cliPath = join(
      process.cwd(),
      '../../packages/cli/dist/bin/attest-it.js',
    );
    try {
      await execa('node', [cliPath, 'keygen', '--force'], {
        cwd: project.baseDir,
      });
    } catch (error) {
      console.warn(
        'Could not generate keys (CLI may not be built):',
        error,
      );
    }
  }

  // Create attestations if requested
  for (const attestation of attestations) {
    await createAttestation(project, attestation);
  }

  return project;
}

/**
 * Creates an attestation for a suite
 */
async function createAttestation(
  project: Project,
  config: AttestationConfig,
): Promise<void> {
  const { suiteName, daysOld = 0, wrongFingerprint = false } = config;

  // For now, just create a placeholder attestation file
  // In a real implementation, we'd need to:
  // 1. Run the test to get the real fingerprint
  // 2. Sign it with the private key
  // 3. Adjust the timestamp if daysOld is set
  // 4. Modify the fingerprint if wrongFingerprint is true

  const attestationPath = `.attest-it/attestations/${suiteName}.json`;

  // Calculate timestamp
  const now = Date.now();
  const timestamp = new Date(now - daysOld * 24 * 60 * 60 * 1000).toISOString();

  const attestation = {
    suite: suiteName,
    timestamp,
    fingerprint: wrongFingerprint ? 'wrong-fingerprint' : 'placeholder',
    signature: 'placeholder-signature',
  };

  // Add to project files
  if (!project.files['.attest-it']) {
    project.files['.attest-it'] = {};
  }
  const attestItDir = project.files['.attest-it'] as Record<string, unknown>;
  if (!attestItDir.attestations) {
    attestItDir.attestations = {};
  }
  const attestationsDir = attestItDir.attestations as Record<string, unknown>;
  attestationsDir[`${suiteName}.json`] = JSON.stringify(attestation, null, 2);

  // Re-write the project
  await project.write();
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
    attestations: [
      // unit-tests: fresh attestation
      { suiteName: 'unit-tests', daysOld: 1 },
      // integration-tests: expired
      { suiteName: 'integration-tests', daysOld: 10 },
      // e2e-tests: no attestation (missing)
      // linting: wrong fingerprint
      { suiteName: 'linting', wrongFingerprint: true },
      // type-check: fresh and valid
      { suiteName: 'type-check', daysOld: 0 },
    ],
  });
}

/**
 * Pre-configured fixture: All valid suites
 */
export async function createAllValidFixture(): Promise<Project> {
  return createProjectFixture({
    name: 'all-valid-project',
    suites: [
      {
        name: 'tests',
        command: 'node -e "console.log(\'tests passed\')"',
        maxAge: '30d',
      },
    ],
    attestations: [{ suiteName: 'tests', daysOld: 1 }],
  });
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
    attestations: [],
  });
}

/**
 * Pre-configured fixture: All expired attestations
 */
export async function createAllExpiredFixture(): Promise<Project> {
  return createProjectFixture({
    name: 'all-expired-project',
    suites: [
      {
        name: 'suite-1',
        command: 'node -e "console.log(\'test 1\')"',
        maxAge: '30d',
      },
      {
        name: 'suite-2',
        command: 'node -e "console.log(\'test 2\')"',
        maxAge: '7d',
      },
    ],
    attestations: [
      { suiteName: 'suite-1', daysOld: 35 },
      { suiteName: 'suite-2', daysOld: 10 },
    ],
  });
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
    attestations: [],
  });
}

/**
 * Pre-configured fixture: Single failing suite
 */
export async function createFailingSuiteFixture(): Promise<Project> {
  return createProjectFixture({
    name: 'failing-suite-project',
    suites: [DEFAULT_PASSING_SUITE, DEFAULT_FAILING_SUITE],
    attestations: [],
  });
}
