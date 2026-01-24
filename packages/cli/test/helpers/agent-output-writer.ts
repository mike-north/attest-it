/**
 * Agent output writer for manual test runner.
 *
 * Handles streaming markdown output and status tracking for AI agents
 * monitoring manual test runs.
 */

import { appendFile, writeFile } from 'node:fs/promises'
import { AgentStatusTracker, type ManualTestStatus } from './agent-status-tracker.js'

/**
 * Information about a command to execute.
 */
export interface CommandInfo {
  /** Command name (e.g., "status", "run-interactive") */
  name: string
  /** Human-readable description of what this command does */
  description: string
}

/**
 * Aggregate statistics for a test run.
 */
export interface Stats {
  /** Total number of commands */
  total: number
  /** Number of completed commands */
  completed: number
  /** Number of failed commands */
  failed: number
  /** Number of skipped commands */
  skipped: number
}

/**
 * Information about a test scenario.
 */
interface Scenario {
  /** Scenario key (e.g., "multi-suite") */
  key: string
  /** Human-readable scenario name */
  name: string
  /** Scenario description */
  description: string
}

/**
 * Writer for agent-friendly markdown output with streaming support.
 *
 * Provides:
 * - Streaming markdown output (append-only)
 * - Comprehensive agent instructions
 * - Status tracking via JSON file
 * - Buffering for efficiency
 */
export class AgentOutputWriter {
  private outputPath: string | null = null
  public statusTracker: AgentStatusTracker = new AgentStatusTracker()
  private buffer: string = ''
  private currentCommandIndex: number | null = null
  private commandStartTime: number | null = null
  private isInitialized = false

  /**
   * Initialize the output writer with file paths.
   */
  async init(outputPath: string, statusPath: string): Promise<void> {
    this.outputPath = outputPath

    // Initialize status tracker with empty state
    const initialStatus: ManualTestStatus = {
      version: 1,
      status: 'initializing',
      startTime: new Date().toISOString(),
      scenario: {
        key: '',
        name: '',
        description: '',
      },
      projectPath: '',
      commands: [],
      stats: {
        total: 0,
        completed: 0,
        failed: 0,
        skipped: 0,
      },
    }

    await this.statusTracker.init(statusPath, initialStatus)

    // Clear/create output file
    await writeFile(outputPath, '', 'utf-8')

    this.isInitialized = true
  }

  /**
   * Write the header section to the output file.
   */
  async writeHeader(scenario: Scenario, projectPath: string): Promise<void> {
    this.ensureInitialized()

    const header = `# Manual Test Run: ${scenario.name}

**Status**: Initializing
**Started**: ${new Date().toISOString()}
**Project Path**: \`${projectPath}\`

---

`

    await this.append(header)

    // Update status tracker
    await this.statusTracker.update({
      status: 'running',
      scenario,
      projectPath,
    })
  }

  /**
   * Write comprehensive agent instructions section.
   */
  async writeAgentInstructions(): Promise<void> {
    this.ensureInitialized()

    const instructions = `## Agent Instructions

### What is attest-it?

attest-it is a **human-gated test attestation system** that uses cryptographic signatures to prove that certain tests have been run and passed by a human operator. These are tests that **cannot run in CI** because they require:

- User interaction (OAuth flows, login screens)
- Visual validation (UI appearance, animations, layouts)
- Desktop/local environment access
- Manual judgment calls
- Hardware devices (cameras, microphones)

### Why Manual Tests?

This manual test runner validates the **CLI interface itself** - things like:
- Visual rendering (colors, tables, status badges)
- Interactive prompts and keyboard shortcuts
- Terminal compatibility and display artifacts
- User experience flows

**Important**: The test suites use **dummy commands** (just \`console.log\` statements) for UI testing. They're not testing real application code - they're testing that the CLI presents information correctly.

### Security Model

attest-it uses **asymmetric cryptography**:
- **Private key**: Stored in \`~/.config/attest-it/\` (NEVER in repository)
- **Public key**: Stored in repository for CI verification
- **Signatures**: Cryptographically prove a human ran the tests

This prevents AI assistants from faking attestations. Only a human with the private key can create valid attestations.

### Attestation Workflow

1. **Configure** (\`attest-it init\`): Define test suites in \`.attest-it/config.yaml\`
2. **Create Identity** (\`attest-it identity create\`): Create keypair (once per developer)
3. **Run & Attest** (\`attest-it run --suite <name>\`): Execute tests, create signed attestation
4. **Verify** (CI: \`attest-it verify\`): Confirm attestations are valid and current

### Working with Users

When running manual tests:

1. **Initiate the test**: Use \`--non-interactive --output <file>\` to start
2. **User runs commands**: They execute the test in their terminal
3. **Observe output**: Monitor the streaming markdown file for results
4. **Check status**: Poll the JSON status file for completion
5. **Interpret results**: Check exit codes and status badges
   - \`VALID\` (✓): Test passed, attestation created
   - \`NEEDS_ATTESTATION\`: No attestation exists yet
   - \`STALE\`: Attestation expired (older than maxAge)
   - \`CHANGED\`: Code changed since last attestation

### Exit Codes

- \`0\` (SUCCESS): All tests valid, nothing to do
- \`1\` (FAILURE): Tests failed OR has pending work
- \`2\` (NO_WORK): Nothing needed attestation
- \`3\` (CONFIG_ERROR): Configuration problem
- \`4\` (CANCELLED): User cancelled
- \`5\` (MISSING_KEY): Private key not found

**Note**: Exit code \`1\` when running \`attest-it status\` means "has pending work" - this is **not an error**, it's informational.

### How to Help Users

1. **Explain the context**: Why this test needs manual validation
2. **Provide the command**: Give them the exact command to paste
3. **Monitor progress**: Watch the output file for results
4. **Interpret results**: Explain what status badges mean
5. **Guide next steps**: Help them understand what attestations were created

### Resources

- Full documentation: See repository README.md
- Quick start guide: \`packages/cli/test/QUICKSTART.md\`
- Command reference: \`attest-it --help\`

---

## Commands

`

    await this.append(instructions)
  }

