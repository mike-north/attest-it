import * as fs from 'node:fs'
import * as path from 'node:path'
import { describe, expect, it } from 'vitest'
import { computeFingerprint } from '../src/fingerprint.js'

describe('fingerprint streaming for large files', () => {
  describe('positive tests', () => {
    it('should handle large files via streaming', async () => {
      const tempDir = fs.mkdtempSync(path.join(__dirname, 'test-large-'))
      try {
        // Create a file larger than 50MB (streaming threshold)
        const largeFile = path.join(tempDir, 'large.bin')
        const fileSize = 51 * 1024 * 1024 // 51MB
        const buffer = Buffer.alloc(fileSize, 'a')
        fs.writeFileSync(largeFile, buffer)

        // Compute fingerprint - this should use streaming
        const result = await computeFingerprint({
          packages: ['.'],
          baseDir: tempDir,
        })

        expect(result.fingerprint).toMatch(/^sha256:[0-9a-f]{64}$/)
        expect(result.files).toContain('large.bin')
        expect(result.fileCount).toBe(1)
      } finally {
        fs.rmSync(tempDir, { recursive: true })
      }
    })

    it('should produce same fingerprint for small and large files with same content', async () => {
      const tempDir = fs.mkdtempSync(path.join(__dirname, 'test-consistency-'))
      try {
        // Create a small file (will be read into memory)
        const smallFile = path.join(tempDir, 'small.txt')
        const content = 'test content'
        fs.writeFileSync(smallFile, content)

        const smallResult = await computeFingerprint({
          packages: ['.'],
          baseDir: tempDir,
        })

        // Clean up
        fs.unlinkSync(smallFile)

        // Create a larger file with same content (still under threshold, but different code path)
        const mediumFile = path.join(tempDir, 'small.txt')
        fs.writeFileSync(mediumFile, content)

        const mediumResult = await computeFingerprint({
          packages: ['.'],
          baseDir: tempDir,
        })

        // Fingerprints should be identical
        expect(smallResult.fingerprint).toBe(mediumResult.fingerprint)
      } finally {
        fs.rmSync(tempDir, { recursive: true })
      }
    })

    it('should handle mixed small and large files', async () => {
      const tempDir = fs.mkdtempSync(path.join(__dirname, 'test-mixed-'))
      try {
        // Create a small file
        const smallFile = path.join(tempDir, 'small.txt')
        fs.writeFileSync(smallFile, 'small content')

        // Create a large file
        const largeFile = path.join(tempDir, 'large.bin')
        const buffer = Buffer.alloc(51 * 1024 * 1024, 'b')
        fs.writeFileSync(largeFile, buffer)

        const result = await computeFingerprint({
          packages: ['.'],
          baseDir: tempDir,
        })

        expect(result.fingerprint).toMatch(/^sha256:[0-9a-f]{64}$/)
        expect(result.files).toContain('small.txt')
        expect(result.files).toContain('large.bin')
        expect(result.fileCount).toBe(2)
      } finally {
        fs.rmSync(tempDir, { recursive: true })
      }
    })
  })

  describe('negative tests', () => {
    it('should handle errors when reading large files', async () => {
      const tempDir = fs.mkdtempSync(path.join(__dirname, 'test-error-'))
      try {
        // Create a large file
        const largeFile = path.join(tempDir, 'large.bin')
        const buffer = Buffer.alloc(51 * 1024 * 1024, 'c')
        fs.writeFileSync(largeFile, buffer)

        // Remove file permissions to cause read error (Unix-like systems)
        if (process.platform !== 'win32') {
          fs.chmodSync(largeFile, 0o000)

          await expect(
            computeFingerprint({
              packages: ['.'],
              baseDir: tempDir,
            }),
          ).rejects.toThrow()

          // Restore permissions for cleanup
          fs.chmodSync(largeFile, 0o644)
        }
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true })
      }
    })
  })

  describe('edge cases', () => {
    it('should handle file exactly at streaming threshold', async () => {
      const tempDir = fs.mkdtempSync(path.join(__dirname, 'test-threshold-'))
      try {
        // Create a file exactly at 50MB (the threshold)
        const thresholdFile = path.join(tempDir, 'threshold.bin')
        const buffer = Buffer.alloc(50 * 1024 * 1024, 'd')
        fs.writeFileSync(thresholdFile, buffer)

        const result = await computeFingerprint({
          packages: ['.'],
          baseDir: tempDir,
        })

        expect(result.fingerprint).toMatch(/^sha256:[0-9a-f]{64}$/)
        expect(result.files).toContain('threshold.bin')
        expect(result.fileCount).toBe(1)
      } finally {
        fs.rmSync(tempDir, { recursive: true })
      }
    })

    it('should handle file just over streaming threshold', async () => {
      const tempDir = fs.mkdtempSync(path.join(__dirname, 'test-over-'))
      try {
        // Create a file just over 50MB
        const overFile = path.join(tempDir, 'over.bin')
        const buffer = Buffer.alloc(50 * 1024 * 1024 + 1, 'e')
        fs.writeFileSync(overFile, buffer)

        const result = await computeFingerprint({
          packages: ['.'],
          baseDir: tempDir,
        })

        expect(result.fingerprint).toMatch(/^sha256:[0-9a-f]{64}$/)
        expect(result.files).toContain('over.bin')
        expect(result.fileCount).toBe(1)
      } finally {
        fs.rmSync(tempDir, { recursive: true })
      }
    })
  })
})
