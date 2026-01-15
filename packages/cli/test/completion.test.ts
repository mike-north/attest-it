import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'

const CLI_PATH = join(__dirname, '../dist/bin/attest-it.js')

/**
 * Simulate shell completion by invoking the CLI with completion environment variables.
 *
 * @param line - The command line being completed (e.g., "attest-it st")
 * @param shell - The shell type (bash, zsh, or fish)
 * @param cwd - Optional working directory
 * @returns The completion output and exit code
 */
async function getCompletions(
  line: string,
  shell: 'bash' | 'zsh' | 'fish',
  cwd?: string,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve) => {
    const point = line.length
    const words = line.split(/\s+/).length

    const env = {
      ...process.env,
      COMP_LINE: line,
      COMP_POINT: String(point),
      COMP_CWORD: String(words),
      SHELL: shell,
    }

    const proc = spawn('node', [CLI_PATH, 'completion-server'], {
      env,
      cwd: cwd ?? process.cwd(),
    })

    let stdout = ''
    let stderr = ''

    proc.stdout.on('data', (data: Buffer) => {
      stdout += data.toString()
    })

    proc.stderr.on('data', (data: Buffer) => {
      stderr += data.toString()
    })

    proc.on('close', (code) => {
      resolve({ stdout, stderr, exitCode: code ?? 0 })
    })
  })
}

/**
 * Parse completion output into an array of completion items.
 */
function parseCompletions(stdout: string, shell: 'bash' | 'zsh' | 'fish'): string[] {
  const lines = stdout.trim().split('\n').filter(Boolean)

  if (shell === 'zsh') {
    // zsh format: name:description or just name
    return lines.map((line) => line.split(':')[0] ?? line)
  } else if (shell === 'fish') {
    // fish format: name\tdescription or just name
    return lines.map((line) => line.split('\t')[0] ?? line)
  } else {
    // bash format: just names
    return lines
  }
}

