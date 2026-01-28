/**
 * Versioned configuration migration infrastructure.
 *
 * This module provides migration graphs for all attest-it configuration files,
 * enabling schema validation and automatic migrations between versions.
 *
 * @packageDocumentation
 */

// Migration graphs
export {
  identityMigrationGraph,
  type IdentityConfigV1,
  type IdentityConfigVersions,
  localConfigSchemaV1,
  identitySchemaV1,
  privateKeyRefSchemaV1,
} from './identity-graph.js'

export {
  sealsMigrationGraph,
  type SealsFileV1,
  type SealsFileVersions,
  sealsFileSchemaV1,
  sealSchemaV1,
} from './seals-graph.js'

export {
  policyMigrationGraph,
  type PolicyConfigV1,
  type PolicyConfigVersions,
  policySchemaV1,
  policySettingsSchemaV1,
} from './policy-graph.js'

export {
  operationalMigrationGraph,
  type OperationalConfigV1,
  type OperationalConfigVersions,
  operationalSchemaV1,
  operationalSettingsSchemaV1,
  suiteSchemaV1,
} from './operational-graph.js'

// Sync adapter for identity config
export {
  loadVersionedFileSync,
  saveVersionedFileSync,
  type LoadSyncOptions,
  type SaveSyncOptions,
  type LoadSyncResult,
} from './sync-adapter.js'
