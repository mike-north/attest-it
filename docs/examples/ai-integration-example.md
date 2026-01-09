# AI Integration Testing Example

Examples of testing AI assistant integrations with attest-it.

## Overview

AI assistants like Claude Code, GitHub Copilot, and ChatGPT require human verification because:

- Responses are non-deterministic
- Quality must be judged by humans
- Tool usage requires manual confirmation
- Context understanding needs human evaluation

## Testing Claude Code Integration

### Test Suite Structure

```typescript
import { describe, it, expect } from 'vitest'
import { confirm, select, input } from '@inquirer/prompts'

describe('Claude Code Integration', () => {
  const TIMEOUT = 300000 // 5 minutes

  it(
    'verifies Claude can discover and use custom tool',
    async () => {
      console.log('\n=== Claude Code Tool Discovery Test ===')
      console.log('Setup:')
      console.log('  1. Ensure tool is registered in claude.json')
      console.log('  2. Open Claude Code in this project')
      console.log('  3. Clear conversation history')
      console.log('========================================\n')

      await confirmStep('Ready to start?')

      console.log('\nPrompt to Claude:')
      console.log('  "I need to calculate a total. What tools do you have available?"\n')

      const toolsListed = await confirm({
        message: 'Did Claude list your custom calculate-total tool?',
      })
      expect(toolsListed).toBe(true)

      console.log('\nNow ask Claude:')
      console.log('  "Use the calculate-total tool with items [10, 20, 30]"\n')

      const toolInvoked = await confirm({
        message: 'Did Claude invoke the tool?',
      })
      expect(toolInvoked).toBe(true)

      const result = await input({
        message: 'What result did Claude report?',
      })
      expect(result.trim()).toBe('60')
    },
    TIMEOUT,
  )

  it(
    'verifies Claude handles tool errors gracefully',
    async () => {
      console.log('\n=== Tool Error Handling Test ===')
      console.log('Prompt Claude with invalid input:')
      console.log("  \"Use calculate-total with items ['invalid', 'data']\"")
      console.log('================================\n')

      await confirmStep('Ready?')

      const errorHandling = await select({
        message: 'How did Claude handle the error?',
        choices: [
          {
            name: 'Gracefully - explained the error and suggested fix',
            value: 'graceful',
          },
          {
            name: 'Acknowledged error but no solution',
            value: 'acknowledged',
          },
          {
            name: 'Ignored error or gave wrong response',
            value: 'poor',
          },
        ],
      })

      expect(errorHandling).toBe('graceful')
    },
    TIMEOUT,
  )

  it(
    'verifies Claude maintains context across tool calls',
    async () => {
      console.log('\n=== Context Maintenance Test ===')
      console.log('Multi-step interaction:')
      console.log('  1. "Calculate total of [5, 10, 15]"')
      console.log('  2. "Now double that result"')
      console.log('  3. "Add 10 to the previous answer"')
      console.log('=================================\n')

      const steps = [
        { prompt: 'Calculate total of [5, 10, 15]', expected: '30' },
        { prompt: 'Now double that result', expected: '60' },
        { prompt: 'Add 10 to the previous answer', expected: '70' },
      ]

      for (const step of steps) {
        console.log(`\nPrompt: "${step.prompt}"`)
        console.log(`Expected: ${step.expected}\n`)

        const correct = await confirm({
          message: `Did Claude give the correct result (${step.expected})?`,
        })
        expect(correct).toBe(true)
      }
    },
    TIMEOUT,
  )
})
```

## Testing GitHub Copilot

```typescript
describe('GitHub Copilot Integration', () => {
  it('provides relevant code completions', async () => {
    console.log('\n=== Copilot Completion Test ===')
    console.log('1. Open test file: examples/test.ts')
    console.log('2. Type: "function calculateDiscount(price: number, percentage: number) {"')
    console.log('3. Wait for Copilot suggestion')
    console.log('================================\n')

    await confirmStep('Ready?')

    const quality = await select({
      message: 'Rate the completion quality:',
      choices: [
        {
          name: 'Excellent - correct logic, handles edge cases',
          value: 'excellent',
        },
        {
          name: 'Good - correct logic, minor improvements needed',
          value: 'good',
        },
        {
          name: 'Acceptable - works but basic',
          value: 'acceptable',
        },
        {
          name: 'Poor - wrong or incomplete',
          value: 'poor',
        },
      ],
    })

    expect(['excellent', 'good']).toContain(quality)
  }, 300000)

  it('suggests appropriate test cases', async () => {
    console.log('\n=== Copilot Test Generation ===')
    console.log('1. Below your function, type: "describe(\'calculateDiscount\', () => {"')
    console.log('2. Press Enter and wait for Copilot')
    console.log('================================\n')

    const suggestions = await inquirer.prompt([
      {
        type: 'checkbox',
        name: 'testCases',
        message: 'Which test cases did Copilot suggest?',
        choices: [
          'Normal discount calculation',
          'Zero discount',
          '100% discount',
          'Negative values',
          'Invalid input handling',
          'Boundary values',
        ],
      },
    ])

    // Should suggest at least 3 important cases
    expect(suggestions.testCases.length).toBeGreaterThanOrEqual(3)
  }, 300000)
})
```

