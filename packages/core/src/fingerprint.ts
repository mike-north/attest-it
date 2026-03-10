import * as crypto from 'node:crypto'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { glob, globSync } from 'tinyglobby'
import { getWasm } from './wasm-bridge.js'

/**
 * Threshold for streaming large files instead of reading into memory.
 * Files larger than this will be hashed via streaming to avoid memory issues.
 */
const LARGE_FILE_THRESHOLD = 50 * 1024 * 1024 // 50MB

/**
 * Options for computing a package fingerprint.
 * @public
 */
export interface FingerprintOptions {
  /** Paths or glob patterns to include in fingerprint */
  paths: string[]
  /** Glob patterns to exclude from fingerprint */
  exclude?: string[]
  /** Base directory for resolving paths */
  baseDir?: string
}

/**
 * Result of computing a package fingerprint.
 * @public
 */
export interface FingerprintResult {
  /** The fingerprint in "sha256:..." format */
  fingerprint: string
  /** List of files included in fingerprint calculation */
  files: string[]
  /** Number of files processed */
  fileCount: number
}

/**
 * Internal representation of a file hash for fingerprint computation.
 */
interface FileHashInput {
  /** The normalized relative path of the file */
  relativePath: string
  /** The computed hash of the file content */
  hash: Buffer
}

/**
 * Sort files lexicographically (locale-independent).
 */
function sortFiles(files: string[]): string[] {
  return [...files].sort((a, b) => {
    if (a < b) return -1
    if (a > b) return 1
    return 0
  })
}

/**
 * Normalize path separators to forward slashes.
 */
function normalizePath(filePath: string): string {
  return filePath.split(path.sep).join('/')
}

/**
 * Compute final fingerprint from file hashes.
 */
function computeFinalFingerprint(fileHashes: FileHashInput[]): string {
  // Sort by relative path
  const sorted = [...fileHashes].sort((a, b) => {
    if (a.relativePath < b.relativePath) return -1
    if (a.relativePath > b.relativePath) return 1
    return 0
  })

  // Concatenate all file hashes
  const hashes = sorted.map((input) => input.hash)
  const concatenated = Buffer.concat(hashes)

  // Compute final hash
  const finalHash = crypto.createHash('sha256').update(concatenated).digest()
  return `sha256:${finalHash.toString('hex')}`
}

/**
 * Hash a file's content using streaming for large files (async).
 * For files larger than LARGE_FILE_THRESHOLD, uses streaming to avoid memory issues.
 */
async function hashFileAsync(
  realPath: string,
  normalizedPath: string,
  stats: fs.Stats,
): Promise<Buffer> {
  if (stats.size > LARGE_FILE_THRESHOLD) {
    // Stream large files to avoid memory issues
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash('sha256')
      hash.update(normalizedPath)
      hash.update(':')

      const stream = fs.createReadStream(realPath)
      stream.on('data', (chunk: string | Buffer) => {
        hash.update(chunk)
      })
      stream.on('end', () => {
        resolve(hash.digest())
      })
      stream.on('error', reject)
    })
  }

  // Read small files into memory (faster than streaming)
  const content = await fs.promises.readFile(realPath)
  const hash = crypto.createHash('sha256')
  hash.update(normalizedPath)
  hash.update(':')
  hash.update(content)
  return hash.digest()
}

/**
 * Hash a file's content synchronously.
 * Note: Cannot stream synchronously, so large files are read into memory.
 */
function hashFileSync(realPath: string, normalizedPath: string): Buffer {
  const content = fs.readFileSync(realPath)
  const hash = crypto.createHash('sha256')
  hash.update(normalizedPath)
  hash.update(':')
  hash.update(content)
  return hash.digest()
}

/**
 * Check if a path contains glob pattern characters.
 */
function isGlobPattern(pathStr: string): boolean {
  return /[*?{}[\]]/.test(pathStr)
}

/**
 * Validate fingerprint options and return base directory.
 */
function validateOptions(options: FingerprintOptions): string {
  if (options.paths.length === 0) {
    throw new Error('paths array must not be empty')
  }

  const baseDir = options.baseDir ?? process.cwd()

  // Verify all non-glob paths exist
  // Glob patterns are validated later by tinyglobby
  for (const p of options.paths) {
    if (!isGlobPattern(p)) {
      const resolvedPath = path.resolve(baseDir, p)
      if (!fs.existsSync(resolvedPath)) {
        throw new Error(`Path does not exist: ${resolvedPath}`)
      }
    }
  }

  return baseDir
}

