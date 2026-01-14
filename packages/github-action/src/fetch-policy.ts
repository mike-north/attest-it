import * as github from '@actions/github'

/**
 * Options for fetching policy content from GitHub.
 */
export interface FetchPolicyOptions {
  /** GitHub API token with repo read permissions */
  token: string
  /** Repository owner (organization or user) */
  owner: string
  /** Repository name */
  repo: string
  /** Git reference (branch name or commit SHA) to fetch from */
  ref: string
  /** Path to the policy file within the repository */
  path: string
}

/**
 * Result of fetching policy content.
 */
export interface FetchPolicyResult {
  /** The decoded policy file content */
  content: string
  /** The git SHA of the fetched file */
  sha: string
}

/**
 * Fetch policy.yaml content from a specific git ref using GitHub API.
 *
 * This function retrieves the policy file from a specific branch or commit,
 * which is critical for the security model: PRs must be validated against
 * the policy from the base branch, not their own potentially modified version.
 *
 * @param options - Configuration for fetching the policy
 * @returns The policy content and its git SHA
 * @throws {Error} If the file doesn't exist, is a directory, or has no content
 *
 * @example
 * ```typescript
 * const policy = await fetchPolicyFromRef({
 *   token: process.env.GITHUB_TOKEN,
 *   owner: 'my-org',
 *   repo: 'my-repo',
 *   ref: 'main',
 *   path: '.github/policy.yaml'
 * });
 * console.log(policy.content);
 * ```
 */
export async function fetchPolicyFromRef(options: FetchPolicyOptions): Promise<FetchPolicyResult> {
  const octokit = github.getOctokit(options.token)

  const { data } = await octokit.rest.repos.getContent({
    owner: options.owner,
    repo: options.repo,
    path: options.path,
    ref: options.ref,
  })

  // Handle file content (not directory)
  if (Array.isArray(data) || data.type !== 'file') {
    throw new Error(`Expected ${options.path} to be a file, not a directory`)
  }

  if (!('content' in data) || !data.content) {
    throw new Error(`No content found in ${options.path}`)
  }

  return {
    content: Buffer.from(data.content, 'base64').toString('utf8'),
    sha: data.sha,
  }
}

/**
 * Get repository information from GitHub Actions environment variables.
 *
 * Parses the GITHUB_REPOSITORY environment variable (format: "owner/repo")
 * to extract owner and repository name.
 *
 * @returns Object containing owner and repo strings
 * @throws {Error} If GITHUB_REPOSITORY is not set or has invalid format
 *
 * @example
 * ```typescript
 * // In GitHub Actions: GITHUB_REPOSITORY="octocat/Hello-World"
 * const { owner, repo } = getRepoInfo();
 * // owner: "octocat", repo: "Hello-World"
 * ```
 */
export function getRepoInfo(): { owner: string; repo: string } {
  const repository = process.env.GITHUB_REPOSITORY
  if (!repository) {
    throw new Error('GITHUB_REPOSITORY environment variable not set')
  }

  const slashIndex = repository.indexOf('/')
  if (slashIndex === -1) {
    throw new Error(`Invalid GITHUB_REPOSITORY format: ${repository}`)
  }

  const owner = repository.slice(0, slashIndex)
  const repo = repository.slice(slashIndex + 1)

  if (!owner || !repo) {
    throw new Error(`Invalid GITHUB_REPOSITORY format: ${repository}`)
  }

  return { owner, repo }
}

/**
 * Get the base ref for policy fetching.
 *
 * For pull request events, this returns the base branch (target branch).
 * For push events, this returns undefined (policy should be read from local file).
 *
 * The base branch is where the PR will be merged into, and represents the
 * trusted policy that must be enforced.
 *
 * @returns The base branch name for PRs, or undefined for non-PR events
 *
 * @example
 * ```typescript
 * // In a PR targeting main:
 * const base = getBaseBranch();
 * // base: "main"
 *
 * // In a push to a branch:
 * const base = getBaseBranch();
 * // base: undefined
 * ```
 */
export function getBaseBranch(): string | undefined {
  // GITHUB_BASE_REF is set for pull_request events
  // Empty string is treated as undefined (unset)
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- intentionally treat empty string as falsy
  return process.env.GITHUB_BASE_REF || undefined
}

/**
 * Check if we're running in a pull request context.
 *
 * This determines whether we need to fetch the policy from the base branch
 * (PR context) or can use the local file (push context).
 *
 * @returns true if running in a pull request, false otherwise
 *
 * @example
 * ```typescript
 * if (isPullRequest()) {
 *   // Fetch policy from base branch
 *   const baseBranch = getBaseBranch();
 *   policy = await fetchPolicyFromRef({ ..., ref: baseBranch });
 * } else {
 *   // Use local policy file
 *   policy = await fs.readFile('.github/policy.yaml', 'utf8');
 * }
 * ```
 */
export function isPullRequest(): boolean {
  return !!process.env.GITHUB_BASE_REF
}