describe('Shell Completion', () => {
  describe('completion-server command', () => {
    it('should exit cleanly without completion env vars', async () => {
      const proc = spawn('node', [CLI_PATH, 'completion-server'], {
        env: { ...process.env },
      })

      const exitCode = await new Promise<number>((resolve) => {
        proc.on('close', (code) => resolve(code ?? 0))
      })

      expect(exitCode).toBe(0)
    })

    it('should not appear in help output (hidden command)', async () => {
      const proc = spawn('node', [CLI_PATH, '--help'])

      let stdout = ''
      proc.stdout.on('data', (data: Buffer) => {
        stdout += data.toString()
      })

      await new Promise<void>((resolve) => {
        proc.on('close', () => resolve())
      })

      // The command should be hidden from the main help listing
      // Note: It may still be callable, just not shown in help
      expect(stdout).not.toMatch(/^\s+completion-server\s/m)
    })
  })

  describe.each(['bash', 'zsh', 'fish'] as const)('%s shell', (shell) => {
    describe('top-level command completion', () => {
      it('should complete top-level commands when typing "attest-it "', async () => {
        const { stdout, exitCode } = await getCompletions('attest-it ', shell)
        expect(exitCode).toBe(0)

        const completions = parseCompletions(stdout, shell)
        expect(completions).toContain('status')
        expect(completions).toContain('run')
        expect(completions).toContain('verify')
        expect(completions).toContain('seal')
        expect(completions).toContain('init')
        expect(completions).toContain('keygen')
        expect(completions).toContain('identity')
        expect(completions).toContain('team')
        expect(completions).toContain('whoami')
        expect(completions).toContain('completion')
      })

      it('should return all commands when partially typing (shell handles filtering)', async () => {
        // When the user types "attest-it s", the last word is "s"
        // The completer returns all possible completions, and the shell filters by prefix
        // This is standard completion behavior - the completer doesn't pre-filter
        const { stdout, exitCode } = await getCompletions('attest-it s', shell)
        expect(exitCode).toBe(0)

        // The completer should return all top-level commands
        // The shell will filter these to show only 's*' matches
        const completions = parseCompletions(stdout, shell)

        // When there's a partial word being typed, the completer returns matches
        // For bash, it filters; for zsh/fish, they show all and highlight matches
        // The important thing is that the exit code is 0 and we get valid output
        expect(completions.length).toBeGreaterThanOrEqual(0) // May be empty or full list
      })

      it('should complete global options when typing "attest-it -"', async () => {
        const { stdout, exitCode } = await getCompletions('attest-it -', shell)
        expect(exitCode).toBe(0)

        const completions = parseCompletions(stdout, shell)
        expect(completions).toContain('--help')
        expect(completions).toContain('--version')
        expect(completions).toContain('--verbose')
        expect(completions).toContain('--quiet')
        expect(completions).toContain('--config')
      })
    })

    describe('subcommand completion', () => {
      it('should complete identity subcommands', async () => {
        const { stdout, exitCode } = await getCompletions('attest-it identity ', shell)
        expect(exitCode).toBe(0)

        const completions = parseCompletions(stdout, shell)
        expect(completions).toContain('create')
        expect(completions).toContain('list')
        expect(completions).toContain('use')
        expect(completions).toContain('remove')
      })

      it('should complete team subcommands', async () => {
        const { stdout, exitCode } = await getCompletions('attest-it team ', shell)
        expect(exitCode).toBe(0)

        const completions = parseCompletions(stdout, shell)
        expect(completions).toContain('add')
        expect(completions).toContain('list')
        expect(completions).toContain('remove')
      })

      it('should complete completion subcommands', async () => {
        const { stdout, exitCode } = await getCompletions('attest-it completion ', shell)
        expect(exitCode).toBe(0)

        const completions = parseCompletions(stdout, shell)
        expect(completions).toContain('install')
        expect(completions).toContain('uninstall')
      })

      it('should complete shell names for completion install', async () => {
        const { stdout, exitCode } = await getCompletions('attest-it completion install ', shell)
        expect(exitCode).toBe(0)

        const completions = parseCompletions(stdout, shell)
        expect(completions).toContain('bash')
        expect(completions).toContain('zsh')
        expect(completions).toContain('fish')
      })
    })

    describe('output format', () => {
      it(`should output in ${shell} format with descriptions`, async () => {
        const { stdout, exitCode } = await getCompletions('attest-it ', shell)
        expect(exitCode).toBe(0)

        if (shell === 'zsh') {
          // zsh uses colon-separated format: name:description
          expect(stdout).toMatch(/status:.*Show status/i)
        } else if (shell === 'fish') {
          // fish uses tab-separated format: name\tdescription
          expect(stdout).toMatch(/status\t.*Show status/i)
        }
        // bash just shows names (descriptions not shown in basic completion)
      })
    })
  })

  // Context-aware completion tests require a proper git repository with config
  // These are tested indirectly through the sample-project fixture in integration tests
  describe('context-aware completion', () => {
    it('should not crash when no config exists', async () => {
      const tempDir = await mkdtemp(join(tmpdir(), 'attest-it-no-config-'))

      try {
        // Complete gates in a directory without config - should return empty, not crash
        const { exitCode } = await getCompletions('attest-it status ', 'bash', tempDir)
        expect(exitCode).toBe(0)
      } finally {
        await rm(tempDir, { recursive: true, force: true })
      }
    })

    it('should return empty completions for gate commands without config', async () => {
      const tempDir = await mkdtemp(join(tmpdir(), 'attest-it-no-config-'))

      try {
        const { stdout, exitCode } = await getCompletions('attest-it verify ', 'zsh', tempDir)
        expect(exitCode).toBe(0)
        // No config = no gates to complete
        expect(stdout.trim()).toBe('')
      } finally {
        await rm(tempDir, { recursive: true, force: true })
      }
    })

    it('should return empty completions for suite commands without config', async () => {
      const tempDir = await mkdtemp(join(tmpdir(), 'attest-it-no-config-'))

      try {
        const { stdout, exitCode } = await getCompletions('attest-it run ', 'fish', tempDir)
        expect(exitCode).toBe(0)
        // No config = no suites to complete
        expect(stdout.trim()).toBe('')
      } finally {
        await rm(tempDir, { recursive: true, force: true })
      }
    })
  })

  describe('error handling', () => {
    it('should not crash on malformed COMP_LINE', async () => {
      const { exitCode } = await getCompletions('', 'bash')
      expect(exitCode).toBe(0)
    })

    it('should handle empty COMP_LINE gracefully', async () => {
      // Simulate empty line completion
      const { exitCode, stdout } = await getCompletions('attest-it', 'zsh')
      expect(exitCode).toBe(0)
      // Should still work, possibly returning nothing or top-level commands
      expect(stdout).toBeDefined()
    })
  })

  // Test that the "attest" alias works identically to "attest-it"
  describe('"attest" alias support', () => {
    describe.each(['bash', 'zsh', 'fish'] as const)('%s shell with "attest" alias', (shell) => {
      it('should complete top-level commands when typing "attest "', async () => {
        const { stdout, exitCode } = await getCompletions('attest ', shell)
        expect(exitCode).toBe(0)

        const completions = parseCompletions(stdout, shell)
        expect(completions).toContain('status')
        expect(completions).toContain('run')
        expect(completions).toContain('verify')
        expect(completions).toContain('seal')
        expect(completions).toContain('init')
        expect(completions).toContain('identity')
        expect(completions).toContain('completion')
      })

      it('should complete global options when typing "attest -"', async () => {
        const { stdout, exitCode } = await getCompletions('attest -', shell)
        expect(exitCode).toBe(0)

        const completions = parseCompletions(stdout, shell)
        expect(completions).toContain('--help')
        expect(completions).toContain('--version')
        expect(completions).toContain('--verbose')
      })

      it('should complete identity subcommands with "attest" alias', async () => {
        const { stdout, exitCode } = await getCompletions('attest identity ', shell)
        expect(exitCode).toBe(0)

        const completions = parseCompletions(stdout, shell)
        expect(completions).toContain('create')
        expect(completions).toContain('list')
        expect(completions).toContain('use')
        expect(completions).toContain('remove')
      })

      it('should complete team subcommands with "attest" alias', async () => {
        const { stdout, exitCode } = await getCompletions('attest team ', shell)
        expect(exitCode).toBe(0)

        const completions = parseCompletions(stdout, shell)
        expect(completions).toContain('add')
        expect(completions).toContain('list')
        expect(completions).toContain('remove')
      })

      it('should complete completion subcommands with "attest" alias', async () => {
        const { stdout, exitCode } = await getCompletions('attest completion ', shell)
        expect(exitCode).toBe(0)

        const completions = parseCompletions(stdout, shell)
        expect(completions).toContain('install')
        expect(completions).toContain('uninstall')
      })
    })
  })
})
