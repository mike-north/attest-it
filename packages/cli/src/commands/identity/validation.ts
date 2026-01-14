/**
 * Validation utilities for identity commands.
 */

/**
 * Validate an identity slug.
 *
 * @param value - The slug value to validate
 * @param existingIdentities - Optional record of existing identity slugs
 * @returns true if valid, or an error message string if invalid
 */
export function validateSlug(
  value: string,
  existingIdentities?: Record<string, unknown>,
): true | string {
  const trimmed = value.trim()

  if (!trimmed) {
    return 'Slug cannot be empty'
  }

  if (!/^[a-z0-9-]+$/.test(trimmed)) {
    return 'Slug must contain only lowercase letters, numbers, and hyphens'
  }

  if (existingIdentities?.[trimmed]) {
    return `Identity "${trimmed}" already exists`
  }

  return true
}

/**
 * Email validation regex pattern.
 * Validates basic email format: local@domain.tld
 */
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * Validate an email address.
 *
 * @param value - The email value to validate
 * @param required - Whether the email is required (default: false)
 * @returns true if valid, or an error message string if invalid
 */
export function validateEmail(value: string, required = false): true | string {
  const trimmed = value.trim()

  // If not required and empty, that's fine
  if (!trimmed) {
    return required ? 'Email cannot be empty' : true
  }

  if (!EMAIL_REGEX.test(trimmed)) {
    return 'Please enter a valid email address'
  }

  return true
}
