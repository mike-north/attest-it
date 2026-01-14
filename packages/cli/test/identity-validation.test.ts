import { describe, it, expect } from 'vitest'
import { validateSlug } from '../src/commands/identity/validation.js'

describe('validateSlug', () => {
  describe('valid slugs', () => {
    it('should accept lowercase letters', () => {
      expect(validateSlug('mike')).toBe(true)
    })

    it('should accept lowercase letters with hyphens', () => {
      expect(validateSlug('mike-north')).toBe(true)
    })

    it('should accept numbers', () => {
      expect(validateSlug('user123')).toBe(true)
    })

    it('should accept mixed lowercase, numbers, and hyphens', () => {
      expect(validateSlug('my-identity-2024')).toBe(true)
    })

    it('should accept single character', () => {
      expect(validateSlug('a')).toBe(true)
    })

    it('should accept slug starting with number', () => {
      expect(validateSlug('123-test')).toBe(true)
    })

    it('should accept slug with multiple hyphens', () => {
      expect(validateSlug('my--double-hyphen')).toBe(true)
    })

    it('should trim whitespace and accept valid slug', () => {
      expect(validateSlug('  mike-north  ')).toBe(true)
    })

    it('should trim leading whitespace', () => {
      expect(validateSlug('  valid-slug')).toBe(true)
    })

    it('should trim trailing whitespace', () => {
      expect(validateSlug('valid-slug  ')).toBe(true)
    })
  })

  describe('invalid slugs', () => {
    it('should reject empty string', () => {
      expect(validateSlug('')).toBe('Slug cannot be empty')
    })

    it('should reject whitespace only', () => {
      expect(validateSlug('   ')).toBe('Slug cannot be empty')
    })

    it('should reject uppercase letters', () => {
      expect(validateSlug('Mike')).toBe(
        'Slug must contain only lowercase letters, numbers, and hyphens',
      )
    })

    it('should reject mixed case', () => {
      expect(validateSlug('mikeNorth')).toBe(
        'Slug must contain only lowercase letters, numbers, and hyphens',
      )
    })

    it('should reject spaces in the middle', () => {
      expect(validateSlug('mike north')).toBe(
        'Slug must contain only lowercase letters, numbers, and hyphens',
      )
    })

    it('should reject underscores', () => {
      expect(validateSlug('mike_north')).toBe(
        'Slug must contain only lowercase letters, numbers, and hyphens',
      )
    })

    it('should reject special characters', () => {
      expect(validateSlug('mike@north')).toBe(
        'Slug must contain only lowercase letters, numbers, and hyphens',
      )
    })

    it('should reject dots', () => {
      expect(validateSlug('mike.north')).toBe(
        'Slug must contain only lowercase letters, numbers, and hyphens',
      )
    })
  })

  describe('duplicate detection', () => {
    const existingIdentities = {
      'existing-slug': { name: 'Existing' },
      'another-one': { name: 'Another' },
    }

    it('should reject existing slug', () => {
      expect(validateSlug('existing-slug', existingIdentities)).toBe(
        'Identity "existing-slug" already exists',
      )
    })

    it('should reject another existing slug', () => {
      expect(validateSlug('another-one', existingIdentities)).toBe(
        'Identity "another-one" already exists',
      )
    })

    it('should accept new slug when others exist', () => {
      expect(validateSlug('new-slug', existingIdentities)).toBe(true)
    })

    it('should handle trimmed value for duplicate check', () => {
      expect(validateSlug('  existing-slug  ', existingIdentities)).toBe(
        'Identity "existing-slug" already exists',
      )
    })

    it('should accept any slug when no existing identities', () => {
      expect(validateSlug('any-slug', undefined)).toBe(true)
    })

    it('should accept any slug when existing identities is empty', () => {
      expect(validateSlug('any-slug', {})).toBe(true)
    })
  })
})
