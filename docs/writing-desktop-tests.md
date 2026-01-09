# Writing Desktop Tests

Guide to writing tests that require human verification and work with attest-it.

## Overview

Desktop tests are tests that cannot run in headless CI because they require:

- Desktop applications (VS Code, Electron apps, browsers)
- Human visual verification
- Interactive prompts
- Real OAuth flows
- AI assistants

This guide shows patterns for writing such tests with popular test frameworks.

## General Principles

### 1. Use Interactive Prompts

Tests should pause and ask the human to verify:

```typescript
import { confirm } from '@inquirer/prompts'

const verified = await confirm({
  message: 'Does the UI display correctly?',
})
expect(verified).toBe(true)
```

### 2. Increase Timeouts

Human interaction takes longer than automated tests:

```typescript
it('opens settings dialog', async () => {
  // ... test code
}, 300000) // 5 minutes
```

### 3. Provide Clear Instructions

Help the human know what to verify:

```typescript
console.log('\n=== Manual Verification Required ===')
console.log('1. Check that the settings dialog opened')
console.log('2. Verify all tabs are visible')
console.log('3. Confirm the "Save" button is enabled')
console.log('=====================================\n')

const correct = await confirm({
  message: 'Is everything correct?',
})
```

### 4. Clean Up After Tests

Always clean up resources:

```typescript
let app: ChildProcess | null = null

afterEach(() => {
  if (app) {
    app.kill()
    app = null
  }
})
```

## Vitest Examples

### Basic Desktop Test

```typescript
import { describe, it, expect, afterEach } from 'vitest'
import { confirm } from '@inquirer/prompts'
import { spawn } from 'child_process'

describe('Desktop Integration', () => {
  let app: ChildProcess | null = null

  afterEach(() => {
    if (app) app.kill()
  })

  it('launches application successfully', async () => {
    // Launch the application
    app = spawn('my-app', ['--test-mode'], {
      stdio: 'inherit',
    })

    // Wait for app to start
    await new Promise((resolve) => setTimeout(resolve, 2000))

    // Human verification
    const launched = await confirm({
      message: 'Did the application window open?',
    })

    expect(launched).toBe(true)
  }, 300000)
})
```

### Visual Verification Test

```typescript
import { describe, it, expect } from 'vitest'
import { confirm, select } from '@inquirer/prompts'
import { renderUI } from './my-app'

describe('Visual Regression', () => {
  it('renders dashboard correctly', async () => {
    // Render the UI
    await renderUI({ page: 'dashboard' })

    console.log('\n=== Visual Verification ===')
    console.log('Check the following:')
    console.log('  - All widgets are displayed')
    console.log('  - No layout issues')
    console.log('  - Colors are correct')
    console.log('===========================\n')

    const result = await select({
      message: 'How does the dashboard look?',
      choices: [
        { name: 'Perfect - all checks pass', value: 'pass' },
        { name: 'Minor issues - acceptable', value: 'warn' },
        { name: 'Major issues - fail test', value: 'fail' },
      ],
    })

    expect(result).toBe('pass')
  }, 300000)
})
```

### Multi-Step Interaction Test

```typescript
import { describe, it, expect } from 'vitest'
import { confirm, input } from '@inquirer/prompts'

describe('Multi-Step Flow', () => {
  it('completes OAuth login flow', async () => {
    // Start OAuth flow
    console.log('Starting OAuth flow...')
    await startOAuthFlow()

    // Step 1: Browser opens
    const browserOpened = await confirm({
      message: 'Did the browser open with the login page?',
    })
    expect(browserOpened).toBe(true)

    // Step 2: Login
    console.log('Please log in with test credentials')
    const loggedIn = await confirm({
      message: 'Did you successfully log in?',
    })
    expect(loggedIn).toBe(true)

    // Step 3: Authorization
    const authorized = await confirm({
      message: 'Did you click "Authorize"?',
    })
    expect(authorized).toBe(true)

    // Step 4: Callback
    const callbackUrl = await input({
      message: 'Paste the callback URL from the browser:',
    })
    expect(callbackUrl).toMatch(/^http:\/\/localhost/)

    // Verify token
    const token = extractToken(callbackUrl)
    expect(token).toBeTruthy()
  }, 600000) // 10 minutes for multi-step
})
```

## Jest Examples

### Basic Pattern

```typescript
import { describe, it, expect, afterEach } from '@jest/globals'
import inquirer from 'inquirer'

describe('Desktop Tests', () => {
  it('verifies UI layout', async () => {
    await launchApp()

    const { correct } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'correct',
        message: 'Is the layout correct?',
        default: true,
      },
    ])

    expect(correct).toBe(true)
  }, 300000)
})
```

### With Test Helpers

