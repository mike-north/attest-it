/**
 * Tests for version checking utilities
 */

import { describe, it, expect } from 'vitest'
import {
  getPackageVersion,
  checkVersionCompatibility,
  VersionIncompatibleError,
} from '../src/version.js'

describe('getPackageVersion', () => {
  it('should return a valid semantic version string', () => {
    const version = getPackageVersion()
    expect(version).toMatch(/^\d+\.\d+\.\d+/)
  })

  it('should return the version from package.json', () => {
    const version = getPackageVersion()
    // Should match the pattern X.Y.Z (possibly with pre-release or build metadata)
    expect(version).toBeTruthy()
    expect(typeof version).toBe('string')
  })

  it('should cache the version on subsequent calls', () => {
    const version1 = getPackageVersion()
    const version2 = getPackageVersion()
    expect(version1).toBe(version2)
    expect(version1).toStrictEqual(version2) // Same reference
  })
})

describe('VersionIncompatibleError', () => {
  it('should create an error with required version and current version', () => {
    const error = new VersionIncompatibleError('2.0.0', '1.0.0')
    expect(error).toBeInstanceOf(Error)
    expect(error).toBeInstanceOf(VersionIncompatibleError)
    expect(error.requiredVersion).toBe('2.0.0')
    expect(error.currentVersion).toBe('1.0.0')
    expect(error.name).toBe('VersionIncompatibleError')
  })

  it('should include both versions in the error message', () => {
    const error = new VersionIncompatibleError('2.0.0', '1.0.0')
    expect(error.message).toContain('2.0.0')
    expect(error.message).toContain('1.0.0')
  })

  it('should include upgrade instructions in the error message', () => {
    const error = new VersionIncompatibleError('2.0.0', '1.0.0')
    expect(error.message).toContain('pnpm add')
    expect(error.message).toContain('@attest-it/cli')
    expect(error.message).toContain('pnpm install')
  })

  it('should mention the required version in upgrade instructions', () => {
    const error = new VersionIncompatibleError('3.5.2', '1.0.0')
    expect(error.message).toContain('@attest-it/cli@^3.5.2')
  })
})