## Testing ChatGPT API Integration

```typescript
describe('ChatGPT API Integration', () => {
  it('maintains conversation context', async () => {
    console.log('\n=== ChatGPT Context Test ===')
    console.log('Send these prompts in sequence:')
    console.log('  1. "My name is Alice"')
    console.log('  2. "What is my name?"')
    console.log('  3. "What was the first thing I told you?"')
    console.log('============================\n')

    await confirmStep('Sent first message?')

    const rememberedName = await confirm({
      message: 'Did ChatGPT correctly recall your name (Alice)?',
    })
    expect(rememberedName).toBe(true)

    const rememberedContext = await confirm({
      message: 'Did ChatGPT recall the first message?',
    })
    expect(rememberedContext).toBe(true)
  }, 300000)

  it('follows system instructions', async () => {
    console.log('\n=== System Instructions Test ===')
    console.log('System prompt: "Always respond in JSON format"')
    console.log('User prompt: "What is 2 + 2?"')
    console.log('================================\n')

    const responseFormat = await select({
      message: 'What format was the response?',
      choices: [
        { name: 'Valid JSON', value: 'json' },
        { name: 'Text with JSON', value: 'mixed' },
        { name: 'Plain text', value: 'text' },
      ],
    })

    expect(responseFormat).toBe('json')

    if (responseFormat === 'json') {
      const validJSON = await confirm({
        message: 'Could you parse the JSON successfully?',
      })
      expect(validJSON).toBe(true)
    }
  }, 300000)
})
```

## Testing Tool/Function Calling

```typescript
describe('AI Tool Calling', () => {
  it('verifies function calling with weather API', async () => {
    console.log('\n=== Function Calling Test ===')
    console.log('Setup: Register weather tool with schema:')
    console.log(
      JSON.stringify(
        {
          name: 'get_weather',
          description: 'Get weather for a location',
          parameters: {
            location: { type: 'string' },
            units: { type: 'string', enum: ['celsius', 'fahrenheit'] },
          },
        },
        null,
        2,
      ),
    )
    console.log('\nPrompt: "What\'s the weather in San Francisco?"')
    console.log('=============================\n')

    const functionCalled = await confirm({
      message: 'Did the AI call the get_weather function?',
    })
    expect(functionCalled).toBe(true)

    const parameters = await inquirer.prompt([
      {
        type: 'input',
        name: 'location',
        message: 'What location parameter was passed?',
      },
      {
        type: 'list',
        name: 'units',
        message: 'What units parameter was passed?',
        choices: ['celsius', 'fahrenheit', 'none/missing'],
      },
    ])

    expect(parameters.location.toLowerCase()).toContain('san francisco')
    expect(['celsius', 'fahrenheit']).toContain(parameters.units)
  }, 300000)

  it('handles multi-tool scenarios', async () => {
    console.log('\n=== Multi-Tool Test ===')
    console.log('Available tools: get_weather, calculate_route, book_ride')
    console.log('Prompt: "Get weather for NYC, then plan a route to Brooklyn, then book a ride"')
    console.log('=======================\n')

    const toolsCalled = await inquirer.prompt([
      {
        type: 'checkbox',
        name: 'tools',
        message: 'Which tools did the AI call? (in order)',
        choices: ['get_weather', 'calculate_route', 'book_ride'],
      },
      {
        type: 'confirm',
        name: 'correctOrder',
        message: 'Were they called in the correct order?',
      },
    ])

    expect(toolsCalled.tools).toEqual(['get_weather', 'calculate_route', 'book_ride'])
    expect(toolsCalled.correctOrder).toBe(true)
  }, 600000)
})
```

## Testing Prompt Engineering

