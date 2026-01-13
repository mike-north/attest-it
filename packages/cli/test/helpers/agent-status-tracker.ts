/**
 * Agent status tracker for manual test runner.
 *
 * Manages atomic status file updates to provide queryable state for AI agents
 * polling the manual test runner's progress.
 */

import { writeFile, rename } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'

/**
 * Status object for manual test runs, designed for AI agent consumption.
 *
 * This structure is written atomically to a JSON file to provide queryable
 * state for agents polling test progress.
 */
export interface ManualTestStatus {
  /** Schema version (always 1 for now) */
  version: 1

  /** Overall test run status */
  status: 'initializing' | 'running' | 'waiting_for_input' | 'completed' | 'failed'

  /** Test run start time (ISO 8601) */
  startTime: string

  /** Test run end time (ISO 8601), only set when status is completed or failed */
  endTime?: string

  /** Scenario being executed */
  scenario: {
    /** Scenario key (e.g., "multi-suite") */
    key: string
    /** Human-readable scenario name (e.g., "Multi-suite Project") */
    name: string
    /** Scenario description */
    description: string
  }

  /** Absolute path to the test project directory */
  projectPath: string

  /** Currently executing command, if any */
  currentCommand?: {
    /** 1-based command index */
    index: number
    /** Command name (e.g., "status", "run-interactive") */
    name: string
    /** Command execution status */
    status: 'pending' | 'running' | 'completed' | 'failed'
    /** Command start time (ISO 8601) */
    startTime?: string
    /** Command exit code (set when completed or failed) */
    exitCode?: number
  }

  /** All commands in this test run */
  commands: Array<{
    /** 1-based command index */
    index: number
    /** Command name (e.g., "status", "run-interactive") */
    name: string
    /** Human-readable command description */
    description: string
    /** Command status */
    status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped'
    /** Command start time (ISO 8601) */
    startTime?: string
    /** Command end time (ISO 8601) */
    endTime?: string
    /** Command exit code */
    exitCode?: number
    /** Command duration in milliseconds */
    duration?: number
  }>

  /** Aggregate statistics */
  stats: {
    /** Total number of commands */
    total: number
    /** Number of completed commands */
    completed: number
    /** Number of failed commands */
    failed: number
    /** Number of skipped commands */
    skipped: number
  }

  /** Error message if overall status is 'failed' */
  error?: string
}

/**
 * Deep merge two objects, with source values overwriting target values.
 *
 * This is used to preserve nested fields when doing partial status updates.
 * For example, updating status.currentCommand without losing status.scenario.
 *
 * @param target - The base object to merge into
 * @param source - Partial updates to apply
 * @returns New object with merged values
 */
function deepMerge<T>(target: T, source: Partial<T>): T {
  const result = { ...target }

  for (const key in source) {
    if (Object.prototype.hasOwnProperty.call(source, key)) {
      const sourceValue = source[key]
      const targetValue = result[key]

      if (
        sourceValue &&
        typeof sourceValue === 'object' &&
        !Array.isArray(sourceValue) &&
        targetValue &&
        typeof targetValue === 'object' &&
        !Array.isArray(targetValue)
      ) {
        result[key] = deepMerge(targetValue, sourceValue)
      } else {
        result[key] = sourceValue as T[Extract<keyof T, string>]
      }
    }
  }

  return result
}

/**
 * Validates that a status object conforms to the ManualTestStatus schema.
 *
 * Checks:
 * - version is 1
 * - status is a valid state
 * - scenario has required fields (key, name)
 * - projectPath is present
 * - commands is an array
 * - stats object exists
 *
 * @param status - Status object to validate
 * @throws {Error} if validation fails with specific error message
 */
function validateStatus(status: ManualTestStatus): void {
  if (status.version !== 1) {
    throw new Error(`Invalid status version: ${status.version}`)
  }

  const validStatuses = ['initializing', 'running', 'waiting_for_input', 'completed', 'failed']
  if (!validStatuses.includes(status.status)) {
    throw new Error(`Invalid status: ${status.status}`)
  }

  if (!status.scenario || !status.scenario.key || !status.scenario.name) {
    throw new Error('Missing required scenario fields')
  }

  if (!status.projectPath) {
    throw new Error('Missing projectPath')
  }

  if (!Array.isArray(status.commands)) {
    throw new Error('commands must be an array')
  }

  if (!status.stats || typeof status.stats !== 'object') {
    throw new Error('Missing or invalid stats')
  }
}

/**
 * Status tracker for agent-friendly manual test runner.
 *
 * Provides atomic status file updates using the temp file + rename pattern
 * to ensure agents always see consistent state when polling.
 */
export class AgentStatusTracker {
  private statusPath: string | null = null
  private currentStatus: ManualTestStatus | null = null

  /**
   * Initialize the status tracker with a file path and initial status.
   */
  async init(statusPath: string, initialStatus: ManualTestStatus): Promise<void> {
    validateStatus(initialStatus)

    this.statusPath = statusPath
    this.currentStatus = initialStatus

    await this.writeStatus(initialStatus)
  }

  /**
   * Update the status file with partial updates.
   * Uses deep merge to preserve nested fields not explicitly overwritten.
   */
  async update(updates: Partial<ManualTestStatus>): Promise<void> {
    if (!this.statusPath || !this.currentStatus) {
      throw new Error('Status tracker not initialized. Call init() first.')
    }

    // Deep merge updates into current status
    const newStatus = deepMerge(this.currentStatus, updates)

    // Validate before writing
    validateStatus(newStatus)

    // Update current status and write
    this.currentStatus = newStatus
    await this.writeStatus(newStatus)
  }

  /**
   * Get the current status (does not read from disk).
   */
  getStatus(): ManualTestStatus {
    if (!this.currentStatus) {
      throw new Error('Status tracker not initialized')
    }
    return this.currentStatus
  }

  /**
   * Atomically write status to file using temp file + rename pattern.
   */
  private async writeStatus(status: ManualTestStatus): Promise<void> {
    if (!this.statusPath) {
      throw new Error('Status path not set')
    }

    // Write to temp file in same directory as target (avoids cross-filesystem rename errors)
    const tempPath = join(
      dirname(this.statusPath),
      `.manual-test-status-${Date.now()}-${Math.random().toString(36).slice(2)}.tmp.json`,
    )

    const content = JSON.stringify(status, null, 2)
    await writeFile(tempPath, content, 'utf-8')

    // Atomic rename to final location
    await rename(tempPath, this.statusPath)
  }
}
