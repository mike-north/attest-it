# Jest Desktop Test Example

Complete example of writing desktop tests with Jest and attest-it.

## Project Structure

```
my-project/
├── .attest-it/
│   ├── config.yaml
│   ├── pubkey.pem
│   └── attestations.json
├── src/
│   └── app.ts
├── test/
│   ├── unit/
│   │   └── utils.test.ts
│   └── desktop/
│       └── integration.test.ts
├── jest.config.js
└── package.json
```

## Configuration

### jest.config.js

```javascript
module.exports = {
  projects: [
    {
      displayName: 'unit',
      testMatch: ['<rootDir>/test/unit/**/*.test.ts'],
      testEnvironment: 'node',
      testTimeout: 10000,
    },
    {
      displayName: 'desktop',
      testMatch: ['<rootDir>/test/desktop/**/*.test.ts'],
      testEnvironment: 'node',
      testTimeout: 300000, // 5 minutes for desktop tests
    },
  ],
  preset: 'ts-jest',
}
```

### .attest-it/config.yaml

```yaml
version: 1

settings:
  maxAgeDays: 30
  publicKeyPath: .attest-it/pubkey.pem
  attestationsPath: .attest-it/attestations.json
  algorithm: ed25519

suites:
  desktop:
    description: Tests requiring desktop application verification
    packages:
      - test/desktop
      - src
    command: pnpm jest --selectProjects desktop
```

## Example Test Suite

### test/desktop/integration.test.ts

```typescript
import { describe, it, expect, beforeAll, afterEach } from '@jest/globals'
import inquirer from 'inquirer'
import { spawn, ChildProcess } from 'child_process'

describe('Desktop Integration Tests', () => {
  let app: ChildProcess | null = null

  beforeAll(() => {
    if (process.env.CI) {
      throw new Error('Desktop tests cannot run in CI')
    }
  })

  afterEach(() => {
    if (app) {
      app.kill()
      app = null
    }
  })

  it('launches application with correct UI', async () => {
    // Launch app
    app = spawn('npm', ['start'], {
      stdio: 'inherit',
      env: { ...process.env, NODE_ENV: 'test' },
    })

    // Wait for app to initialize
    await new Promise((resolve) => setTimeout(resolve, 3000))

    console.log('\n=== Application Launch Verification ===')
    console.log('Please verify:')
    console.log('  1. Application window is visible')
    console.log('  2. Title bar shows correct app name')
    console.log('  3. All UI elements are rendered')
    console.log('========================================\n')

    const answers = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'launched',
        message: 'Did the application launch successfully?',
        default: true,
      },
      {
        type: 'confirm',
        name: 'uiCorrect',
        message: 'Is the UI displayed correctly?',
        default: true,
        when: (answers) => answers.launched,
      },
    ])

    expect(answers.launched).toBe(true)
    expect(answers.uiCorrect).toBe(true)
  }, 300000)

  it('OAuth authentication flow works', async () => {
    console.log('\n=== OAuth Flow Test ===')
    console.log('This will open a browser window')
    console.log('=======================\n')

    // Trigger OAuth (in real test, this would call your OAuth function)
    console.log('Initiating OAuth flow...\n')

    const flowSteps = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'browserOpened',
        message: 'Did the browser open to the OAuth provider?',
        default: true,
      },
      {
        type: 'confirm',
        name: 'canLogin',
        message: 'Can you see the login form?',
        default: true,
        when: (answers) => answers.browserOpened,
      },
      {
        type: 'input',
        name: 'testCredentials',
        message: 'Enter test username (or skip):',
        default: 'test@example.com',
        when: (answers) => answers.canLogin,
      },
    ])

    expect(flowSteps.browserOpened).toBe(true)
    expect(flowSteps.canLogin).toBe(true)

    console.log('\nPlease complete the login in your browser...\n')

    const { completed } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'completed',
        message: 'Did the OAuth flow complete and redirect back to the app?',
        default: true,
      },
    ])

    expect(completed).toBe(true)
  }, 600000)

  it('settings panel displays and saves correctly', async () => {
    console.log('\n=== Settings Panel Test ===')
    console.log('Steps to perform:')
    console.log('  1. Open Settings (usually Cmd+, or File > Settings)')
    console.log('  2. Navigate through all tabs')
    console.log('  3. Make a change and click Save')
    console.log('===========================\n')

    // Wait for user to interact
    await new Promise((resolve) => {
      console.log('Press Enter when you have opened Settings...')
      process.stdin.once('data', resolve)
    })

    const verification = await inquirer.prompt([
      {
        type: 'checkbox',
        name: 'visibleTabs',
        message: 'Which tabs are visible in Settings?',
        choices: [
          { name: 'General', value: 'general' },
          { name: 'Appearance', value: 'appearance' },
          { name: 'Advanced', value: 'advanced' },
          { name: 'About', value: 'about' },
        ],
      },
      {
        type: 'confirm',
        name: 'canSave',
        message: 'Were you able to save your changes?',
        default: true,
      },
      {
        type: 'confirm',
        name: 'changesApplied',
        message: 'Did the changes take effect immediately?',
        default: true,
        when: (answers) => answers.canSave,
      },
    ])

    // Expect all tabs to be visible
    expect(verification.visibleTabs).toContain('general')
    expect(verification.visibleTabs).toContain('appearance')
    expect(verification.visibleTabs).toContain('advanced')
    expect(verification.visibleTabs).toContain('about')

    expect(verification.canSave).toBe(true)
    expect(verification.changesApplied).toBe(true)
  }, 300000)

  it('data export functionality works', async () => {
    console.log('\n=== Data Export Test ===')
    console.log('Testing export functionality')
    console.log('========================\n')

    const { exportType } = await inquirer.prompt([
      {
        type: 'list',
        name: 'exportType',
        message: 'Which export format would you like to test?',
        choices: ['JSON', 'CSV', 'XML'],
      },
    ])

    console.log(`\nPlease export data as ${exportType}:`)
    console.log('  1. Click File > Export')
    console.log(`  2. Select ${exportType} format`)
    console.log('  3. Choose save location')
    console.log('  4. Click Save\n')

    const exportVerification = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'dialogOpened',
        message: 'Did the export dialog open?',
        default: true,
      },
      {
        type: 'confirm',
        name: 'fileCreated',
        message: 'Was the file saved successfully?',
        default: true,
        when: (answers) => answers.dialogOpened,
      },
      {
        type: 'confirm',
        name: 'validFormat',
        message: 'Is the exported file in the correct format and readable?',
        default: true,
        when: (answers) => answers.fileCreated,
      },
    ])

    expect(exportVerification.dialogOpened).toBe(true)
    expect(exportVerification.fileCreated).toBe(true)
    expect(exportVerification.validFormat).toBe(true)
  }, 300000)
})
```

