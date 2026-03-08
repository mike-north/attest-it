/* tslint:disable */
/* eslint-disable */

/**
 * WASM-exposed attest-it wrapper.
 */
export class WasmAttestIt {
  private constructor()
  free(): void
  [Symbol.dispose](): void
  /**
   * Compute a content fingerprint.
   */
  computeFingerprint(options_json: string): Promise<any>
  /**
   * Create a seal by signing via the host platform.
   */
  createSeal(gate_id: string, fingerprint: string, sealed_by: string): Promise<any>
  /**
   * Check if a public key belongs to an authorized signer for a gate.
   */
  isAuthorizedSigner(config_json: string, gate_id: string, public_key: string): boolean
  /**
   * Merge policy and operational configs into a single runtime config.
   */
  mergeConfigs(policy_json: string, operational_json: string): any
  /**
   * Parse an operational config from YAML or JSON content.
   */
  parseOperationalConfig(content: string, format: string): any
  /**
   * Parse a policy config from YAML or JSON content.
   */
  parsePolicyConfig(content: string, format: string): any
  /**
   * Validate cross-config consistency (suite→gate, signer references).
   *
   * Returns an array of validation errors (empty if valid).
   */
  validateCrossConfig(policy_json: string, operational_json: string): any
  /**
   * Verify all gate seals in bulk.
   */
  verifyAllSeals(
    config_json: string,
    seals_json: string,
    fingerprints_json: string,
    now_ms: number,
  ): any
  /**
   * Verify a single gate's seal.
   */
  verifyGateSeal(
    config_json: string,
    gate_id: string,
    seals_json: string,
    current_fingerprint: string,
    now_ms: number,
  ): any
}

/**
 * Factory function to create a WasmAttestIt.
 */
export function createAttestIt(host: any): WasmAttestIt

/**
 * Initialize the WASM module. Called once on load.
 */
export function init(): void