/**
 * Compute a deterministic fingerprint for a set of packages (async).
 *
 * Algorithm:
 * 1. List all files in packages (respecting ignore globs)
 * 2. Sort files lexicographically by relative path
 * 3. For each file: compute SHA256(relativePath + ":" + content)
 * 4. Concatenate all file hashes in sorted order
 * 5. Compute final SHA256 of concatenated hashes
 * 6. Return "sha256:" + hex(fingerprint)
 *
 * @param options - Configuration for fingerprint computation
 * @returns Result containing the fingerprint hash and list of files processed
 * @throws Error if packages array is empty or if package paths don't exist
 * @public
 */
export async function computeFingerprint(options: FingerprintOptions): Promise<FingerprintResult> {
  // Delegate to WASM if initialized
  const wasm = getWasm()
  if (wasm) {
    const wasmOpts: { paths: string[]; ignore?: string[]; baseDir?: string } = {
      paths: options.paths,
    }
    if (options.exclude) wasmOpts.ignore = options.exclude
    if (options.baseDir) wasmOpts.baseDir = options.baseDir
    return wasm.computeFingerprint(wasmOpts)
  }

  // Fall back to TypeScript implementation
  const baseDir = validateOptions(options)

  // List all files in packages
  const files = await listPackageFiles(options.paths, options.exclude, baseDir)

  // Sort files lexicographically
  const sortedFiles = sortFiles(files)

  // Track visited files to handle multiple symlinks pointing to the same file
  // Key: realpath, Value: file hash
  const fileHashCache = new Map<string, Buffer>()

  // Compute individual file hashes
  const fileHashInputs: FileHashInput[] = []
  for (const file of sortedFiles) {
    const filePath = path.resolve(baseDir, file)

    // Handle symlinks
    let realPath = filePath
    let stats = await fs.promises.lstat(filePath)

    if (stats.isSymbolicLink()) {
      try {
        realPath = await fs.promises.realpath(filePath)
      } catch {
        // Skip broken symlinks
        continue
      }

      // Get stats of the target
      try {
        stats = await fs.promises.stat(realPath)
      } catch {
        // Skip broken symlinks
        continue
      }
    }

    // Skip if not a file (e.g., directories)
    if (!stats.isFile()) {
      continue
    }

    // Normalize path separators to forward slashes
    const normalizedPath = normalizePath(file)

    // Check if we've already hashed this file (via symlinks)
    let hash: Buffer
    const cachedHash = fileHashCache.get(realPath)
    if (cachedHash !== undefined) {
      // Reuse cached hash for files we've already seen (via symlinks)
      hash = cachedHash
    } else {
      // Hash the file content
      hash = await hashFileAsync(realPath, normalizedPath, stats)
      fileHashCache.set(realPath, hash)
    }

    fileHashInputs.push({ relativePath: normalizedPath, hash })
  }

  // Compute final fingerprint
  const fingerprint = computeFinalFingerprint(fileHashInputs)

  return {
    fingerprint,
    files: sortedFiles,
    fileCount: sortedFiles.length,
  }
}

/**
 * Compute a deterministic fingerprint for a set of packages (sync).
 *
 * Note: This always uses the TypeScript implementation, even when WASM is
 * initialized. The WASM fingerprint path is inherently async (host callbacks
 * for file I/O and glob resolution are Promise-based), so the sync variant
 * cannot delegate to WASM. Use {@link computeFingerprint} for WASM-accelerated
 * fingerprinting.
 *
 * @param options - Configuration for fingerprint computation
 * @returns Result containing the fingerprint hash and list of files processed
 * @throws Error if packages array is empty or if package paths don't exist
 * @public
 * @see {@link computeFingerprint} for the async version with WASM support
 */
