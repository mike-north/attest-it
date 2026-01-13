/**
 * Dependency resolution utilities for suite execution order.
 *
 * This module provides functions to validate and resolve suite dependencies
 * using topological sorting. When suites have `depends_on` configuration,
 * they must run in the correct order to ensure dependencies are satisfied.
 */

import type { Config } from '@attest-it/core'

/**
 * Error thrown when circular dependencies are detected.
 *
 * @public
 */
export class CircularDependencyError extends Error {
  constructor(public readonly cycle: string[]) {
    super(`Circular dependency detected: ${cycle.join(' -> ')}`)
    this.name = 'CircularDependencyError'
  }
}

/**
 * Validate that all dependencies reference valid suite names.
 * Throws if any suite references a non-existent dependency.
 *
 * @param config - The configuration object containing suite definitions
 * @throws {Error} If any suite references a non-existent dependency
 *
 * @public
 */
export function validateDependencies(config: Config): void {
  const suiteNames = new Set(Object.keys(config.suites))

  for (const [suiteName, suiteConfig] of Object.entries(config.suites)) {
    const dependencies = suiteConfig.depends_on ?? []

    for (const dependency of dependencies) {
      if (!suiteNames.has(dependency)) {
        throw new Error(`Suite "${suiteName}" depends on non-existent suite "${dependency}"`)
      }
    }
  }
}

/**
 * Get all direct and transitive dependencies for a suite.
 * Returns an array of suite names (not including the suite itself).
 *
 * @param suite - The name of the suite to get dependencies for
 * @param config - The configuration object containing suite definitions
 * @returns Array of suite names that the given suite depends on (directly or transitively)
 *
 * @example
 * ```typescript
 * // If A depends on B, B depends on C
 * getDependencies('A', config) // ['B', 'C']
 * ```
 *
 * @public
 */
export function getDependencies(suite: string, config: Config): string[] {
  const visited = new Set<string>()
  const visiting = new Set<string>() // For cycle detection
  const result: string[] = []

  function visit(currentSuite: string): void {
    if (visited.has(currentSuite)) {
      return
    }

    if (visiting.has(currentSuite)) {
      // Cycle detected - build the cycle path
      const cycle: string[] = [currentSuite]
      throw new CircularDependencyError(cycle)
    }

    visiting.add(currentSuite)

    // eslint-disable-next-line security/detect-object-injection -- Safe access with validated suite name
    const suiteConfig = config.suites[currentSuite]
    if (!suiteConfig) {
      throw new Error(`Suite "${currentSuite}" not found in configuration`)
    }

    const dependencies = suiteConfig.depends_on ?? []
    for (const dependency of dependencies) {
      try {
        visit(dependency)
      } catch (error) {
        if (error instanceof CircularDependencyError) {
          // Add current suite to the cycle path and re-throw
          error.cycle.push(currentSuite)
          throw error
        }
        throw error
      }
    }

    visiting.delete(currentSuite)
    visited.add(currentSuite)

    // Add to result if it's not the starting suite
    // DFS post-order gives us the correct dependency order (dependencies before dependents)
    if (currentSuite !== suite) {
      result.push(currentSuite)
    }
  }

  visit(suite)

  return result
}

/**
 * Sort suites in dependency order using topological sort (Kahn's algorithm).
 * Suites with no dependencies come first.
 *
 * @param suites - Array of suite names to sort
 * @param config - The configuration object containing suite definitions
 * @returns Sorted array of suite names in dependency order
 * @throws {CircularDependencyError} If a circular dependency is detected
 * @throws {Error} If any suite name is not found in the configuration
 *
 * @example
 * ```typescript
 * // If B depends on A, C depends on B
 * resolveDependencyOrder(['A', 'B', 'C'], config) // ['A', 'B', 'C']
 * resolveDependencyOrder(['C', 'A', 'B'], config) // ['A', 'B', 'C']
 * ```
 *
 * @public
 */
export function resolveDependencyOrder(suites: string[], config: Config): string[] {
  // Validate all suite names exist
  for (const suite of suites) {
    // eslint-disable-next-line security/detect-object-injection -- Safe access with validated suite name from config
    if (!config.suites[suite]) {
      throw new Error(`Suite "${suite}" not found in configuration`)
    }
  }

  // Build adjacency list (suite -> suites that depend on it)
  const graph = new Map<string, Set<string>>()
  const inDegree = new Map<string, number>()

  // Initialize graph for all suites in our list
  for (const suite of suites) {
    graph.set(suite, new Set())
    inDegree.set(suite, 0)
  }

  // Build the graph and calculate in-degrees
  for (const suite of suites) {
    // eslint-disable-next-line security/detect-object-injection -- Safe access with validated suite name from config
    const dependencies = config.suites[suite]?.depends_on ?? []

    for (const dependency of dependencies) {
      // Only consider dependencies that are in our list
      if (suites.includes(dependency)) {
        // Add edge: dependency -> suite
        graph.get(dependency)?.add(suite)
        // Increment in-degree of suite
        inDegree.set(suite, (inDegree.get(suite) ?? 0) + 1)
      }
    }
  }

  // Kahn's algorithm
  const result: string[] = []
  const queue: string[] = []

  // Start with nodes that have no dependencies
  for (const [suite, degree] of inDegree.entries()) {
    if (degree === 0) {
      queue.push(suite)
    }
  }

  while (queue.length > 0) {
    const current = queue.shift()
    if (current === undefined) {
      break
    }
    result.push(current)

    // Process all suites that depend on current
    const dependents = graph.get(current) ?? new Set()
    for (const dependent of dependents) {
      const newDegree = (inDegree.get(dependent) ?? 1) - 1
      inDegree.set(dependent, newDegree)

      if (newDegree === 0) {
        queue.push(dependent)
      }
    }
  }

  // If we haven't processed all suites, there's a cycle
  if (result.length !== suites.length) {
    // Find a node involved in the cycle for error reporting
    const remaining = suites.filter((s) => !result.includes(s))
    // Try to detect the cycle by doing DFS from the first remaining node
    if (remaining.length > 0 && remaining[0] !== undefined) {
      try {
        getDependencies(remaining[0], config)
      } catch (error) {
        if (error instanceof CircularDependencyError) {
          throw error
        }
      }
    }
    // Fallback error if we can't detect the specific cycle
    throw new CircularDependencyError(remaining)
  }

  return result
}

/**
 * Given a list of suites to run, expand to include any dependencies
 * that are not already in the list.
 *
 * @param suites - Array of suite names to expand
 * @param config - The configuration object containing suite definitions
 * @returns Array of suite names including all dependencies, in dependency order
 * @throws {CircularDependencyError} If a circular dependency is detected
 * @throws {Error} If any suite name is not found in the configuration
 *
 * @example
 * ```typescript
 * // If B depends on A
 * expandWithDependencies(['B'], config) // ['A', 'B']
 * ```
 *
 * @public
 */
export function expandWithDependencies(suites: string[], config: Config): string[] {
  const expanded = new Set<string>()

  for (const suite of suites) {
    // Add the suite itself
    expanded.add(suite)

    // Add all its dependencies
    const dependencies = getDependencies(suite, config)
    for (const dependency of dependencies) {
      expanded.add(dependency)
    }
  }

  // Return in dependency order
  return resolveDependencyOrder([...expanded], config)
}
