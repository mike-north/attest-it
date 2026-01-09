# Vitest Desktop Test Example

Complete example of writing desktop tests with Vitest and attest-it.

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
├── package.json
└── vitest.config.ts
```

## Configuration

### vitest.config.ts

```typescript
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Separate unit and desktop tests
    projects: [
      {
        name: 'unit',
        include: ['test/unit/**/*.test.ts'],
        testTimeout: 10000, // 10 seconds for unit tests
      },
      {
        name: 'desktop',
        include: ['test/desktop/**/*.test.ts'],
        testTimeout: 300000, // 5 minutes for desktop tests
      },
    ],
  },
})
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
    command: pnpm vitest --project desktop
```

## Example Test Suite

### test/desktop/integration.test.ts

```typescript
import { describe, it, expect, beforeAll, afterEach } from 'vitest'
import { confirm, select, input } from '@inquirer/prompts'
import { spawn, ChildProcess } from 'child_process'
import { waitForServer } from '../helpers'

describe('Desktop Integration Tests', () => {
  let app: ChildProcess | null = null

  beforeAll(() => {
    // Ensure we're not in CI
    if (process.env.CI) {
      throw new Error('Desktop tests cannot run in CI')
    }
  })

  afterEach(() => {
    // Clean up app process
    if (app) {
      app.kill()
      app = null
    }
  })

  it('launches application and displays main window', async () => {
    // Launch the application
    app = spawn('npm', ['start'], {
      stdio: 'inherit',
      env: { ...process.env, NODE_ENV: 'test' },
    })

    // Wait for app to start
    await waitForServer('http://localhost:3000', 10000)

    console.log('\n=== Application Launched ===')
    console.log('The application should be visible on your screen')
    console.log('Verify the following:')
    console.log('  ✓ Main window opened')
    console.log('  ✓ Title bar is correct')
    console.log('  ✓ Menu bar is visible')
    console.log('============================\n')

    const windowVisible = await confirm({
      message: 'Is the main window displayed correctly?',
      default: true,
    })

    expect(windowVisible).toBe(true)
  }, 300000)

  it('settings dialog displays all options', async () => {
    // This assumes app is already running from previous test
    // or launch it here if needed
    console.log('\n=== Settings Dialog Test ===')
    console.log('Steps to perform:')
    console.log('  1. Click "Settings" menu')
    console.log('  2. Click "Preferences"')
    console.log('  3. Verify all tabs are visible')
    console.log('============================\n')

    // Wait for user to open settings
    await new Promise((resolve) => {
      console.log('Press Enter when ready to verify...')
      process.stdin.once('data', resolve)
    })

    const dialogCorrect = await confirm({
      message: 'Does the settings dialog display correctly?',
      default: true,
    })
    expect(dialogCorrect).toBe(true)

    const allTabs = await confirm({
      message: 'Are all tabs visible (General, Advanced, About)?',
      default: true,
    })
    expect(allTabs).toBe(true)

    const canSave = await confirm({
      message: 'Is the Save button enabled?',
      default: true,
    })
    expect(canSave).toBe(true)
  }, 300000)

  it('verifies OAuth login flow', async () => {
    console.log('\n=== OAuth Login Test ===')
    console.log('This test will open your browser')
    console.log('========================\n')

    // Trigger OAuth flow
    console.log('Starting OAuth flow...')

    // In real app, this would trigger the OAuth flow
    // For demo, we just simulate it
    const browserOpened = await confirm({
      message: 'Did your browser open to the OAuth provider?',
      default: true,
    })
    expect(browserOpened).toBe(true)

    console.log('\nPlease complete the login in your browser:')
    console.log('  1. Log in with test credentials')
    console.log('  2. Click "Authorize"')
    console.log('  3. Wait for redirect\n')

    const loginSucceeded = await confirm({
      message: 'Did the login complete successfully?',
      default: true,
    })
    expect(loginSucceeded).toBe(true)

    const tokenReceived = await confirm({
      message: 'Did the app receive the OAuth token?',
      default: true,
    })
    expect(tokenReceived).toBe(true)
  }, 600000) // 10 minutes for OAuth flow

  it('renders data visualization correctly', async () => {
    console.log('\n=== Data Visualization Test ===')
    console.log('Navigate to the dashboard in the app')
    console.log('===============================\n')

    await new Promise((resolve) => {
      console.log('Press Enter when dashboard is loaded...')
      process.stdin.once('data', resolve)
    })

    const visualization = await select({
      message: 'How does the data visualization look?',
      choices: [
        {
          name: 'Perfect - all data points visible, no rendering issues',
          value: 'perfect',
        },
        {
          name: 'Minor issues - acceptable but could be improved',
          value: 'acceptable',
        },
        {
          name: 'Major issues - data missing or rendering broken',
          value: 'broken',
        },
      ],
    })

    expect(visualization).toBe('perfect')

    // If there were issues, collect details
    if (visualization !== 'perfect') {
      const issues = await input({
        message: 'Describe the issues:',
      })
      console.log('Issues reported:', issues)
    }
  }, 300000)

  it('handles file upload correctly', async () => {
    console.log('\n=== File Upload Test ===')
    console.log('Steps:')
    console.log('  1. Click "Upload" button')
    console.log('  2. Select a test file')
    console.log('  3. Verify file appears in list')
    console.log('========================\n')

    const uploadWorks = await confirm({
      message: 'Did the file upload successfully?',
      default: true,
    })
    expect(uploadWorks).toBe(true)

    const fileInList = await confirm({
      message: 'Does the file appear in the file list?',
      default: true,
    })
    expect(fileInList).toBe(true)

    const canRemove = await confirm({
      message: 'Can you remove the file by clicking the X button?',
      default: true,
    })
    expect(canRemove).toBe(true)
  }, 300000)
})
```

## Helper Functions

### test/helpers.ts

```typescript
import { fetch } from 'undici'

