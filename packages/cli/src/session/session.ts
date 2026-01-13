import { readFile, writeFile, unlink, mkdir } from 'node:fs/promises'
import { join, dirname } from 'node:path'

/**
 * Session state for interrupted run recovery.
 */
export interface Session {
  /** ISO timestamp when session started */
  started: string
  /** Suites selected by user for this session */
  selected: string[]
  /** Suites that completed successfully */
  completed: string[]
  /** Suites that failed */
  failed: string[]
  /** Suites not yet run (selected - completed - failed) */
  remaining: string[]
}

/**
 * Get the path to the session file.
 * Returns `.attest-it/session.json` relative to current working directory.
 */
export function getSessionPath(): string {
  return join(process.cwd(), '.attest-it', 'session.json')
}

/**
 * Load an existing session from disk.
 * Returns null if no session exists or session is invalid.
 */
export async function loadSession(): Promise<Session | null> {
  try {
    const content = await readFile(getSessionPath(), 'utf-8')
    const data: unknown = JSON.parse(content)

    // Validate session structure
    if (!isValidSession(data)) {
      return null
    }

    return data
  } catch {
    // File doesn't exist or is unreadable
    return null
  }
}

/**
 * Save session state to disk.
 * Creates .attest-it directory if it doesn't exist.
 */
export async function saveSession(session: Session): Promise<void> {
  const sessionPath = getSessionPath()
  const dir = dirname(sessionPath)

  // Create directory if it doesn't exist
  await mkdir(dir, { recursive: true })

  // Write session file
  await writeFile(sessionPath, JSON.stringify(session, null, 2), 'utf-8')
}

/**
 * Delete the session file.
 * Call this when a session completes successfully.
 */
export async function clearSession(): Promise<void> {
  try {
    await unlink(getSessionPath())
  } catch {
    // File doesn't exist - that's fine
  }
}

/**
 * Create a new session with the given selected suites.
 */
export function createSession(selected: string[]): Session {
  return {
    started: new Date().toISOString(),
    selected: [...selected],
    completed: [],
    failed: [],
    remaining: [...selected],
  }
}

/**
 * Update session after a suite completes.
 */
export function updateSessionAfterSuite(
  session: Session,
  suite: string,
  success: boolean,
): Session {
  const remaining = session.remaining.filter((s) => s !== suite)
  return {
    ...session,
    completed: success ? [...session.completed, suite] : session.completed,
    failed: success ? session.failed : [...session.failed, suite],
    remaining,
  }
}

/**
 * Type guard to validate session structure.
 */
function isValidSession(data: unknown): data is Session {
  if (typeof data !== 'object' || data === null) {
    return false
  }

  // We need to access properties of unknown object, so we check each property
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
  const obj = data as Record<string, unknown>

  return (
    typeof obj.started === 'string' &&
    Array.isArray(obj.selected) &&
    obj.selected.every((item) => typeof item === 'string') &&
    Array.isArray(obj.completed) &&
    obj.completed.every((item) => typeof item === 'string') &&
    Array.isArray(obj.failed) &&
    obj.failed.every((item) => typeof item === 'string') &&
    Array.isArray(obj.remaining) &&
    obj.remaining.every((item) => typeof item === 'string')
  )
}