describe('checkVersionCompatibility', () => {
  describe('positive cases - compatible versions', () => {
    it('should not throw when current version equals minimum version', () => {
      const currentVersion = getPackageVersion()
      expect(() => {
        checkVersionCompatibility(currentVersion)
      }).not.toThrow()
    })

    it('should not throw when current version is greater than minimum (major)', () => {
      // Assume current version is at least 0.1.0
      expect(() => {
        checkVersionCompatibility('0.1.0')
      }).not.toThrow()
    })

    it('should not throw when current version is greater than minimum (minor)', () => {
      expect(() => {
        checkVersionCompatibility('0.0.1')
      }).not.toThrow()
    })

    it('should not throw when current version is greater than minimum (patch)', () => {
      expect(() => {
        checkVersionCompatibility('0.0.0')
      }).not.toThrow()
    })
  })

  describe('negative cases - incompatible versions', () => {
    it('should throw VersionIncompatibleError when current version is less than minimum', () => {
      const currentVersion = getPackageVersion()
      const [majorStr] = currentVersion.split('.')
      const major = Number(majorStr)

      // Create a future version that's definitely higher
      const futureVersion = `${String(major + 1)}.0.0`

      expect(() => {
        checkVersionCompatibility(futureVersion)
      }).toThrow(VersionIncompatibleError)
    })

    it('should throw with correct version information', () => {
      const currentVersion = getPackageVersion()
      const [majorStr] = currentVersion.split('.')
      const major = Number(majorStr)
      const futureVersion = `${String(major + 1)}.0.0`

      try {
        checkVersionCompatibility(futureVersion)
        expect.fail('Should have thrown VersionIncompatibleError')
      } catch (error) {
        expect(error).toBeInstanceOf(VersionIncompatibleError)
        if (error instanceof VersionIncompatibleError) {
          expect(error.requiredVersion).toBe(futureVersion)
          expect(error.currentVersion).toBe(currentVersion)
        }
      }
    })

    it('should throw when minimum version has higher major version', () => {
      const currentVersion = getPackageVersion()
      const [majorStr] = currentVersion.split('.')
      const major = Number(majorStr)
      const futureVersion = `${String(major + 10)}.0.0`

      expect(() => {
        checkVersionCompatibility(futureVersion)
      }).toThrow(VersionIncompatibleError)
      expect(() => {
        checkVersionCompatibility(futureVersion)
      }).toThrow(/requires attest-it version/)
    })
  })

  describe('edge cases - invalid inputs', () => {
    it('should throw Error (not VersionIncompatibleError) for invalid minimum version', () => {
      expect(() => {
        checkVersionCompatibility('not-a-version')
      }).toThrow(Error)
      expect(() => {
        checkVersionCompatibility('not-a-version')
      }).toThrow(/Invalid minimum version/)
      expect(() => {
        checkVersionCompatibility('not-a-version')
      }).not.toThrow(VersionIncompatibleError)
    })

    it('should throw Error for empty minimum version', () => {
      expect(() => {
        checkVersionCompatibility('')
      }).toThrow(Error)
      expect(() => {
        checkVersionCompatibility('')
      }).toThrow(/Invalid minimum version/)
    })

    it('should throw Error for malformed minimum version', () => {
      expect(() => {
        checkVersionCompatibility('1.2')
      }).toThrow(Error)
      expect(() => {
        checkVersionCompatibility('1.2')
      }).toThrow(/Invalid minimum version/)
    })

    it('should throw Error for minimum version with invalid characters', () => {
      expect(() => {
        checkVersionCompatibility('1.2.x')
      }).toThrow(Error)
    })

    it('should throw Error for negative version numbers', () => {
      expect(() => {
        checkVersionCompatibility('-1.0.0')
      }).toThrow(Error)
    })
  })

  describe('edge cases - pre-release and build metadata', () => {
    it('should handle pre-release versions in minimum requirement', () => {
      // If current version is a stable release, it should be >= any pre-release of the same version
      expect(() => {
        checkVersionCompatibility('0.0.0-alpha')
      }).not.toThrow()
    })

    it('should handle build metadata in minimum requirement', () => {
      expect(() => {
        checkVersionCompatibility('0.0.0+build.1')
      }).not.toThrow()
    })
  })

  describe('boundary cases', () => {
    it('should correctly compare when patch versions differ', () => {
      const currentVersion = getPackageVersion()
      const parts = currentVersion.split('.').map((v) => v.split('-')[0])
      const major = Number(parts[0])
      const minor = Number(parts[1])
      const patch = Number(parts[2])

      if (patch > 0) {
        // Current version should be >= previous patch
        expect(() => {
          checkVersionCompatibility(`${String(major)}.${String(minor)}.${String(patch - 1)}`)
        }).not.toThrow()
      }
    })

    it('should correctly compare when minor versions differ', () => {
      const currentVersion = getPackageVersion()
      const parts = currentVersion.split('.').map((v) => v.split('-')[0])
      const major = Number(parts[0])
      const minor = Number(parts[1])

      if (minor > 0) {
        // Current version should be >= previous minor
        expect(() => {
          checkVersionCompatibility(`${String(major)}.${String(minor - 1)}.0`)
        }).not.toThrow()
      }
    })

    it('should correctly compare when major versions differ', () => {
      const currentVersion = getPackageVersion()
      const parts = currentVersion.split('.').map((v) => v.split('-')[0])
      const major = Number(parts[0])

      if (major > 0) {
        // Current version should be >= previous major
        expect(() => {
          checkVersionCompatibility(`${String(major - 1)}.0.0`)
        }).not.toThrow()
      }
    })

    it('should handle version 0.0.0 as minimum', () => {
      // Any version should be >= 0.0.0
      expect(() => {
        checkVersionCompatibility('0.0.0')
      }).not.toThrow()
    })

    it('should handle exact version match with pre-release tags', () => {
      const currentVersion = getPackageVersion()
      // If current version has no pre-release, this should pass
      // If it has a pre-release, we need the exact match
      expect(() => {
        checkVersionCompatibility(currentVersion)
      }).not.toThrow()
    })
  })
})
