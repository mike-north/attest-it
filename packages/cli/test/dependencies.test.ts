import { describe, it, expect } from 'vitest'
import {
  validateDependencies,
  getDependencies,
  resolveDependencyOrder,
  expandWithDependencies,
  CircularDependencyError,
} from '../src/utils/dependencies.js'
import type { Config } from '@attest-it/core'

/**
 * Test helper to create a mock Config with suite dependencies.
 */
function createMockConfig(
  suites: Record<string, { packages: string[]; depends_on?: string[] }>,
): Config {
  return {
    version: 1,
    settings: {
      maxAgeDays: 30,
      publicKeyPath: '.attest-it/pubkey.pem',
      attestationsPath: '.attest-it/attestations.json',
    },
    suites,
  }
}

describe('validateDependencies', () => {
  describe('positive cases', () => {
    it('should validate config with no dependencies', () => {
      const config = createMockConfig({
        'suite-a': { packages: ['a'] },
        'suite-b': { packages: ['b'] },
      })

      expect(() => {
        validateDependencies(config)
      }).not.toThrow()
    })

    it('should validate config with valid dependencies', () => {
      const config = createMockConfig({
        'suite-a': { packages: ['a'] },
        'suite-b': { packages: ['b'], depends_on: ['suite-a'] },
      })

      expect(() => {
        validateDependencies(config)
      }).not.toThrow()
    })

    it('should validate config with multiple valid dependencies', () => {
      const config = createMockConfig({
        'suite-a': { packages: ['a'] },
        'suite-b': { packages: ['b'] },
        'suite-c': { packages: ['c'], depends_on: ['suite-a', 'suite-b'] },
      })

      expect(() => {
        validateDependencies(config)
      }).not.toThrow()
    })
  })

  describe('negative cases', () => {
    it('should throw when suite depends on non-existent suite', () => {
      const config = createMockConfig({
        'suite-a': { packages: ['a'], depends_on: ['non-existent'] },
      })

      expect(() => {
        validateDependencies(config)
      }).toThrow('Suite "suite-a" depends on non-existent suite "non-existent"')
    })

    it('should throw when multiple suites have invalid dependencies', () => {
      const config = createMockConfig({
        'suite-a': { packages: ['a'], depends_on: ['missing-1'] },
        'suite-b': { packages: ['b'], depends_on: ['missing-2'] },
      })

      // Should throw on first invalid dependency encountered
      expect(() => {
        validateDependencies(config)
      }).toThrow(/non-existent suite/)
    })
  })

  describe('edge cases', () => {
    it('should handle empty suites object', () => {
      const config = createMockConfig({})

      expect(() => {
        validateDependencies(config)
      }).not.toThrow()
    })

    it('should handle suite with empty dependencies array', () => {
      const config = createMockConfig({
        'suite-a': { packages: ['a'], depends_on: [] },
      })

      expect(() => {
        validateDependencies(config)
      }).not.toThrow()
    })
  })
})