export function computeFingerprintSync(options: FingerprintOptions): FingerprintResult {
  const baseDir = validateOptions(options)

  // List all files in packages (sync version)
  const files = listPackageFilesSync(options.paths, options.exclude, baseDir)

  // Sort files lexicographically
  const sortedFiles = sortFiles(files)

  // Track visited files to handle multiple symlinks pointing to the same file
  // Key: realpath, Value: file hash
  const fileHashCache = new Map<string, Buffer>()

  // Compute individual file hashes
  const fileHashInputs: FileHashInput[] = []
  for (const file of sortedFiles) {
    const filePath = path.resolve(baseDir, file)

    // Handle symlinks
    let realPath = filePath
    let stats = fs.lstatSync(filePath)

    if (stats.isSymbolicLink()) {
      try {
        realPath = fs.realpathSync(filePath)
      } catch {
        // Skip broken symlinks
        continue
      }

      // Get stats of the target
      try {
        stats = fs.statSync(realPath)
      } catch {
        // Skip broken symlinks
        continue
      }
    }

    // Skip if not a file (e.g., directories)
    if (!stats.isFile()) {
      continue
    }

    // Normalize path separators to forward slashes
    const normalizedPath = normalizePath(file)

    // Check if we've already hashed this file (via symlinks)
    let hash: Buffer
    const cachedHash = fileHashCache.get(realPath)
    if (cachedHash !== undefined) {
      // Reuse cached hash for files we've already seen (via symlinks)
      hash = cachedHash
    } else {
      // Hash the file content (sync version cannot stream)
      hash = hashFileSync(realPath, normalizedPath)
      fileHashCache.set(realPath, hash)
    }

    fileHashInputs.push({ relativePath: normalizedPath, hash })
  }

  // Compute final fingerprint
  const fingerprint = computeFinalFingerprint(fileHashInputs)

  return {
    fingerprint,
    files: sortedFiles,
    fileCount: sortedFiles.length,
  }
}

/**
 * Resolve a package path to a glob pattern.
 *
 * - If the path is a glob pattern, return it as-is
 * - If the path is a file, return it as-is (to match that specific file)
 * - If the path is a directory, append '/**\/*' to match all files within
 * - If the path doesn't exist, return it as-is (will match 0 files)
 */
function resolvePackagePattern(pkg: string, baseDir: string): string {
  if (isGlobPattern(pkg)) {
    return pkg
  }

  const fullPath = path.resolve(baseDir, pkg)
  try {
    const stats = fs.statSync(fullPath)
    return stats.isFile() ? pkg : `${pkg}/**/*`
  } catch {
    // Path doesn't exist - return as-is (will match 0 files)
    return pkg
  }
}

/**
 * Common glob options for file listing.
 */
const GLOB_OPTIONS = {
  onlyFiles: true,
  dot: true, // Include dotfiles
  absolute: false, // Return relative paths
} as const

/**
 * List files in packages, respecting ignore patterns (async).
 *
 * @param packages - Array of package directory paths or glob patterns
 * @param ignore - Optional glob patterns to exclude
 * @param baseDir - Base directory for resolving paths (defaults to cwd)
 * @returns Array of relative file paths
 * @throws Error if a glob pattern matches no files
 * @public
 */
export async function listPackageFiles(
  packages: string[],
  ignore: string[] = [],
  baseDir: string = process.cwd(),
): Promise<string[]> {
  const allFiles: string[] = []

  for (const pkg of packages) {
    const pattern = resolvePackagePattern(pkg, baseDir)

    const files = await glob([pattern], {
      ...GLOB_OPTIONS,
      cwd: baseDir,
      ignore,
    })

    if (files.length === 0 && isGlobPattern(pkg)) {
      throw new Error(`Glob pattern matched no files: ${pkg}`)
    }

    allFiles.push(...files)
  }

  return allFiles
}

/**
 * Synchronous version of listPackageFiles.
 * @throws Error if a glob pattern matches no files
 */
function listPackageFilesSync(
  packages: string[],
  ignore: string[] = [],
  baseDir: string = process.cwd(),
): string[] {
  const allFiles: string[] = []

  for (const pkg of packages) {
    const pattern = resolvePackagePattern(pkg, baseDir)

    const files = globSync([pattern], {
      ...GLOB_OPTIONS,
      cwd: baseDir,
      ignore,
    })

    if (files.length === 0 && isGlobPattern(pkg)) {
      throw new Error(`Glob pattern matched no files: ${pkg}`)
    }

    allFiles.push(...files)
  }

  return allFiles
}
