/**
 * Split configuration schema exports for attest-it.
 *
 * This module provides separate schemas for policy (security-critical)
 * and operational (non-security-critical) configuration files.
 *
 * @module
 */

// Policy configuration
export type { PolicyConfig } from './policy-schema.js'
export { PolicyValidationError, parsePolicyContent, policySchema } from './policy-schema.js'

// Operational configuration
export type { OperationalConfig } from './operational-schema.js'
export {
  OperationalValidationError,
  operationalSchema,
  parseOperationalContent,
  suiteSchema,
} from './operational-schema.js'

// Shared schemas
export {
  durationSchema,
  fingerprintConfigSchema,
  gateSchema,
  keyProviderOptionsSchema,
  keyProviderSchema,
  teamMemberSchema,
} from './shared-schemas.js'

// Configuration merging
export { mergeConfigs } from './merge.js'

// Cross-configuration validation
export type { ValidationError, ValidationErrorType } from './validation.js'
export { validateSuiteGateReferences } from './validation.js'