/**
 * Wait for a server to be available
 */
export async function waitForServer(url: string, timeout: number = 30000): Promise<void> {
  const startTime = Date.now()

  while (Date.now() - startTime < timeout) {
    try {
      await fetch(url)
      return // Server is up
    } catch {
      // Server not ready, wait and retry
      await new Promise((resolve) => setTimeout(resolve, 500))
    }
  }

  throw new Error(`Server at ${url} did not start within ${timeout}ms`)
}

/**
 * Wait for a specific duration
 */
export async function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Verify a visual element with structured prompts
 */
export async function verifyVisual(title: string, checks: string[]): Promise<void> {
  console.log(`\n=== ${title} ===`)
  checks.forEach((check, i) => {
    console.log(`  ${i + 1}. ${check}`)
  })
  console.log('='.repeat(title.length + 8) + '\n')

  const { confirm } = await import('@inquirer/prompts')
  const verified = await confirm({
    message: 'All checks passed?',
    default: true,
  })

  if (!verified) {
    throw new Error('Visual verification failed')
  }
}
```

## Running the Tests

### Run Desktop Tests Locally

```bash
# Run all desktop tests
pnpm vitest --project desktop

# Run specific test file
pnpm vitest test/desktop/integration.test.ts

# Run in watch mode
pnpm vitest --project desktop --watch
```

### Create Attestation

```bash
# Run tests and create attestation
npx attest-it run --suite desktop

# Or with auto-confirm
npx attest-it run --suite desktop --yes
```

### Check Status

```bash
npx attest-it status
```

## Package.json Scripts

```json
{
  "scripts": {
    "test": "vitest --project unit",
    "test:desktop": "vitest --project desktop",
    "test:all": "vitest",
    "attest": "attest-it run --suite desktop",
    "attest:status": "attest-it status"
  }
}
```

## CI Configuration

Desktop tests should NOT run in CI. Only verify attestations:

```yaml
# .github/workflows/ci.yml
name: CI

on: [push, pull_request]

jobs:
  unit-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: npm ci
      - run: npm test # Unit tests only

  verify-attestations:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
      - run: npm ci
      - run: npx attest-it verify # Verify desktop tests were attested
```

## Best Practices

### 1. Clear Test Structure

Organize tests logically:

```typescript
describe('Feature Name', () => {
  describe('Sub-feature', () => {
    it('specific behavior', async () => {
      // Test code
    }, 300000)
  })
})
```

### 2. Descriptive Output

Help the tester understand what to do:

```typescript
console.log('\n=== Test Name ===')
console.log('What you should see:')
console.log('  - Expected behavior 1')
console.log('  - Expected behavior 2')
console.log('==================\n')
```

### 3. Multiple Verification Points

Don't just ask one yes/no question:

```typescript
// Good: Multiple specific checks
const windowOpen = await confirm({ message: 'Window opened?' })
const titleCorrect = await confirm({ message: 'Title correct?' })
const menuVisible = await confirm({ message: 'Menu visible?' })

expect(windowOpen).toBe(true)
expect(titleCorrect).toBe(true)
expect(menuVisible).toBe(true)

// Avoid: Single vague question
const everythingOk = await confirm({ message: 'Everything OK?' })
```

### 4. Cleanup

Always clean up resources:

```typescript
afterEach(async () => {
  if (app) {
    app.kill()
    app = null
  }
  // Close any open windows
  // Reset any global state
})
```

### 5. Environment Checks

Prevent desktop tests from running in CI:

```typescript
beforeAll(() => {
  if (process.env.CI) {
    throw new Error('Desktop tests cannot run in CI')
  }
})
```

## Troubleshooting

### Prompts Don't Appear

Ensure stdin is available:

```typescript
const app = spawn('npm', ['start'], {
  stdio: 'inherit', // or ['inherit', 'inherit', 'inherit']
})
```

### Tests Time Out

Increase timeout:

```typescript
it('slow test', async () => {
  // ...
}, 600000) // 10 minutes
```

### App Doesn't Start

Add logging and waits:

```typescript
app = spawn('npm', ['start'], {
  stdio: 'inherit',
})

console.log('Waiting for app to start...')
await waitForServer('http://localhost:3000', 30000)
console.log('App started!')
```

## Advanced Patterns

### Conditional Tests

Skip tests based on environment:

```typescript
it.skipIf(process.platform !== 'darwin')(
  'macOS-specific test',
  async () => {
    // Only runs on macOS
  },
  300000,
)
```

### Parameterized Tests

Test multiple scenarios:

```typescript
const scenarios = [
  { name: 'Light Theme', theme: 'light' },
  { name: 'Dark Theme', theme: 'dark' },
]

scenarios.forEach(({ name, theme }) => {
  it(`renders correctly with ${name}`, async () => {
    await setTheme(theme)
    const correct = await confirm({
      message: `Does the ${name} look correct?`,
    })
    expect(correct).toBe(true)
  }, 300000)
})
```

## See Also

- [Writing Desktop Tests Guide](../writing-desktop-tests.md)
- [Configuration Reference](../configuration.md)
- [Jest Example](jest-example.md)
- [AI Integration Example](ai-integration-example.md)
