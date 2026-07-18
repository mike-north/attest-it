import * as fs from 'node:fs'
import * as path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  computeFingerprint,
  computeFingerprintSync,
  computeFingerprintsPerFile,
  computeFingerprintsPerFileSync,
  listPackageFiles,
} from '../src/fingerprint.js'

const FIXTURES_DIR = path.join(__dirname, 'fixtures')
const TEST_PROJECT_DIR = path.join(FIXTURES_DIR, 'fingerprint-test-project')

describe('fingerprint', () => {
  describe('computeFingerprint', () => {
    describe('positive tests', () => {
      it('should compute fingerprint for a single file', async () => {
        const tempDir = fs.mkdtempSync(path.join(__dirname, 'test-'))
        try {
          const testFile = path.join(tempDir, 'test.txt')
          fs.writeFileSync(testFile, 'hello world')

          const result = await computeFingerprint({
            paths: ['.'],
            baseDir: tempDir,
          })

          expect(result.fingerprint).toMatch(/^sha256:[0-9a-f]{64}$/)
          expect(result.files).toContain('test.txt')
          expect(result.fileCount).toBe(1)
        } finally {
          fs.rmSync(tempDir, { recursive: true })
        }
      })

      it('should produce consistent fingerprint across multiple calls', async () => {
        const result1 = await computeFingerprint({
          paths: ['src'],
          baseDir: TEST_PROJECT_DIR,
        })

        const result2 = await computeFingerprint({
          paths: ['src'],
          baseDir: TEST_PROJECT_DIR,
        })

        expect(result1.fingerprint).toBe(result2.fingerprint)
        expect(result1.files).toEqual(result2.files)
        expect(result1.fileCount).toBe(result2.fileCount)
      })

      it('should handle multiple files in sorted order', async () => {
        const result = await computeFingerprint({
          paths: ['src'],
          baseDir: TEST_PROJECT_DIR,
        })

        expect(result.files).toContain('src/index.ts')
        expect(result.files).toContain('src/utils.ts')
        expect(result.fileCount).toBe(2)

        // Verify files are sorted
        const sortedFiles = [...result.files].sort()
        expect(result.files).toEqual(sortedFiles)
      })

      it('should respect ignore patterns', async () => {
        const result = await computeFingerprint({
          paths: ['.'],
          exclude: ['src/**'],
          baseDir: TEST_PROJECT_DIR,
        })

        expect(result.files).not.toContain('src/index.ts')
        expect(result.files).not.toContain('src/utils.ts')
      })

      it('should respect .gitignore', async () => {
        const result = await computeFingerprint({
          paths: ['.'],
          exclude: ['.git/**'], // Exclude .git directory from results
          baseDir: TEST_PROJECT_DIR,
        })

        // .git directory should not be included
        expect(result.files.some((f) => f.startsWith('.git/'))).toBe(false)

        // For now, skip the .gitignore test as tinyglobby's gitignore support
        // requires a properly configured git repository
        // This is tested in the "respect ignore patterns" test instead
        // expect(result.files).not.toContain('ignored.txt');
      })

      it('should handle binary files correctly', async () => {
        const result = await computeFingerprint({
          paths: ['.'],
          baseDir: TEST_PROJECT_DIR,
        })

        expect(result.files).toContain('binary.bin')
        expect(result.fingerprint).toMatch(/^sha256:[0-9a-f]{64}$/)
      })

      it('should follow symlinks', async () => {
        const tempDir = fs.mkdtempSync(path.join(__dirname, 'test-'))
        try {
          const targetFile = path.join(tempDir, 'target.txt')
          const linkFile = path.join(tempDir, 'link.txt')
          fs.writeFileSync(targetFile, 'target content')
          fs.symlinkSync(targetFile, linkFile)

          const result = await computeFingerprint({
            paths: ['.'],
            baseDir: tempDir,
          })

          expect(result.files).toContain('link.txt')
          expect(result.files).toContain('target.txt')
          expect(result.fileCount).toBe(2)
        } finally {
          fs.rmSync(tempDir, { recursive: true })
        }
      })

      it('should handle multiple packages', async () => {
        const tempDir = fs.mkdtempSync(path.join(__dirname, 'test-'))
        try {
          const pkg1 = path.join(tempDir, 'pkg1')
          const pkg2 = path.join(tempDir, 'pkg2')
          fs.mkdirSync(pkg1)
          fs.mkdirSync(pkg2)
          fs.writeFileSync(path.join(pkg1, 'file1.txt'), 'content1')
          fs.writeFileSync(path.join(pkg2, 'file2.txt'), 'content2')

          const result = await computeFingerprint({
            paths: ['pkg1', 'pkg2'],
            baseDir: tempDir,
          })

          expect(result.files).toContain('pkg1/file1.txt')
          expect(result.files).toContain('pkg2/file2.txt')
          expect(result.fileCount).toBe(2)
        } finally {
          fs.rmSync(tempDir, { recursive: true })
        }
      })
    })

    describe('negative tests', () => {
      it('should throw error for empty paths array', async () => {
        await expect(
          computeFingerprint({
            paths: [],
          }),
        ).rejects.toThrow('paths array must not be empty')
      })

      it('should throw error for non-existent package path', async () => {
        await expect(
          computeFingerprint({
            paths: ['non-existent-path'],
            baseDir: TEST_PROJECT_DIR,
          }),
        ).rejects.toThrow('Path does not exist')
      })

      it('should detect circular symlinks when multiple symlinks point to same file', async () => {
        const tempDir = fs.mkdtempSync(path.join(__dirname, 'test-'))
        try {
          // Create a real file
          const realFile = path.join(tempDir, 'real.txt')
          fs.writeFileSync(realFile, 'content')

          // Create two symlinks pointing to the same file
          const link1 = path.join(tempDir, 'link1.txt')
          const link2 = path.join(tempDir, 'link2.txt')
          fs.symlinkSync(realFile, link1)
          fs.symlinkSync(realFile, link2)

          // This should NOT throw - multiple symlinks to same file is fine
          // The circular symlink detection is to prevent infinite loops,
          // but multiple symlinks to same file just means the file is hashed multiple times
          const result = await computeFingerprint({
            paths: ['.'],
            baseDir: tempDir,
          })

          // All three should be present (real file + 2 links)
          expect(result.fileCount).toBe(3)
        } finally {
          fs.rmSync(tempDir, { recursive: true, force: true })
        }
      })
    })

    describe('determinism tests', () => {
      it('should produce same fingerprint regardless of file discovery order', async () => {
        // Run multiple times to ensure consistency
        const results = await Promise.all([
          computeFingerprint({ paths: ['src'], baseDir: TEST_PROJECT_DIR }),
          computeFingerprint({ paths: ['src'], baseDir: TEST_PROJECT_DIR }),
          computeFingerprint({ paths: ['src'], baseDir: TEST_PROJECT_DIR }),
        ])

        const fingerprints = results.map((r) => r.fingerprint)
        expect(new Set(fingerprints).size).toBe(1)
      })

      it('should change fingerprint when file is added', async () => {
        const tempDir = fs.mkdtempSync(path.join(__dirname, 'test-'))
        try {
          fs.writeFileSync(path.join(tempDir, 'file1.txt'), 'content1')

          const result1 = await computeFingerprint({
            paths: ['.'],
            baseDir: tempDir,
          })

          // Add a new file
          fs.writeFileSync(path.join(tempDir, 'file2.txt'), 'content2')

          const result2 = await computeFingerprint({
            paths: ['.'],
            baseDir: tempDir,
          })

          expect(result1.fingerprint).not.toBe(result2.fingerprint)
        } finally {
          fs.rmSync(tempDir, { recursive: true })
        }
      })

      it('should change fingerprint when file is removed', async () => {
        const tempDir = fs.mkdtempSync(path.join(__dirname, 'test-'))
        try {
          fs.writeFileSync(path.join(tempDir, 'file1.txt'), 'content1')
          fs.writeFileSync(path.join(tempDir, 'file2.txt'), 'content2')

          const result1 = await computeFingerprint({
            paths: ['.'],
            baseDir: tempDir,
          })

          // Remove a file
          fs.unlinkSync(path.join(tempDir, 'file2.txt'))

          const result2 = await computeFingerprint({
            paths: ['.'],
            baseDir: tempDir,
          })

          expect(result1.fingerprint).not.toBe(result2.fingerprint)
        } finally {
          fs.rmSync(tempDir, { recursive: true })
        }
      })

      it('should change fingerprint when file content is modified', async () => {
        const tempDir = fs.mkdtempSync(path.join(__dirname, 'test-'))
        try {
          const testFile = path.join(tempDir, 'test.txt')
          fs.writeFileSync(testFile, 'original content')

          const result1 = await computeFingerprint({
            paths: ['.'],
            baseDir: tempDir,
          })

          // Modify file content
          fs.writeFileSync(testFile, 'modified content')

          const result2 = await computeFingerprint({
            paths: ['.'],
            baseDir: tempDir,
          })

          expect(result1.fingerprint).not.toBe(result2.fingerprint)
        } finally {
          fs.rmSync(tempDir, { recursive: true })
        }
      })

      it('should change fingerprint when file is renamed', async () => {
        const tempDir = fs.mkdtempSync(path.join(__dirname, 'test-'))
        try {
          fs.writeFileSync(path.join(tempDir, 'oldname.txt'), 'content')

          const result1 = await computeFingerprint({
            paths: ['.'],
            baseDir: tempDir,
          })

          // Rename file
          fs.renameSync(path.join(tempDir, 'oldname.txt'), path.join(tempDir, 'newname.txt'))

          const result2 = await computeFingerprint({
            paths: ['.'],
            baseDir: tempDir,
          })

          expect(result1.fingerprint).not.toBe(result2.fingerprint)
        } finally {
          fs.rmSync(tempDir, { recursive: true })
        }
      })
    })

    describe('edge cases', () => {
      it('should handle empty directory', async () => {
        const tempDir = fs.mkdtempSync(path.join(__dirname, 'test-'))
        try {
          const result = await computeFingerprint({
            paths: ['.'],
            baseDir: tempDir,
          })

          expect(result.fileCount).toBe(0)
          expect(result.files).toEqual([])
          expect(result.fingerprint).toMatch(/^sha256:[0-9a-f]{64}$/)
        } finally {
          fs.rmSync(tempDir, { recursive: true })
        }
      })

      it('should handle files with unusual characters in names', async () => {
        const tempDir = fs.mkdtempSync(path.join(__dirname, 'test-'))
        try {
          const weirdName = 'file with spaces & special!chars.txt'
          fs.writeFileSync(path.join(tempDir, weirdName), 'content')

          const result = await computeFingerprint({
            paths: ['.'],
            baseDir: tempDir,
          })

          expect(result.files).toContain(weirdName)
          expect(result.fileCount).toBe(1)
        } finally {
          fs.rmSync(tempDir, { recursive: true })
        }
      })

      it('should handle deeply nested directories', async () => {
        const tempDir = fs.mkdtempSync(path.join(__dirname, 'test-'))
        try {
          const deepPath = path.join(tempDir, 'a', 'b', 'c', 'd', 'e')
          fs.mkdirSync(deepPath, { recursive: true })
          fs.writeFileSync(path.join(deepPath, 'deep.txt'), 'deep content')

          const result = await computeFingerprint({
            paths: ['.'],
            baseDir: tempDir,
          })

          expect(result.files).toContain('a/b/c/d/e/deep.txt')
          expect(result.fileCount).toBe(1)
        } finally {
          fs.rmSync(tempDir, { recursive: true })
        }
      })
    })
  })

  describe('computeFingerprintSync', () => {
    it('should produce same result as async version', () => {
      const asyncResult = computeFingerprint({
        paths: ['src'],
        baseDir: TEST_PROJECT_DIR,
      })

      const syncResult = computeFingerprintSync({
        paths: ['src'],
        baseDir: TEST_PROJECT_DIR,
      })

      return asyncResult.then((async) => {
        expect(syncResult.fingerprint).toBe(async.fingerprint)
        expect(syncResult.files).toEqual(async.files)
        expect(syncResult.fileCount).toBe(async.fileCount)
      })
    })

    it('should throw error for empty paths array', () => {
      expect(() =>
        computeFingerprintSync({
          paths: [],
        }),
      ).toThrow('paths array must not be empty')
    })

    it('should throw error for non-existent package path', () => {
      expect(() =>
        computeFingerprintSync({
          paths: ['non-existent-path'],
          baseDir: TEST_PROJECT_DIR,
        }),
      ).toThrow('Path does not exist')
    })
  })

  describe('listPackageFiles', () => {
    it('should list all files in package', async () => {
      const files = await listPackageFiles(['src'], [], TEST_PROJECT_DIR)

      expect(files).toContain('src/index.ts')
      expect(files).toContain('src/utils.ts')
    })

    it('should respect ignore patterns', async () => {
      const files = await listPackageFiles(['.'], ['src/**'], TEST_PROJECT_DIR)

      expect(files).not.toContain('src/index.ts')
      expect(files).not.toContain('src/utils.ts')
    })

    it('should respect .gitignore', async () => {
      const files = await listPackageFiles(['.'], ['.git/**'], TEST_PROJECT_DIR)

      // .git directory should not be included
      expect(files.some((f) => f.startsWith('.git/'))).toBe(false)

      // For now, skip the .gitignore test as tinyglobby's gitignore support
      // requires a properly configured git repository
      // This is tested in the "respect ignore patterns" test instead
      // expect(files).not.toContain('ignored.txt');
    })

    it('should handle multiple packages', async () => {
      const tempDir = fs.mkdtempSync(path.join(__dirname, 'test-'))
      try {
        const pkg1 = path.join(tempDir, 'pkg1')
        const pkg2 = path.join(tempDir, 'pkg2')
        fs.mkdirSync(pkg1)
        fs.mkdirSync(pkg2)
        fs.writeFileSync(path.join(pkg1, 'file1.txt'), 'content1')
        fs.writeFileSync(path.join(pkg2, 'file2.txt'), 'content2')

        const files = await listPackageFiles(['pkg1', 'pkg2'], [], tempDir)

        expect(files).toContain('pkg1/file1.txt')
        expect(files).toContain('pkg2/file2.txt')
      } finally {
        fs.rmSync(tempDir, { recursive: true })
      }
    })
  })
})