```typescript
describe('Prompt Quality', () => {
  it('verifies zero-shot performance', async () => {
    const testCases = [
      {
        prompt: 'Extract email addresses from: Contact us at info@company.com or sales@company.com',
        expected: ['info@company.com', 'sales@company.com'],
      },
      {
        prompt: 'Classify sentiment: This product is amazing!',
        expected: 'positive',
      },
    ]

    for (const test of testCases) {
      console.log(`\n=== Zero-Shot Test ===`)
      console.log(`Prompt: ${test.prompt}`)
      console.log(`Expected: ${JSON.stringify(test.expected)}`)
      console.log('======================\n')

      const correct = await confirm({
        message: 'Did the AI produce the expected output?',
      })
      expect(correct).toBe(true)
    }
  }, 300000)

  it('verifies few-shot learning', async () => {
    console.log('\n=== Few-Shot Learning Test ===')
    console.log('Examples provided:')
    console.log('  Input: "great" -> Output: "positive"')
    console.log('  Input: "terrible" -> Output: "negative"')
    console.log('  Input: "okay" -> Output: "neutral"')
    console.log('\nTest input: "fantastic"')
    console.log('==============================\n')

    const output = await input({
      message: 'What classification did the AI give?',
    })

    expect(output.toLowerCase()).toBe('positive')
  }, 300000)
})
```

## Helper Functions

```typescript
// test/helpers/ai-prompts.ts
import { confirm } from '@inquirer/prompts'

export async function confirmStep(message: string): Promise<void> {
  const ready = await confirm({
    message,
    default: true,
  })
  if (!ready) {
    throw new Error('Test aborted by user')
  }
}

export async function verifyAIResponse(prompt: string, expectedBehavior: string): Promise<boolean> {
  console.log(`\nPrompt: "${prompt}"`)
  console.log(`Expected: ${expectedBehavior}\n`)

  return await confirm({
    message: 'Did the AI respond as expected?',
    default: true,
  })
}

export async function captureAIOutput(label: string): Promise<string> {
  return await input({
    message: `${label}:`,
  })
}
```

## Configuration

### .attest-it/config.yaml

```yaml
version: 1

settings:
  maxAgeDays: 30
  publicKeyPath: .attest-it/pubkey.pem
  attestationsPath: .attest-it/attestations.json
  algorithm: ed25519

suites:
  ai-integration:
    description: Tests requiring AI assistant verification
    packages:
      - test/ai
      - src/ai-tools
    command: pnpm vitest test/ai
```

## Running Tests

```bash
# Run AI integration tests
pnpm vitest test/ai

# Create attestation
npx attest-it run --suite ai-integration
```

## Best Practices

### 1. Clear Instructions

Always provide clear context:

```typescript
console.log('\n=== Test Setup ===')
console.log('Prerequisites:')
console.log('  - Claude Code is running')
console.log('  - Project is loaded')
console.log('  - No prior conversation')
console.log('==================\n')
```

### 2. Capture Actual Output

Record what the AI actually said:

```typescript
const response = await input({
  message: 'Paste the AI response:',
})

// Store for later analysis
testResults.push({ prompt, response, timestamp: new Date() })
```

### 3. Test Error Scenarios

```typescript
it('handles invalid tool parameters', async () => {
  console.log('Try to invoke tool with wrong parameter types')

  const handling = await select({
    message: 'How did the AI handle it?',
    choices: [
      'Caught error and asked for correction',
      'Reported error clearly',
      'Crashed or gave confusing response',
    ],
  })

  expect(handling).not.toBe('Crashed or gave confusing response')
}, 300000)
```

### 4. Version AI Models

Track which model version you tested:

```typescript
beforeAll(() => {
  console.log('AI Model Info:')
  console.log('  Provider: Claude')
  console.log('  Model: claude-sonnet-4.5')
  console.log('  Date: 2026-01-08')
})
```

## Troubleshooting

### AI Not Available

```typescript
beforeAll(() => {
  const aiAvailable = await confirm({
    message: 'Is the AI assistant running and available?',
  })

  if (!aiAvailable) {
    throw new Error('AI assistant not available. Please start it and retry.')
  }
})
```

### Inconsistent Responses

Test multiple times:

```typescript
it('provides consistent responses', async () => {
  const attempts = 3
  const results = []

  for (let i = 0; i < attempts; i++) {
    console.log(`\nAttempt ${i + 1}/${attempts}`)
    const result = await verifyAIResponse('What is 2+2?', 'Should answer 4')
    results.push(result)
  }

  // Should be consistent
  const allCorrect = results.every((r) => r === true)
  expect(allCorrect).toBe(true)
}, 900000)
```

## See Also

- [Writing Desktop Tests](../writing-desktop-tests.md)
- [Vitest Example](vitest-example.md)
- [Jest Example](jest-example.md)
