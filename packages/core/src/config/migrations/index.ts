/**
 * Versioned configuration migration infrastructure.
 *
 * This module provides migration graphs for all attest-it configuration files,
 * enabling schema validation and automatic migrations between versions.
 *
 * @packageDocumentation
 */

// Identity config
export {
  identityMigrationGraph,
  type IdentityConfigV1,
  localConfigSchemaV1,
} from './identity-graph.js'

// Seals file
export { sealsFileSchemaV1 } from './seals-graph.js'

// Policy config
export { policySchemaV1 } from './policy-graph.js'

// Operational config
export { operationalSchemaV1, suiteSchemaV1 } from './operational-graph.js'

// Sync adapter for identity config
export { loadVersionedFileSync } from './sync-adapter.js'