## Helper Module

### test/helpers/prompts.ts

```typescript
import inquirer from 'inquirer'

export interface VisualCheckResult {
  passed: boolean
  issues?: string[]
}

/**
 * Perform a visual verification with multiple checkpoints
 */
export async function verifyVisual(title: string, checks: string[]): Promise<VisualCheckResult> {
  console.log(`\n=== ${title} ===`)
  console.log('Please verify the following:')
  checks.forEach((check, i) => {
    console.log(`  ${i + 1}. ${check}`)
  })
  console.log('='.repeat(title.length + 8) + '\n')

  const { allPassed } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'allPassed',
      message: 'Do all checks pass?',
      default: true,
    },
  ])

  if (!allPassed) {
    const { issues } = await inquirer.prompt([
      {
        type: 'input',
        name: 'issues',
        message: 'Describe what failed:',
      },
    ])
    return { passed: false, issues: [issues] }
  }

  return { passed: true }
}

/**
 * Wait for user confirmation before continuing
 */
export async function waitForUser(message: string = 'Press Enter to continue...'): Promise<void> {
  console.log(message)
  return new Promise((resolve) => {
    process.stdin.once('data', () => resolve())
  })
}

/**
 * Get user rating on a scale
 */
export async function getUserRating(question: string, max: number = 5): Promise<number> {
  const { rating } = await inquirer.prompt([
    {
      type: 'list',
      name: 'rating',
      message: question,
      choices: Array.from({ length: max }, (_, i) => ({
        name: `${'★'.repeat(i + 1)}${'☆'.repeat(max - i - 1)}`,
        value: i + 1,
      })),
    },
  ])
  return rating
}
```

### test/helpers/app.ts

```typescript
import { spawn, ChildProcess } from 'child_process'

export interface AppOptions {
  command: string
  args?: string[]
  env?: Record<string, string>
  cwd?: string
}

export class TestApp {
  private process: ChildProcess | null = null

  async start(options: AppOptions): Promise<void> {
    this.process = spawn(options.command, options.args || [], {
      stdio: 'inherit',
      env: { ...process.env, ...options.env },
      cwd: options.cwd,
    })

    // Wait for app to initialize
    await new Promise((resolve) => setTimeout(resolve, 2000))
  }

  async stop(): Promise<void> {
    if (this.process) {
      this.process.kill()
      this.process = null
    }
  }

  isRunning(): boolean {
    return this.process !== null
  }
}
```

## Using Helpers in Tests