describe('getDependencies', () => {
  describe('positive cases', () => {
    it('should return empty array for suite with no dependencies', () => {
      const config = createMockConfig({
        'suite-a': { packages: ['a'] },
      })

      const result = getDependencies('suite-a', config)

      expect(result).toEqual([])
    })

    it('should return direct dependency', () => {
      const config = createMockConfig({
        'suite-a': { packages: ['a'] },
        'suite-b': { packages: ['b'], depends_on: ['suite-a'] },
      })

      const result = getDependencies('suite-b', config)

      expect(result).toEqual(['suite-a'])
    })

    it('should return transitive dependencies in correct order', () => {
      const config = createMockConfig({
        'suite-a': { packages: ['a'] },
        'suite-b': { packages: ['b'], depends_on: ['suite-a'] },
        'suite-c': { packages: ['c'], depends_on: ['suite-b'] },
      })

      const result = getDependencies('suite-c', config)

      expect(result).toEqual(['suite-a', 'suite-b'])
    })

    it('should handle diamond dependency correctly', () => {
      const config = createMockConfig({
        'suite-d': { packages: ['d'] },
        'suite-b': { packages: ['b'], depends_on: ['suite-d'] },
        'suite-c': { packages: ['c'], depends_on: ['suite-d'] },
        'suite-a': { packages: ['a'], depends_on: ['suite-b', 'suite-c'] },
      })

      const result = getDependencies('suite-a', config)

      // suite-d should appear first, then b and c (order may vary), then a is excluded
      expect(result).toContain('suite-d')
      expect(result).toContain('suite-b')
      expect(result).toContain('suite-c')
      expect(result).toHaveLength(3)
      // suite-d must come before both b and c
      expect(result.indexOf('suite-d')).toBeLessThan(result.indexOf('suite-b'))
      expect(result.indexOf('suite-d')).toBeLessThan(result.indexOf('suite-c'))
    })

    it('should handle multiple direct dependencies', () => {
      const config = createMockConfig({
        'suite-a': { packages: ['a'] },
        'suite-b': { packages: ['b'] },
        'suite-c': { packages: ['c'], depends_on: ['suite-a', 'suite-b'] },
      })

      const result = getDependencies('suite-c', config)

      expect(result).toContain('suite-a')
      expect(result).toContain('suite-b')
      expect(result).toHaveLength(2)
    })
  })

  describe('negative cases', () => {
    it('should throw CircularDependencyError for self-dependency', () => {
      const config = createMockConfig({
        'suite-a': { packages: ['a'], depends_on: ['suite-a'] },
      })

      expect(() => getDependencies('suite-a', config)).toThrow(CircularDependencyError)
    })

    it('should throw CircularDependencyError for two-suite cycle', () => {
      const config = createMockConfig({
        'suite-a': { packages: ['a'], depends_on: ['suite-b'] },
        'suite-b': { packages: ['b'], depends_on: ['suite-a'] },
      })

      expect(() => getDependencies('suite-a', config)).toThrow(CircularDependencyError)
    })

    it('should throw CircularDependencyError for three-suite cycle', () => {
      const config = createMockConfig({
        'suite-a': { packages: ['a'], depends_on: ['suite-b'] },
        'suite-b': { packages: ['b'], depends_on: ['suite-c'] },
        'suite-c': { packages: ['c'], depends_on: ['suite-a'] },
      })

      expect(() => getDependencies('suite-a', config)).toThrow(CircularDependencyError)
    })

    it('should include cycle path in CircularDependencyError', () => {
      const config = createMockConfig({
        'suite-a': { packages: ['a'], depends_on: ['suite-b'] },
        'suite-b': { packages: ['b'], depends_on: ['suite-a'] },
      })

      try {
        getDependencies('suite-a', config)
        expect.fail('Should have thrown CircularDependencyError')
      } catch (error) {
        expect(error).toBeInstanceOf(CircularDependencyError)
        if (error instanceof CircularDependencyError) {
          expect(error.cycle).toContain('suite-a')
          expect(error.cycle).toContain('suite-b')
        }
      }
    })

    it('should throw for non-existent suite', () => {
      const config = createMockConfig({
        'suite-a': { packages: ['a'] },
      })

      expect(() => getDependencies('non-existent', config)).toThrow(
        'Suite "non-existent" not found in configuration',
      )
    })
  })

  describe('edge cases', () => {
    it('should not include the suite itself in results', () => {
      const config = createMockConfig({
        'suite-a': { packages: ['a'] },
        'suite-b': { packages: ['b'], depends_on: ['suite-a'] },
      })

      const result = getDependencies('suite-b', config)

      expect(result).not.toContain('suite-b')
    })

    it('should deduplicate dependencies in diamond pattern', () => {
      const config = createMockConfig({
        'suite-d': { packages: ['d'] },
        'suite-b': { packages: ['b'], depends_on: ['suite-d'] },
        'suite-c': { packages: ['c'], depends_on: ['suite-d'] },
        'suite-a': { packages: ['a'], depends_on: ['suite-b', 'suite-c'] },
      })

      const result = getDependencies('suite-a', config)

      // suite-d should appear only once
      expect(result.filter((s) => s === 'suite-d')).toHaveLength(1)
    })
  })
})

