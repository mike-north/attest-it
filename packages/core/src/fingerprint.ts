import * as crypto from 'node:crypto'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { glob, globSync } from 'tinyglobby'

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
  /** Package directories to include */
  packages: string[]
  /** Glob patterns to exclude from fingerprint */
  ignore?: string[]
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
      hash.update('\0')

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
  hash.update('\0')
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
  hash.update('\0')
  hash.update(content)
  return hash.digest()
}

/**
 * Validate fingerprint options and return base directory.
 */
function validateOptions(options: FingerprintOptions): string {
  if (options.packages.length === 0) {
    throw new Error('packages array must not be empty')
  }

  const baseDir = options.baseDir ?? process.cwd()

  // Verify all package paths exist
  for (const pkg of options.packages) {
    const pkgPath = path.resolve(baseDir, pkg)
    if (!fs.existsSync(pkgPath)) {
      throw new Error(`Package path does not exist: ${pkgPath}`)
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
 * 3. For each file: compute SHA256(relativePath + "\0" + content)
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
  const baseDir = validateOptions(options)

  // List all files in packages
  const files = await listPackageFiles(options.packages, options.ignore, baseDir)

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
 * @param options - Configuration for fingerprint computation
 * @returns Result containing the fingerprint hash and list of files processed
 * @throws Error if packages array is empty or if package paths don't exist
 * @public
 * @see {@link computeFingerprint} for the async version
 */
export function computeFingerprintSync(options: FingerprintOptions): FingerprintResult {
  const baseDir = validateOptions(options)

  // List all files in packages (sync version)
  const files = listPackageFilesSync(options.packages, options.ignore, baseDir)

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
 * List files in packages, respecting ignore patterns (async).
 *
 * @param packages - Array of package directory paths
 * @param ignore - Optional glob patterns to exclude
 * @param baseDir - Base directory for resolving paths (defaults to cwd)
 * @returns Array of relative file paths
 * @public
 */
export async function listPackageFiles(
  packages: string[],
  ignore: string[] = [],
  baseDir: string = process.cwd(),
): Promise<string[]> {
  const allFiles: string[] = []

  for (const pkg of packages) {
    // Build glob patterns for this package
    const patterns = [`${pkg}/**/*`]

    // Use tinyglobby to find files
    const files = await glob(patterns, {
      cwd: baseDir,
      ignore,
      onlyFiles: true,
      dot: true, // Include dotfiles
      absolute: false, // Return relative paths
    })

    allFiles.push(...files)
  }

  return allFiles
}

/**
 * Synchronous version of listPackageFiles
 */
function listPackageFilesSync(
  packages: string[],
  ignore: string[] = [],
  baseDir: string = process.cwd(),
): string[] {
  const allFiles: string[] = []

  for (const pkg of packages) {
    // Build glob patterns for this package
    const patterns = [`${pkg}/**/*`]

    // Use tinyglobby to find files (sync version)
    const files = globSync(patterns, {
      cwd: baseDir,
      ignore,
      onlyFiles: true,
      dot: true, // Include dotfiles
      absolute: false, // Return relative paths
    })

    allFiles.push(...files)
  }

  return allFiles
}