```typescript
import { verifyVisual, getUserRating, waitForUser } from './helpers/prompts'
import { TestApp } from './helpers/app'

describe('Desktop Tests with Helpers', () => {
  const app = new TestApp()

  afterEach(async () => {
    await app.stop()
  })

  it('verifies UI quality', async () => {
    await app.start({ command: 'npm', args: ['start'] })

    const result = await verifyVisual('Main Window', [
      'Window title is correct',
      'All menu items are visible',
      'Status bar shows correct info',
      'No visual glitches',
    ])

    expect(result.passed).toBe(true)

    const rating = await getUserRating('Rate the overall UI quality:', 5)
    expect(rating).toBeGreaterThanOrEqual(4)
  }, 300000)
})
```

## Running Tests

### Run Desktop Tests

```bash
# Run all desktop tests
pnpm jest --selectProjects desktop

# Run specific test file
pnpm jest test/desktop/integration.test.ts

# Run with verbose output
pnpm jest --selectProjects desktop --verbose

# Run in watch mode
pnpm jest --selectProjects desktop --watch
```

### Create Attestation

```bash
npx attest-it run --suite desktop
```

## Package.json Scripts

```json
{
  "scripts": {
    "test": "jest --selectProjects unit",
    "test:desktop": "jest --selectProjects desktop",
    "test:all": "jest",
    "attest": "attest-it run --suite desktop"
  },
  "devDependencies": {
    "@jest/globals": "^29.7.0",
    "@types/jest": "^29.5.0",
    "@types/inquirer": "^9.0.0",
    "inquirer": "^9.2.0",
    "jest": "^29.7.0",
    "ts-jest": "^29.1.0",
    "typescript": "^5.0.0"
  }
}
```

## Advanced Patterns

### Multi-Step Workflows

```typescript
it('completes full user workflow', async () => {
  const workflow = [
    {
      step: 'Login',
      action: 'Enter credentials and click Login',
      verify: 'Dashboard is visible',
    },
    {
      step: 'Create Item',
      action: 'Click New Item and fill form',
      verify: 'Item appears in list',
    },
    {
      step: 'Edit Item',
      action: 'Click item and modify details',
      verify: 'Changes are saved',
    },
    {
      step: 'Delete Item',
      action: 'Click delete and confirm',
      verify: 'Item removed from list',
    },
  ]

  for (const { step, action, verify } of workflow) {
    console.log(`\n--- ${step} ---`)
    console.log(`Action: ${action}`)
    console.log(`Verify: ${verify}\n`)

    await waitForUser('Press Enter when ready...')

    const { success } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'success',
        message: `Did ${step} complete successfully?`,
        default: true,
      },
    ])

    expect(success).toBe(true)
  }
}, 600000)
```

### Performance Verification

```typescript
it('verifies app performance', async () => {
  await app.start({ command: 'npm', args: ['start'] })

  const performance = await inquirer.prompt([
    {
      type: 'list',
      name: 'startupTime',
      message: 'How fast did the app start?',
      choices: [
        { name: 'Very fast (< 2 seconds)', value: 'excellent' },
        { name: 'Fast (2-5 seconds)', value: 'good' },
        { name: 'Acceptable (5-10 seconds)', value: 'ok' },
        { name: 'Slow (> 10 seconds)', value: 'poor' },
      ],
    },
    {
      type: 'list',
      name: 'responsiveness',
      message: 'How responsive is the UI?',
      choices: [
        { name: 'Instant response', value: 'excellent' },
        { name: 'Minor delays', value: 'good' },
        { name: 'Noticeable lag', value: 'poor' },
      ],
    },
  ])

  expect(['excellent', 'good']).toContain(performance.startupTime)
  expect(['excellent', 'good']).toContain(performance.responsiveness)
}, 300000)
```

## Best Practices

### 1. Structured Verification

Use inquirer's powerful prompt types:

```typescript
const verification = await inquirer.prompt([
  {
    type: 'checkbox',
    name: 'features',
    message: 'Which features are working?',
    choices: ['Feature A', 'Feature B', 'Feature C'],
  },
  {
    type: 'list',
    name: 'quality',
    message: 'Overall quality:',
    choices: ['Excellent', 'Good', 'Acceptable', 'Poor'],
  },
])
```

### 2. Error Context

Collect details when tests fail:

```typescript
const { passed } = await inquirer.prompt([
  { type: 'confirm', name: 'passed', message: 'Test passed?' },
])

if (!passed) {
  const { details } = await inquirer.prompt([
    { type: 'input', name: 'details', message: 'What went wrong?' },
  ])
  console.error('Test failed:', details)
}

expect(passed).toBe(true)
```

### 3. Conditional Prompts

Use `when` to show prompts conditionally:

```typescript
await inquirer.prompt([
  {
    type: 'confirm',
    name: 'error',
    message: 'Did an error occur?',
  },
  {
    type: 'input',
    name: 'errorMessage',
    message: 'What was the error message?',
    when: (answers) => answers.error,
  },
])
```

## See Also

- [Writing Desktop Tests Guide](../writing-desktop-tests.md)
- [Vitest Example](vitest-example.md)
- [Configuration Reference](../configuration.md)