describe('resolveDependencyOrder', () => {
  describe('positive cases', () => {
    it('should preserve order when no dependencies exist', () => {
      const config = createMockConfig({
        'suite-a': { packages: ['a'] },
        'suite-b': { packages: ['b'] },
        'suite-c': { packages: ['c'] },
      })

      const result = resolveDependencyOrder(['suite-a', 'suite-b', 'suite-c'], config)

      // Order should be preserved when no dependencies
      expect(result).toEqual(['suite-a', 'suite-b', 'suite-c'])
    })

    it('should sort simple chain correctly', () => {
      const config = createMockConfig({
        'suite-a': { packages: ['a'] },
        'suite-b': { packages: ['b'], depends_on: ['suite-a'] },
        'suite-c': { packages: ['c'], depends_on: ['suite-b'] },
      })

      const result = resolveDependencyOrder(['suite-c', 'suite-a', 'suite-b'], config)

      expect(result).toEqual(['suite-a', 'suite-b', 'suite-c'])
    })

    it('should handle diamond dependency correctly', () => {
      const config = createMockConfig({
        'suite-d': { packages: ['d'] },
        'suite-b': { packages: ['b'], depends_on: ['suite-d'] },
        'suite-c': { packages: ['c'], depends_on: ['suite-d'] },
        'suite-a': { packages: ['a'], depends_on: ['suite-b', 'suite-c'] },
      })

      const result = resolveDependencyOrder(['suite-a', 'suite-b', 'suite-c', 'suite-d'], config)

      // suite-d must come first
      expect(result[0]).toBe('suite-d')
      // suite-a must come last
      expect(result[3]).toBe('suite-a')
      // b and c must come before a but after d
      expect(result.slice(1, 3)).toContain('suite-b')
      expect(result.slice(1, 3)).toContain('suite-c')
    })

    it('should handle independent suites maintaining relative order', () => {
      const config = createMockConfig({
        'suite-a': { packages: ['a'] },
        'suite-b': { packages: ['b'], depends_on: ['suite-a'] },
        'suite-d': { packages: ['d'] }, // independent
      })

      const result = resolveDependencyOrder(['suite-d', 'suite-b', 'suite-a'], config)

      // suite-a must come before suite-b
      expect(result.indexOf('suite-a')).toBeLessThan(result.indexOf('suite-b'))
      // suite-d can be anywhere since it's independent
      expect(result).toContain('suite-d')
    })

    it('should handle partial selection of dependency chain', () => {
      const config = createMockConfig({
        'suite-a': { packages: ['a'] },
        'suite-b': { packages: ['b'], depends_on: ['suite-a'] },
        'suite-c': { packages: ['c'], depends_on: ['suite-b'] },
      })

      // Only selecting b and c, not a
      const result = resolveDependencyOrder(['suite-b', 'suite-c'], config)

      // b should come before c
      expect(result).toEqual(['suite-b', 'suite-c'])
    })
  })

  describe('negative cases', () => {
    it('should throw CircularDependencyError for self-dependency', () => {
      const config = createMockConfig({
        'suite-a': { packages: ['a'], depends_on: ['suite-a'] },
      })

      expect(() => resolveDependencyOrder(['suite-a'], config)).toThrow(CircularDependencyError)
    })

    it('should throw CircularDependencyError for cycle', () => {
      const config = createMockConfig({
        'suite-a': { packages: ['a'], depends_on: ['suite-b'] },
        'suite-b': { packages: ['b'], depends_on: ['suite-a'] },
      })

      expect(() => resolveDependencyOrder(['suite-a', 'suite-b'], config)).toThrow(
        CircularDependencyError,
      )
    })

    it('should throw for non-existent suite', () => {
      const config = createMockConfig({
        'suite-a': { packages: ['a'] },
      })

      expect(() => resolveDependencyOrder(['suite-a', 'non-existent'], config)).toThrow(
        'Suite "non-existent" not found in configuration',
      )
    })
  })

  describe('edge cases', () => {
    it('should handle empty suite list', () => {
      const config = createMockConfig({
        'suite-a': { packages: ['a'] },
      })

      const result = resolveDependencyOrder([], config)

      expect(result).toEqual([])
    })

    it('should handle single suite', () => {
      const config = createMockConfig({
        'suite-a': { packages: ['a'] },
      })

      const result = resolveDependencyOrder(['suite-a'], config)

      expect(result).toEqual(['suite-a'])
    })

    it('should ignore dependencies not in the suite list', () => {
      const config = createMockConfig({
        'suite-a': { packages: ['a'] },
        'suite-b': { packages: ['b'], depends_on: ['suite-a'] },
        'suite-c': { packages: ['c'], depends_on: ['suite-b'] },
      })

      // Only run suite-c, ignoring its dependencies
      const result = resolveDependencyOrder(['suite-c'], config)

      expect(result).toEqual(['suite-c'])
    })

    it('should handle complex graph with multiple independent chains', () => {
      const config = createMockConfig({
        'suite-a': { packages: ['a'] },
        'suite-b': { packages: ['b'], depends_on: ['suite-a'] },
        'suite-x': { packages: ['x'] },
        'suite-y': { packages: ['y'], depends_on: ['suite-x'] },
      })

      const result = resolveDependencyOrder(['suite-b', 'suite-y', 'suite-a', 'suite-x'], config)

      // Within each chain, order must be preserved
      expect(result.indexOf('suite-a')).toBeLessThan(result.indexOf('suite-b'))
      expect(result.indexOf('suite-x')).toBeLessThan(result.indexOf('suite-y'))
    })
  })
})

