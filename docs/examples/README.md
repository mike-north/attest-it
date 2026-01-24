# attest-it Examples

Complete examples of using attest-it for different testing scenarios.

## Available Examples

### [Vitest Desktop Tests](vitest-example.md)

Complete example using Vitest for desktop application testing.

**Covers:**

- Project setup and configuration
- Writing interactive tests with prompts
- Visual verification tests
- OAuth flow testing
- Helper functions and utilities
- Running and attesting tests

**Best for:**

- Modern TypeScript projects
- Fast test execution
- Projects already using Vite

### [Jest Desktop Tests](jest-example.md)

Complete example using Jest for desktop application testing.

**Covers:**

- Jest configuration for desktop tests
- Structured prompts with inquirer
- Multi-step workflow testing
- Performance verification
- Advanced patterns

**Best for:**

- Established projects using Jest
- Projects requiring Jest ecosystem
- More traditional test setups

### [AI Integration Testing](ai-integration-example.md)

Examples for testing AI assistants and integrations.

**Covers:**

- Testing Claude Code integration
- Testing GitHub Copilot
- Testing ChatGPT API
- Tool/function calling verification
- Prompt engineering tests
- Context maintenance verification

**Best for:**

- Projects with AI assistant integrations
- LLM-powered features
- Tool use verification
- Prompt quality testing

## Quick Start

Choose an example based on your needs:

1. **Using Vitest?** Start with [vitest-example.md](vitest-example.md)
2. **Using Jest?** Start with [jest-example.md](jest-example.md)
3. **Testing AI?** Start with [ai-integration-example.md](ai-integration-example.md)

## Common Patterns

All examples follow these patterns:

### 1. Clear Test Structure

```typescript
describe('Feature Name', () => {
  it('specific behavior that requires human verification', async () => {
    // 1. Setup
    // 2. Execute
    // 3. Human verification
    // 4. Assertions
  }, 300000) // 5 minute timeout
})
```

### 2. Interactive Prompts

```typescript
import { confirm } from '@inquirer/prompts'

const verified = await confirm({
  message: 'Does the UI display correctly?',
})
expect(verified).toBe(true)
```

### 3. Clear Instructions

```typescript
console.log('\n=== Test Name ===')
console.log('Steps to perform:')
console.log('  1. Action 1')
console.log('  2. Action 2')
console.log('  3. Verify result')
console.log('=================\n')
```

### 4. Proper Cleanup

```typescript
afterEach(() => {
  if (app) app.kill()
  // Clean up resources
})
```

## File Organization

Organize tests by type:

```
test/
├── unit/              # Automated unit tests (run in CI)
│   └── utils.test.ts
├── integration/       # Automated integration tests (run in CI)
│   └── api.test.ts
└── desktop/          # Human-verified tests (attest-it)
    ├── ui.test.ts
    ├── oauth.test.ts
    └── ai.test.ts
```

## Configuration Template

### Basic Configuration

```yaml
# .attest-it/config.yaml
version: 1

settings:
  maxAgeDays: 30
  publicKeyPath: .attest-it/pubkey.pem
  attestationsPath: .attest-it/attestations.json
  algorithm: ed25519

suites:
  desktop:
    description: Tests requiring human verification
    packages:
      - test/desktop
      - src/ui
    command: pnpm vitest --project desktop
```

### Multiple Suites

```yaml
version: 1

settings:
  maxAgeDays: 30
  algorithm: ed25519

suites:
  desktop-ui:
    description: Desktop UI verification
    packages:
      - test/desktop/ui
      - src/ui
    command: pnpm vitest test/desktop/ui

  oauth-flows:
    description: OAuth authentication flows
    packages:
      - test/desktop/oauth
      - src/auth
    command: pnpm vitest test/desktop/oauth

  ai-integration:
    description: AI assistant integration tests
    packages:
      - test/ai
      - src/ai-tools
    command: pnpm vitest test/ai
```

## Running Examples

### 1. Clone and Setup

```bash
# Clone the attest-it repository
git clone https://github.com/attest-it/attest-it.git
cd attest-it

# Install dependencies
npm install

# Create your signing identity
npx attest-it identity create

# Initialize configuration
npx attest-it init

# Add yourself to the project team
npx attest-it team join
```

### 2. Run a Specific Example

```bash
# Run desktop tests
npm run test:desktop

# Create attestation
npx attest-it run --suite desktop
```

### 3. Verify Attestations

```bash
# Check status
npx attest-it status

# Verify in CI
npx attest-it verify
```

## Package.json Template

```json
{
  "name": "my-project",
  "scripts": {
    "test": "vitest --project unit",
    "test:desktop": "vitest --project desktop",
    "test:ai": "vitest test/ai",
    "attest": "attest-it run --all",
    "attest:status": "attest-it status",
    "attest:verify": "attest-it verify"
  },
  "devDependencies": {
    "@inquirer/prompts": "^7.0.0",
    "attest-it": "^0.0.1",
    "vitest": "^3.0.0"
  }
}
```

## CI Configuration Template

```yaml
# .github/workflows/ci.yml
name: CI

on: [push, pull_request]

jobs:
  test:
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
      - run: npx attest-it verify
```

## Tips and Best Practices

### 1. Start Simple

Begin with a single simple test:

```typescript
it('launches and displays window', async () => {
  await launchApp()
  const visible = await confirm({
    message: 'Is the window visible?',
  })
  expect(visible).toBe(true)
}, 300000)
```

### 2. Use Timeouts

Always set long timeouts for human interaction:

```typescript
// 5 minutes for simple verification
it('test name', async () => { ... }, 300000)

// 10 minutes for complex flows
it('complex flow', async () => { ... }, 600000)
```

### 3. Provide Context

Help the tester understand what they're verifying:

```typescript
console.log('\n=== OAuth Flow Test ===')
console.log('This will test the complete OAuth login flow')
console.log('Expected behavior:')
console.log('  1. Browser opens to OAuth provider')
console.log('  2. Login page is displayed')
console.log('  3. After login, redirects back to app')
console.log('========================\n')
```

### 4. Break Down Complex Tests

Split complex workflows into smaller tests:

```typescript
// Instead of one giant test
it('completes full workflow', ...) // Too complex

// Break into steps
it('step 1: login', ...)
it('step 2: create item', ...)
it('step 3: edit item', ...)
it('step 4: delete item', ...)
```

### 5. Handle Cleanup

Always clean up, even if tests fail:

```typescript
let resource: Resource | null = null

afterEach(() => {
  if (resource) {
    resource.cleanup()
    resource = null
  }
})
```

## Troubleshooting

### Tests Don't Start

Check that you're not in CI:

```typescript
beforeAll(() => {
  if (process.env.CI) {
    throw new Error('Desktop tests cannot run in CI')
  }
})
```

### Prompts Not Appearing

Ensure stdio is properly configured:

```typescript
const app = spawn('command', ['args'], {
  stdio: 'inherit', // or ['inherit', 'inherit', 'inherit']
})
```

### Tests Timeout

Increase timeout or check if app hangs:

```typescript
it('test', async () => {
  // ...
}, 600000) // Increase to 10 minutes
```

## Contributing

Have an example to share? Please:

1. Follow the existing format
2. Include complete, runnable code
3. Add clear explanations
4. Test the example thoroughly

## See Also

- [Getting Started Guide](../getting-started.md)
- [Writing Desktop Tests](../writing-desktop-tests.md)
- [Configuration Reference](../configuration.md)
- [GitHub Integration](../github-integration.md)