```typescript
// test-helpers.ts
import inquirer from 'inquirer'

export async function verifyVisually(message: string, instructions?: string[]): Promise<boolean> {
  if (instructions) {
    console.log('\n=== Verification Steps ===')
    instructions.forEach((step, i) => {
      console.log(`${i + 1}. ${step}`)
    })
    console.log('==========================\n')
  }

  const { verified } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'verified',
      message,
      default: true,
    },
  ])

  return verified
}

// test file
import { verifyVisually } from './test-helpers'

it('settings dialog works', async () => {
  await openSettings()

  const correct = await verifyVisually('Does the settings dialog display correctly?', [
    'All tabs are visible',
    'Current settings are loaded',
    'Save button is enabled',
  ])

  expect(correct).toBe(true)
}, 300000)
```

## AI Assistant Tests

### Testing Claude Code Integration

```typescript
import { describe, it, expect } from 'vitest'
import { confirm, input } from '@inquirer/prompts'

describe('Claude Code Integration', () => {
  it('verifies Claude can use custom tool', async () => {
    console.log('\n=== Claude Code Test ===')
    console.log('1. Open Claude Code')
    console.log('2. Ask: "Use the calculate-total tool with items [10, 20, 30]"')
    console.log('3. Observe the response')
    console.log('========================\n')

    const toolUsed = await confirm({
      message: 'Did Claude successfully invoke the tool?',
    })
    expect(toolUsed).toBe(true)

    const result = await input({
      message: 'What result did Claude return?',
    })
    expect(result).toBe('60')
  }, 300000)

  it('verifies tool error handling', async () => {
    console.log('\n=== Error Handling Test ===')
    console.log('1. Ask Claude to use the tool with invalid input')
    console.log('2. Verify Claude handles the error gracefully')
    console.log('===========================\n')

    const errorHandled = await confirm({
      message: 'Did Claude handle the error correctly?',
    })
    expect(errorHandled).toBe(true)
  }, 300000)
})
```

### Testing GitHub Copilot

```typescript
describe('GitHub Copilot Integration', () => {
  it('provides correct completions', async () => {
    console.log('\n=== Copilot Test ===')
    console.log('1. Open VS Code with test file')
    console.log('2. Type: "function calculateTotal(items) {"')
    console.log('3. Wait for Copilot suggestion')
    console.log('4. Check if suggestion is correct')
    console.log('====================\n')

    const suggestionCorrect = await confirm({
      message: 'Did Copilot suggest a correct implementation?',
    })
    expect(suggestionCorrect).toBe(true)
  }, 300000)
})
```

## VS Code Extension Tests

```typescript
import { describe, it, expect } from 'vitest'
import { confirm, select } from '@inquirer/prompts'
import * as vscode from 'vscode'

describe('VS Code Extension', () => {
  it('registers command correctly', async () => {
    // Activate extension
    const ext = vscode.extensions.getExtension('my-extension')
    await ext?.activate()

    console.log('\n=== VS Code Extension Test ===')
    console.log('1. Open Command Palette (Cmd+Shift+P)')
    console.log('2. Type "My Extension: Test Command"')
    console.log('3. Press Enter')
    console.log('==============================\n')

    const commandWorked = await confirm({
      message: 'Did the command execute successfully?',
    })
    expect(commandWorked).toBe(true)
  }, 300000)

  it('displays notifications correctly', async () => {
    await vscode.commands.executeCommand('my-extension.notify')

    const notification = await select({
      message: 'Which notification appeared?',
      choices: [
        { name: 'Success notification (green)', value: 'success' },
        { name: 'Error notification (red)', value: 'error' },
        { name: 'Warning notification (yellow)', value: 'warning' },
        { name: 'No notification', value: 'none' },
      ],
    })

    expect(notification).toBe('success')
  }, 300000)
})
```

## Electron App Tests

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { confirm } from '@inquirer/prompts'
import { Application } from 'spectron'

describe('Electron App', () => {
  let app: Application

  beforeAll(async () => {
    app = new Application({
      path: './path/to/electron',
      args: ['./path/to/app'],
    })
    await app.start()
  }, 30000)

  afterAll(async () => {
    if (app && app.isRunning()) {
      await app.stop()
    }
  })

  it('opens main window', async () => {
    await app.client.waitUntilWindowLoaded()

    const windowOpened = await confirm({
      message: 'Did the main window open and display correctly?',
    })
    expect(windowOpened).toBe(true)
  }, 300000)

  it('menu items work', async () => {
    console.log('\n=== Menu Test ===')
    console.log('1. Click "File" menu')
    console.log('2. Click "Preferences"')
    console.log('3. Verify preferences dialog opens')
    console.log('=================\n')

    const menuWorks = await confirm({
      message: 'Did the preferences dialog open?',
    })
    expect(menuWorks).toBe(true)
  }, 300000)
})
```

## Browser-Based Tests

```typescript
import { describe, it, expect } from 'vitest'
import { confirm } from '@inquirer/prompts'
import { chromium } from 'playwright'

