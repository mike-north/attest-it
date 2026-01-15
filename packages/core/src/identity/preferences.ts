/**
 * User preferences management for attest-it.
 * Stored separately from identity config to allow preferences
 * before any identity exists.
 * @packageDocumentation
 */

import { mkdir as mkdirAsync, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import { z } from 'zod'
import { getAttestItConfigDir } from './config.js'

/**
 * Zod schema for CLI experience preferences.
 * This ensures type safety when loading from disk.
 */
const cliExperienceSchema = z
  .object({
    declinedCompletionInstall: z.boolean().optional(),
  })
  .strict()

/**
 * Zod schema for user preferences.
 * Using strict() ensures no unknown keys are accepted.
 */
const userPreferencesSchema = z
  .object({
    cliExperience: cliExperienceSchema.optional(),
  })
  .strict()

/**
 * CLI experience preferences (UX-related settings).
 * @public
 */
export interface CliExperiencePreferences {
  /** Whether the user has declined shell completion installation */
  declinedCompletionInstall?: boolean
}

/**
 * User preferences stored in ~/.config/attest-it/preferences.yaml
 * @public
 */
export interface UserPreferences {
  /** CLI experience and UX settings */
  cliExperience?: CliExperiencePreferences
}

/**
 * Get the path to the preferences file.
 *
 * @returns Path to the preferences file
 * @public
 */
export function getPreferencesPath(): string {
  return join(getAttestItConfigDir(), 'preferences.yaml')
}

/**
 * Load user preferences from file.
 * Validates the file contents against the schema and returns
 * only valid, known preferences.
 *
 * @returns User preferences, or empty object if file doesn't exist
 * @public
 */
export async function loadPreferences(): Promise<UserPreferences> {
  const prefsPath = getPreferencesPath()

  try {
    const content = await readFile(prefsPath, 'utf8')
    const parsed: unknown = parseYaml(content)

    // Validate and parse with Zod - strips unknown keys via strict()
    // If parsing fails, return empty preferences (graceful degradation)
    const result = userPreferencesSchema.safeParse(parsed)
    if (result.success) {
      // Transform Zod output to match interface (handle undefined optionals)
      const prefs: UserPreferences = {}
      if (result.data.cliExperience) {
        prefs.cliExperience = {
          ...(result.data.cliExperience.declinedCompletionInstall !== undefined && {
            declinedCompletionInstall: result.data.cliExperience.declinedCompletionInstall,
          }),
        }
      }
      return prefs
    }

    // Log warning but don't fail - preferences aren't critical
    // eslint-disable-next-line no-console
    console.warn('Invalid preferences file, using defaults:', result.error.message)
    return {}
  } catch (error) {
    // Return empty preferences if file doesn't exist
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      (error.code === 'ENOENT' || error.code === 'ENOTDIR')
    ) {
      return {}
    }
    throw error
  }
}

/**
 * Save user preferences to file.
 *
 * @param preferences - Preferences to save
 * @public
 */
export async function savePreferences(preferences: UserPreferences): Promise<void> {
  const prefsPath = getPreferencesPath()
  const content = stringifyYaml(preferences)

  // Ensure parent directory exists
  const dir = dirname(prefsPath)
  await mkdirAsync(dir, { recursive: true })

  await writeFile(prefsPath, content, 'utf8')
}

/**
 * Update a single preference value.
 *
 * @param key - Preference key to update
 * @param value - New value
 * @public
 */
export async function setPreference<K extends keyof UserPreferences>(
  key: K,
  value: UserPreferences[K],
): Promise<void> {
  const prefs = await loadPreferences()
  prefs[key] = value
  await savePreferences(prefs)
}

/**
 * Get a single preference value.
 *
 * @param key - Preference key to get
 * @returns Preference value, or undefined if not set
 * @public
 */
export async function getPreference<K extends keyof UserPreferences>(
  key: K,
): Promise<UserPreferences[K] | undefined> {
  const prefs = await loadPreferences()
  return prefs[key]
}
