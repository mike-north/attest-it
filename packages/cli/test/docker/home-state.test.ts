import { beforeAll, describe, expect, it } from 'vitest'
import { execSync } from 'node:child_process'

/**
 * Check if Docker is available on the system.
 * @returns true if Docker is installed and accessible
 */
function isDockerAvailable(): boolean {
  try {
    execSync('docker --version', { stdio: 'pipe' })
    return true
  } catch {
    return false
  }
}

describe.skipIf(!isDockerAvailable())('Docker-based home folder state tests', () => {
  beforeAll(() => {
    // Build Docker images before running tests
    console.log('Building Docker images...')
    execSync('docker compose build', {
      cwd: __dirname,
      stdio: 'inherit',
    })
  }, 120_000) // 2 minute timeout for Docker build

  it('should handle fresh user with no config', () => {
    const output = execSync('docker compose run --rm test-fresh-user', {
      cwd: __dirname,
      encoding: 'utf8',
      stdio: 'pipe',
    })

    expect(output).toContain('PASSED')
  })

  it('should recognize existing identity', () => {
    const output = execSync('docker compose run --rm test-existing-identity', {
      cwd: __dirname,
      encoding: 'utf8',
      stdio: 'pipe',
    })

    expect(output).toContain('PASSED')
  })

  it('should handle corrupted config gracefully', () => {
    const output = execSync('docker compose run --rm test-corrupted-config', {
      cwd: __dirname,
      encoding: 'utf8',
      stdio: 'pipe',
    })

    expect(output).toContain('PASSED')
  })
})