describe('Browser Tests', () => {
  it('OAuth flow completes', async () => {
    const browser = await chromium.launch({ headless: false })
    const page = await browser.newPage()

    // Navigate to OAuth page
    await page.goto('http://localhost:3000/oauth/start')

    console.log('\n=== OAuth Flow Test ===')
    console.log('Browser has opened to OAuth provider')
    console.log('Please complete the login manually')
    console.log('=======================\n')

    const completed = await confirm({
      message: 'Did the OAuth flow complete successfully?',
    })
    expect(completed).toBe(true)

    await browser.close()
  }, 600000)
})
```

## Test Organization

### Separate Desktop Tests

Keep desktop tests separate from unit tests:

```
test/
├── unit/           # Automated unit tests
│   ├── utils.test.ts
│   └── api.test.ts
├── integration/    # Automated integration tests
│   └── database.test.ts
└── desktop/        # Human-verified desktop tests
    ├── ui.test.ts
    ├── oauth.test.ts
    └── ai.test.ts
```

### Vitest Project Configuration

```typescript
// vitest.config.ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    projects: [
      {
        name: 'unit',
        include: ['test/unit/**/*.test.ts'],
      },
      {
        name: 'desktop',
        include: ['test/desktop/**/*.test.ts'],
        testTimeout: 300000, // 5 minutes
      },
    ],
  },
})
```

Run desktop tests:

```bash
npx vitest --project desktop
```

## Best Practices

### 1. Clear Test Names

```typescript
// Good: Descriptive
it('opens OAuth login in browser and completes authentication', ...)

// Avoid: Vague
it('test oauth', ...)
```

### 2. Timeout Configuration

```typescript
// Per-test timeout
it('long test', async () => {
  // ...
}, 300000)

// Per-file timeout
describe('Desktop Tests', () => {
  // All tests in this suite get 5 min timeout
  const TIMEOUT = 300000

  it(
    'test 1',
    async () => {
      // ...
    },
    TIMEOUT,
  )

  it(
    'test 2',
    async () => {
      // ...
    },
    TIMEOUT,
  )
})
```

### 3. Graceful Failures

```typescript
it('verifies UI', async () => {
  try {
    await launchApp()

    const verified = await confirm({
      message: 'Is the UI correct?',
    })

    expect(verified).toBe(true)
  } catch (error) {
    console.error('Test setup failed:', error)
    throw error
  } finally {
    // Always clean up
    await cleanupApp()
  }
}, 300000)
```

### 4. Reusable Helpers

```typescript
// test/helpers/prompts.ts
export async function verifyUI(message: string): Promise<void> {
  const correct = await confirm({ message })
  expect(correct).toBe(true)
}

export async function verifySteps(title: string, steps: string[]): Promise<void> {
  console.log(`\n=== ${title} ===`)
  steps.forEach((step, i) => console.log(`${i + 1}. ${step}`))
  console.log('===============\n')

  const correct = await confirm({
    message: 'All steps completed successfully?',
  })
  expect(correct).toBe(true)
}

// test file
import { verifyUI, verifySteps } from './helpers/prompts'

it('completes workflow', async () => {
  await verifySteps('OAuth Setup', [
    'Browser opens to login page',
    'Login with test credentials',
    'Grant permissions',
    'Return to app',
  ])
}, 300000)
```

### 5. Environment Setup

```typescript
// test/setup.ts
import { beforeAll } from 'vitest'

beforeAll(() => {
  // Ensure we're in test mode
  if (process.env.CI) {
    throw new Error('Desktop tests cannot run in CI')
  }

  // Set test environment
  process.env.NODE_ENV = 'test'
  process.env.APP_MODE = 'desktop-test'
})
```

## Troubleshooting

### Test Timeouts

Increase timeout for slow operations:

```typescript
it('slow operation', async () => {
  // ...
}, 600000) // 10 minutes
```

### Prompts Don't Appear

Ensure stdio is configured:

```typescript
const app = spawn('my-app', [], {
  stdio: 'inherit', // Important for prompts
})
```

### Tests Hang

Always set timeouts and clean up:

```typescript
afterEach(() => {
  // Force cleanup
  if (app) app.kill('SIGKILL')
})
```

## attest-it Integration

Configure attest-it for desktop tests:

```yaml
# .attest-it/config.yaml
suites:
  desktop:
    description: Tests requiring human verification
    packages:
      - test/desktop
      - src/ui
    command: pnpm vitest --project desktop
```

Run and attest:

```bash
npx attest-it run --suite desktop
```

## See Also

- [Getting Started](getting-started.md) - Setup guide
- [Configuration](configuration.md) - Config options
- [Examples](examples/README.md) - More test examples
