/**
 * Identity configuration system for attest-it v2.0.
 * @packageDocumentation
 */

// Types
export type { PrivateKeyRef, Identity, LocalConfig } from './types.js'

// Config functions
export {
  getLocalConfigPath,
  getAttestItConfigDir,
  setAttestItHomeDir,
  getAttestItHomeDir,
  loadLocalConfig,
  loadLocalConfigSync,
  saveLocalConfig,
  saveLocalConfigSync,
  getActiveIdentity,
  LocalConfigValidationError,
} from './config.js'