  /**
   * Start a new command section.
   */
  async startCommand(index: number, command: CommandInfo): Promise<void> {
    this.ensureInitialized()

    // Flush any pending buffer from previous command
    await this.flush()

    this.currentCommandIndex = index
    this.commandStartTime = Date.now()

    const header = `### ${index}. ${command.name} - ${command.description}

**Started**: ${new Date().toISOString()}

\`\`\`
`

    await this.append(header)

    // Update status tracker
    const status = this.statusTracker.getStatus()
    const commandList = status.commands || []

    await this.statusTracker.update({
      currentCommand: {
        index,
        name: command.name,
        status: 'running',
        startTime: new Date().toISOString(),
      },
      commands: commandList.map((cmd) =>
        cmd.index === index
          ? { ...cmd, status: 'running' as const, startTime: new Date().toISOString() }
          : cmd,
      ),
    })
  }

  /**
   * Append output from command execution.
   * Buffers for efficiency and flushes on command boundaries.
   *
   * @param content - Output text to append
   * @param _isError - Whether this is stderr output (reserved for future use, currently unused)
   */
  async appendOutput(content: string, _isError: boolean): Promise<void> {
    this.ensureInitialized()

    // Add to buffer
    this.buffer += content

    // Flush if buffer gets large (16KB threshold)
    if (this.buffer.length > 16 * 1024) {
      await this.flush()
    }
  }

  /**
   * Complete the current command section.
   */
  async completeCommand(exitCode: number, duration: number): Promise<void> {
    this.ensureInitialized()

    // Flush any remaining buffered output
    await this.flush()

    const footer = `\`\`\`

**Completed**: ${new Date().toISOString()} (${(duration / 1000).toFixed(1)}s)
**Exit Code**: ${exitCode}

`

    await this.append(footer)

    // Update status tracker
    const status = this.statusTracker.getStatus()
    const commandList = status.commands || []
    const updatedCommands = commandList.map((cmd) =>
      cmd.index === this.currentCommandIndex
        ? {
            ...cmd,
            status: (exitCode === 0 ? 'completed' : 'failed') as const,
            endTime: new Date().toISOString(),
            exitCode,
            duration,
          }
        : cmd,
    )

    // Update stats
    const stats = {
      total: status.stats.total,
      completed: updatedCommands.filter((c) => c.status === 'completed').length,
      failed: updatedCommands.filter((c) => c.status === 'failed').length,
      skipped: updatedCommands.filter((c) => c.status === 'skipped').length,
    }

    await this.statusTracker.update({
      commands: updatedCommands,
      stats,
      currentCommand: undefined,
    })

    this.currentCommandIndex = null
    this.commandStartTime = null
  }

  /**
   * Write final summary section.
   */
  async writeCompletion(stats: Stats): Promise<void> {
    this.ensureInitialized()

    await this.flush()

    const status = this.statusTracker.getStatus()
    const duration = Date.now() - new Date(status.startTime).getTime()

    const summary = `---

## Summary

**Total Commands**: ${stats.total}
**Completed**: ${stats.completed}
**Failed**: ${stats.failed}
**Skipped**: ${stats.skipped}

**Completed**: ${new Date().toISOString()}
**Duration**: ${(duration / 1000).toFixed(1)}s
`

    await this.append(summary)

    // Update status tracker
    await this.statusTracker.update({
      status: stats.failed > 0 ? 'failed' : 'completed',
      endTime: new Date().toISOString(),
      stats,
    })
  }

  /**
   * Update status without writing to markdown.
   */
  async updateStatus(updates: Partial<ManualTestStatus>): Promise<void> {
    this.ensureInitialized()
    await this.statusTracker.update(updates)
  }

  /**
   * Close the writer and flush any remaining buffer.
   */
  async close(): Promise<void> {
    if (this.isInitialized) {
      await this.flush()
    }
  }

  /**
   * Append content to the output file (unbuffered).
   */
  private async append(content: string): Promise<void> {
    if (!this.outputPath) {
      throw new Error('Output path not set')
    }
    await appendFile(this.outputPath, content, 'utf-8')
  }

  /**
   * Flush buffered content to output file.
   */
  private async flush(): Promise<void> {
    if (this.buffer.length > 0) {
      await this.append(this.buffer)
      this.buffer = ''
    }
  }

  private ensureInitialized(): void {
    if (!this.isInitialized) {
      throw new Error('Writer not initialized. Call init() first.')
    }
  }
}