describe('expandWithDependencies', () => {
  describe('positive cases', () => {
    it('should return suite unchanged when it has no dependencies', () => {
      const config = createMockConfig({
        'suite-a': { packages: ['a'] },
      })

      const result = expandWithDependencies(['suite-a'], config)

      expect(result).toEqual(['suite-a'])
    })

    it('should include direct dependency', () => {
      const config = createMockConfig({
        'suite-a': { packages: ['a'] },
        'suite-b': { packages: ['b'], depends_on: ['suite-a'] },
      })

      const result = expandWithDependencies(['suite-b'], config)

      expect(result).toEqual(['suite-a', 'suite-b'])
    })

    it('should include transitive dependencies', () => {
      const config = createMockConfig({
        'suite-a': { packages: ['a'] },
        'suite-b': { packages: ['b'], depends_on: ['suite-a'] },
        'suite-c': { packages: ['c'], depends_on: ['suite-b'] },
      })

      const result = expandWithDependencies(['suite-c'], config)

      expect(result).toEqual(['suite-a', 'suite-b', 'suite-c'])
    })

    it('should deduplicate when multiple suites share dependencies', () => {
      const config = createMockConfig({
        'suite-a': { packages: ['a'] },
        'suite-b': { packages: ['b'], depends_on: ['suite-a'] },
        'suite-c': { packages: ['c'], depends_on: ['suite-a'] },
      })

      const result = expandWithDependencies(['suite-b', 'suite-c'], config)

      // suite-a should appear only once
      expect(result.filter((s) => s === 'suite-a')).toHaveLength(1)
      expect(result).toContain('suite-b')
      expect(result).toContain('suite-c')
    })

    it('should handle diamond dependency', () => {
      const config = createMockConfig({
        'suite-d': { packages: ['d'] },
        'suite-b': { packages: ['b'], depends_on: ['suite-d'] },
        'suite-c': { packages: ['c'], depends_on: ['suite-d'] },
        'suite-a': { packages: ['a'], depends_on: ['suite-b', 'suite-c'] },
      })

      const result = expandWithDependencies(['suite-a'], config)

      expect(result).toContain('suite-d')
      expect(result).toContain('suite-b')
      expect(result).toContain('suite-c')
      expect(result).toContain('suite-a')
      expect(result).toHaveLength(4)
      // suite-d should come first
      expect(result[0]).toBe('suite-d')
    })

    it('should preserve suites that are already included', () => {
      const config = createMockConfig({
        'suite-a': { packages: ['a'] },
        'suite-b': { packages: ['b'], depends_on: ['suite-a'] },
      })

      const result = expandWithDependencies(['suite-a', 'suite-b'], config)

      expect(result).toEqual(['suite-a', 'suite-b'])
    })
  })

  describe('negative cases', () => {
    it('should throw CircularDependencyError for cycle', () => {
      const config = createMockConfig({
        'suite-a': { packages: ['a'], depends_on: ['suite-b'] },
        'suite-b': { packages: ['b'], depends_on: ['suite-a'] },
      })

      expect(() => expandWithDependencies(['suite-a'], config)).toThrow(CircularDependencyError)
    })

    it('should throw for non-existent suite', () => {
      const config = createMockConfig({
        'suite-a': { packages: ['a'] },
      })

      expect(() => expandWithDependencies(['non-existent'], config)).toThrow(
        'Suite "non-existent" not found in configuration',
      )
    })
  })

  describe('edge cases', () => {
    it('should handle empty suite list', () => {
      const config = createMockConfig({
        'suite-a': { packages: ['a'] },
      })

      const result = expandWithDependencies([], config)

      expect(result).toEqual([])
    })

    it('should handle multiple independent suites', () => {
      const config = createMockConfig({
        'suite-a': { packages: ['a'] },
        'suite-b': { packages: ['b'] },
        'suite-c': { packages: ['c'] },
      })

      const result = expandWithDependencies(['suite-a', 'suite-c'], config)

      expect(result).toContain('suite-a')
      expect(result).toContain('suite-c')
      expect(result).not.toContain('suite-b')
    })

    it('should expand partial selection to include missing dependencies', () => {
      const config = createMockConfig({
        'suite-a': { packages: ['a'] },
        'suite-b': { packages: ['b'], depends_on: ['suite-a'] },
        'suite-c': { packages: ['c'], depends_on: ['suite-b'] },
      })

      // Select only C, should expand to include A and B
      const result = expandWithDependencies(['suite-c'], config)

      expect(result).toEqual(['suite-a', 'suite-b', 'suite-c'])
    })
  })
})