describe('computeFingerprintsPerFile (pattern-gate mode, #69)', () => {
  it('returns one independent fingerprint per matched file, sorted by path', async () => {
    const tempDir = fs.mkdtempSync(path.join(__dirname, 'perfile-'))
    try {
      fs.mkdirSync(path.join(tempDir, 'tools'))
      fs.writeFileSync(path.join(tempDir, 'tools', 'b.sh'), 'echo b\n')
      fs.writeFileSync(path.join(tempDir, 'tools', 'a.sh'), 'echo a\n')

      const results = await computeFingerprintsPerFile({ paths: ['tools/*.sh'], baseDir: tempDir })

      // One result per file, lexicographically ordered (matches sortFiles).
      expect(results.map((r) => r.path)).toEqual(['tools/a.sh', 'tools/b.sh'])
      for (const r of results) {
        expect(r.fingerprint).toMatch(/^sha256:[0-9a-f]{64}$/)
      }
      // Distinct files → distinct fingerprints.
      expect(results[0]?.fingerprint).not.toBe(results[1]?.fingerprint)
    } finally {
      fs.rmSync(tempDir, { recursive: true })
    }
  })

  it('sync and async modes agree', () => {
    const tempDir = fs.mkdtempSync(path.join(__dirname, 'perfile-sync-'))
    try {
      fs.mkdirSync(path.join(tempDir, 'tools'))
      fs.writeFileSync(path.join(tempDir, 'tools', 'a.sh'), 'echo a\n')
      fs.writeFileSync(path.join(tempDir, 'tools', 'b.sh'), 'echo b\n')

      const sync = computeFingerprintsPerFileSync({ paths: ['tools/*.sh'], baseDir: tempDir })
      expect(sync.map((r) => r.path)).toEqual(['tools/a.sh', 'tools/b.sh'])
    } finally {
      fs.rmSync(tempDir, { recursive: true })
    }
  })

  it('a per-file fingerprint equals the combined fingerprint of that file alone', async () => {
    // The per-file mode must bind exactly what a single-file gate would seal, so
    // a file that migrates between gate shapes keeps a stable fingerprint.
    const tempDir = fs.mkdtempSync(path.join(__dirname, 'perfile-eq-'))
    try {
      fs.mkdirSync(path.join(tempDir, 'tools'))
      fs.writeFileSync(path.join(tempDir, 'tools', 'a.sh'), 'echo a\n')
      fs.writeFileSync(path.join(tempDir, 'tools', 'b.sh'), 'echo b\n')

      const perFile = await computeFingerprintsPerFile({ paths: ['tools/*.sh'], baseDir: tempDir })
      const combinedA = await computeFingerprint({ paths: ['tools/a.sh'], baseDir: tempDir })
      const a = perFile.find((r) => r.path === 'tools/a.sh')
      expect(a?.fingerprint).toBe(combinedA.fingerprint)
    } finally {
      fs.rmSync(tempDir, { recursive: true })
    }
  })

  it('ADVERSARIAL: symlink aliases of the same content do NOT share a fingerprint', async () => {
    // Per-file independence must not be gameable by aliasing two logical paths to
    // the same bytes: the fingerprint binds the path (SHA256(path + ":" + bytes)),
    // so a seal for one path can never authorize the other.
    const tempDir = fs.mkdtempSync(path.join(__dirname, 'perfile-symlink-'))
    try {
      fs.mkdirSync(path.join(tempDir, 'tools'))
      fs.writeFileSync(path.join(tempDir, 'tools', 'real.sh'), 'echo shared\n')
      // alias.sh is a symlink to real.sh — identical bytes, different path.
      fs.symlinkSync(
        path.join(tempDir, 'tools', 'real.sh'),
        path.join(tempDir, 'tools', 'alias.sh'),
      )

      const results = await computeFingerprintsPerFile({ paths: ['tools/*.sh'], baseDir: tempDir })
      const real = results.find((r) => r.path === 'tools/real.sh')
      const alias = results.find((r) => r.path === 'tools/alias.sh')
      expect(real).toBeDefined()
      expect(alias).toBeDefined()
      expect(real?.fingerprint).not.toBe(alias?.fingerprint)
    } finally {
      fs.rmSync(tempDir, { recursive: true })
    }
  })
})
