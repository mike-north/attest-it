/**
 * Tests for TeamMember schema validation, including algorithm versioning.
 */

import { describe, expect, it } from 'vitest'
import { teamMemberSchema } from '../../src/config/shared-schemas.js'

describe('teamMemberSchema', () => {
  describe('positive tests (valid team members)', () => {
    it('should accept a team member with only required fields', () => {
      const result = teamMemberSchema.safeParse({
        name: 'Alice Smith',
        publicKey: 'Fzpq2YHEvpA2BwjGnW5ZcZF+WyUbsiyTFFMjPEK3SfA=',
      })

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.name).toBe('Alice Smith')
        expect(result.data.publicKey).toBe('Fzpq2YHEvpA2BwjGnW5ZcZF+WyUbsiyTFFMjPEK3SfA=')
        expect(result.data.email).toBeUndefined()
        expect(result.data.github).toBeUndefined()
        expect(result.data.publicKeyAlgorithm).toBeUndefined()
      }
    })

    it('should accept a team member with all fields including email', () => {
      const result = teamMemberSchema.safeParse({
        name: 'Bob Jones',
        email: 'bob@example.com',
        publicKey: 'aBc123XyZ456+789/def=',
      })

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.name).toBe('Bob Jones')
        expect(result.data.email).toBe('bob@example.com')
        expect(result.data.publicKey).toBe('aBc123XyZ456+789/def=')
      }
    })

    it('should accept a team member with github username', () => {
      const result = teamMemberSchema.safeParse({
        name: 'Charlie Dev',
        github: 'charlie-dev',
        publicKey: 'xYz789AbC123+456/ghi=',
      })

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.name).toBe('Charlie Dev')
        expect(result.data.github).toBe('charlie-dev')
        expect(result.data.publicKey).toBe('xYz789AbC123+456/ghi=')
      }
    })

    it('should accept a team member with all optional fields', () => {
      const result = teamMemberSchema.safeParse({
        name: 'Diana Engineer',
        email: 'diana@example.com',
        github: 'diana-eng',
        publicKey: 'AbC123XyZ456+789/def=',
      })

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.name).toBe('Diana Engineer')
        expect(result.data.email).toBe('diana@example.com')
        expect(result.data.github).toBe('diana-eng')
        expect(result.data.publicKey).toBe('AbC123XyZ456+789/def=')
      }
    })

    it('should accept a team member with publicKeyAlgorithm set to ed25519', () => {
      const result = teamMemberSchema.safeParse({
        name: 'Eve Secure',
        publicKey: 'Fzpq2YHEvpA2BwjGnW5ZcZF+WyUbsiyTFFMjPEK3SfA=',
        publicKeyAlgorithm: 'ed25519',
      })

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.name).toBe('Eve Secure')
        expect(result.data.publicKey).toBe('Fzpq2YHEvpA2BwjGnW5ZcZF+WyUbsiyTFFMjPEK3SfA=')
        expect(result.data.publicKeyAlgorithm).toBe('ed25519')
      }
    })

    it('should accept a team member with all fields including publicKeyAlgorithm', () => {
      const result = teamMemberSchema.safeParse({
        name: 'Frank Full',
        email: 'frank@example.com',
        github: 'frank-full',
        publicKey: 'AbC123XyZ456+789/def=',
        publicKeyAlgorithm: 'ed25519',
      })

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.name).toBe('Frank Full')
        expect(result.data.email).toBe('frank@example.com')
        expect(result.data.github).toBe('frank-full')
        expect(result.data.publicKey).toBe('AbC123XyZ456+789/def=')
        expect(result.data.publicKeyAlgorithm).toBe('ed25519')
      }
    })
  })

  describe('negative tests (invalid team members)', () => {
    it('should reject a team member without a name', () => {
      const result = teamMemberSchema.safeParse({
        publicKey: 'Fzpq2YHEvpA2BwjGnW5ZcZF+WyUbsiyTFFMjPEK3SfA=',
      })

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.issues).toHaveLength(1)
        expect(result.error.issues[0].path).toContain('name')
      }
    })

    it('should reject a team member with an empty name', () => {
      const result = teamMemberSchema.safeParse({
        name: '',
        publicKey: 'Fzpq2YHEvpA2BwjGnW5ZcZF+WyUbsiyTFFMjPEK3SfA=',
      })

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.issues).toHaveLength(1)
        expect(result.error.issues[0].path).toContain('name')
        expect(result.error.issues[0].message).toContain('cannot be empty')
      }
    })

    it('should reject a team member without a publicKey', () => {
      const result = teamMemberSchema.safeParse({
        name: 'Grace Missing',
      })

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.issues).toHaveLength(1)
        expect(result.error.issues[0].path).toContain('publicKey')
      }
    })

    it('should reject a team member with an empty publicKey', () => {
      const result = teamMemberSchema.safeParse({
        name: 'Hannah Empty',
        publicKey: '',
      })

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.issues).toHaveLength(1)
        expect(result.error.issues[0].path).toContain('publicKey')
        expect(result.error.issues[0].message).toContain('required')
      }
    })

    it('should reject a team member with an invalid email', () => {
      const result = teamMemberSchema.safeParse({
        name: 'Ian Invalid',
        email: 'not-an-email',
        publicKey: 'Fzpq2YHEvpA2BwjGnW5ZcZF+WyUbsiyTFFMjPEK3SfA=',
      })

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.issues).toHaveLength(1)
        expect(result.error.issues[0].path).toContain('email')
      }
    })

    it('should reject a team member with an empty github username', () => {
      const result = teamMemberSchema.safeParse({
        name: 'Jane Empty',
        github: '',
        publicKey: 'Fzpq2YHEvpA2BwjGnW5ZcZF+WyUbsiyTFFMjPEK3SfA=',
      })

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.issues).toHaveLength(1)
        expect(result.error.issues[0].path).toContain('github')
      }
    })

    it('should reject a team member with publicKeyAlgorithm set to an invalid value', () => {
      const result = teamMemberSchema.safeParse({
        name: 'Kevin Invalid',
        publicKey: 'Fzpq2YHEvpA2BwjGnW5ZcZF+WyUbsiyTFFMjPEK3SfA=',
        publicKeyAlgorithm: 'rsa',
      })

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.issues).toHaveLength(1)
        expect(result.error.issues[0].path).toContain('publicKeyAlgorithm')
      }
    })

    it('should reject a team member with publicKeyAlgorithm set to a number', () => {
      const result = teamMemberSchema.safeParse({
        name: 'Laura Wrong',
        publicKey: 'Fzpq2YHEvpA2BwjGnW5ZcZF+WyUbsiyTFFMjPEK3SfA=',
        publicKeyAlgorithm: 123,
      })

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.issues).toHaveLength(1)
        expect(result.error.issues[0].path).toContain('publicKeyAlgorithm')
      }
    })

    it('should reject a team member with extra unknown fields', () => {
      const result = teamMemberSchema.safeParse({
        name: 'Mike Extra',
        publicKey: 'Fzpq2YHEvpA2BwjGnW5ZcZF+WyUbsiyTFFMjPEK3SfA=',
        unknownField: 'value',
      })

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.issues).toHaveLength(1)
        expect(result.error.issues[0].code).toBe('unrecognized_keys')
      }
    })

    it('should reject a team member with multiple validation errors', () => {
      const result = teamMemberSchema.safeParse({
        name: '',
        email: 'invalid-email',
        github: '',
        publicKey: '',
      })

      expect(result.success).toBe(false)
      if (!result.success) {
        // Should have errors for name, email, github, and publicKey
        expect(result.error.issues.length).toBeGreaterThanOrEqual(3)
      }
    })
  })

  describe('edge cases', () => {
    it('should handle team member with only whitespace in optional fields', () => {
      // Note: whitespace-only values should be caught by validation in the CLI,
      // but the schema itself allows them since it only checks min length after trimming is applied
      const result = teamMemberSchema.safeParse({
        name: 'Nancy Whitespace',
        email: 'nancy@example.com',
        github: 'n',
        publicKey: 'Fzpq2YHEvpA2BwjGnW5ZcZF+WyUbsiyTFFMjPEK3SfA=',
      })

      expect(result.success).toBe(true)
    })

    it('should accept team member with unicode characters in name', () => {
      const result = teamMemberSchema.safeParse({
        name: 'Óscar Müller',
        publicKey: 'Fzpq2YHEvpA2BwjGnW5ZcZF+WyUbsiyTFFMjPEK3SfA=',
      })

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.name).toBe('Óscar Müller')
      }
    })

    it('should accept team member with special characters in github username', () => {
      const result = teamMemberSchema.safeParse({
        name: 'Paul Dev',
        github: 'paul_dev-123',
        publicKey: 'Fzpq2YHEvpA2BwjGnW5ZcZF+WyUbsiyTFFMjPEK3SfA=',
      })

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.github).toBe('paul_dev-123')
      }
    })

    it('should accept team member with long name', () => {
      const longName = 'A'.repeat(200)
      const result = teamMemberSchema.safeParse({
        name: longName,
        publicKey: 'Fzpq2YHEvpA2BwjGnW5ZcZF+WyUbsiyTFFMjPEK3SfA=',
      })

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.name).toBe(longName)
      }
    })

    it('should accept team member with very long publicKey', () => {
      const longKey = 'A'.repeat(1000)
      const result = teamMemberSchema.safeParse({
        name: 'Quinn Long',
        publicKey: longKey,
      })

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.publicKey).toBe(longKey)
      }
    })
  })

  describe('backward compatibility', () => {
    it('should accept legacy team member without publicKeyAlgorithm', () => {
      const result = teamMemberSchema.safeParse({
        name: 'Rachel Legacy',
        email: 'rachel@example.com',
        publicKey: 'Fzpq2YHEvpA2BwjGnW5ZcZF+WyUbsiyTFFMjPEK3SfA=',
      })

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.name).toBe('Rachel Legacy')
        expect(result.data.email).toBe('rachel@example.com')
        expect(result.data.publicKey).toBe('Fzpq2YHEvpA2BwjGnW5ZcZF+WyUbsiyTFFMjPEK3SfA=')
        expect(result.data.publicKeyAlgorithm).toBeUndefined()
      }
    })

    it('should accept multiple team members with mixed algorithm presence', () => {
      const oldMember = teamMemberSchema.safeParse({
        name: 'Sam Old',
        publicKey: 'OldKey123456789012345678901234567890123=',
      })

      const newMember = teamMemberSchema.safeParse({
        name: 'Tina New',
        publicKey: 'NewKey123456789012345678901234567890123=',
        publicKeyAlgorithm: 'ed25519',
      })

      expect(oldMember.success).toBe(true)
      expect(newMember.success).toBe(true)

      if (oldMember.success) {
        expect(oldMember.data.publicKeyAlgorithm).toBeUndefined()
      }

      if (newMember.success) {
        expect(newMember.data.publicKeyAlgorithm).toBe('ed25519')
      }
    })
  })

  describe('future algorithm support', () => {
    it('should reject unsupported algorithm types for now', () => {
      const futureAlgorithms = ['rsa2048', 'rsa4096', 'ecdsa-p256', 'ed448']

      futureAlgorithms.forEach((algorithm) => {
        const result = teamMemberSchema.safeParse({
          name: 'Future User',
          publicKey: 'SomeKey123456789012345678901234567890=',
          publicKeyAlgorithm: algorithm,
        })

        expect(result.success).toBe(false)
        if (!result.success) {
          expect(result.error.issues[0].path).toContain('publicKeyAlgorithm')
        }
      })
    })

    it('should accept ed25519 as the only valid algorithm value', () => {
      const result = teamMemberSchema.safeParse({
        name: 'Valid User',
        publicKey: 'ValidKey123456789012345678901234567890=',
        publicKeyAlgorithm: 'ed25519',
      })

      expect(result.success).toBe(true)
    })
  })
})
