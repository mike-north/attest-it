/**
 * Shared helpers for pty-driven CLI tests (issue #100).
 *
 * These tests attach the real built CLI (`dist/bin/attest-it.js`) to a real
 * pseudo-terminal via `node-pty` so `process.stdin.isTTY` is genuinely
 * `true` inside the CLI process -- exercising the actual keystroke/signal
 * input contract a human types at, not a hand-built approximation (a piped
 * stdin never reaches the interactive-prompt or raw-SIGINT code paths this
 * issue is about).
 *
 * @packageDocumentation
 */
import { chmodSync, existsSync } from 'node:fs'
import { platform, arch } from 'node:os'
import { dirname, join } from 'node:path'
import { createRequire } from 'node:module'
import * as pty from 'node-pty'

/**
 * `node-pty` ships prebuilt native helper binaries (`spawn-helper` on
 * POSIX). pnpm's content-addressable store does not restore the original
 * executable bit for files outside a package's declared `bin` field, so a
 * plain `pnpm install` can leave `spawn-helper` non-executable, and
 * `pty.spawn` then fails with `posix_spawnp failed`. Re-assert the bit
 * before every spawn so these tests are deterministic regardless of how the
 * package manager happened to extract the file.
 */
function ensureNodePtyHelperExecutable(): void {
  if (platform() === 'win32') {
    return
  }
  const require = createRequire(import.meta.url)
  const pkgPath = require.resolve('node-pty/package.json')
  const helperPath = join(dirname(pkgPath), 'prebuilds', `${platform()}-${arch()}`, 'spawn-helper')
  if (existsSync(helperPath)) {
    chmodSync(helperPath, 0o755)
  }
}

export interface SpawnPtyOptions {
  cwd: string
  env?: NodeJS.ProcessEnv
  cols?: number
  rows?: number
}

/** Spawn `file args...` attached to a real pseudo-terminal. */
export function spawnPty(file: string, args: string[], options: SpawnPtyOptions): pty.IPty {
  ensureNodePtyHelperExecutable()
  return pty.spawn(file, args, {
    name: 'xterm-256color',
    cols: options.cols ?? 100,
    rows: options.rows ?? 30,
    cwd: options.cwd,
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- node-pty's env type requires string values only; process.env entries are string | undefined
    env: { ...process.env, ...options.env } as Record<string, string>,
  })
}

/**
 * Wait until the pty's accumulated output satisfies `predicate`, or reject
 * after `timeoutMs`.
 */
export async function waitForOutput(
  term: pty.IPty,
  predicate: (accumulated: string) => boolean,
  timeoutMs = 20000,
): Promise<string> {
  return new Promise((resolve, reject) => {
    let acc = ''
    const disposable = term.onData((chunk: string) => {
      acc += chunk
      if (predicate(acc)) {
        cleanup()
        resolve(acc)
      }
    })
    const timer = setTimeout(() => {
      cleanup()
      reject(
        new Error(
          `Timed out after ${String(timeoutMs)}ms waiting for expected pty output. ` +
            `Output received so far:\n${acc}`,
        ),
      )
    }, timeoutMs)
    function cleanup(): void {
      clearTimeout(timer)
      disposable.dispose()
    }
  })
}

/** Wait for the pty-attached process to exit, returning its exit code. */
export async function waitForPtyExit(term: pty.IPty, timeoutMs = 20000): Promise<number> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timed out after ${String(timeoutMs)}ms waiting for pty process to exit`))
    }, timeoutMs)
    term.onExit(({ exitCode }: { exitCode: number }) => {
      clearTimeout(timer)
      resolve(exitCode)
    })
  })
}
