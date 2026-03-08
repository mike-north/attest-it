/**
 * @attest-it/wasm
 *
 * WebAssembly-backed core for attest-it. Wraps the Rust core compiled
 * to WASM with a Node.js host platform bridge.
 *
 * @packageDocumentation
 */

export type {
  CrossConfigError,
  CrossConfigErrorType,
  FingerprintOptions,
  FingerprintResult,
  ResolvedFile,
  Seal,
  SealVerificationResult,
  SignResult,
  VerificationState,
  WasmHostPlatform,
} from './types.js'

export { createNodeHost } from './node-host.js'

// --- WASM bindings ---

type WasmBindings = typeof import('../wasm/attest_it_wasm.js')
type WasmAttestItInstance = Awaited<ReturnType<WasmBindings['createAttestIt']>>

let wasmBindings: WasmBindings | undefined

async function loadWasm(): Promise<WasmBindings> {
  wasmBindings ??= await import('../wasm/attest_it_wasm.js')
  return wasmBindings
}

/**
 * WASM-backed attest-it SDK.
 *
 * Use {@link AttestIt.create} to instantiate. The WASM module is
 * lazily loaded on first creation.
 */
export class AttestIt {
  #inner: WasmAttestItInstance

  private constructor(inner: WasmAttestItInstance) {
    this.#inner = inner
  }

  /**
   * Create a new AttestIt instance backed by WASM.
   *
   * @param host - Host platform implementation. Defaults to a Node.js host
   *   created by {@link createNodeHost}.
   */
  static async create(host?: import('./types.js').WasmHostPlatform): Promise<AttestIt> {
    const bindings = await loadWasm()
    const hostPlatform = host ?? (await import('./node-host.js')).createNodeHost()
    const inner = bindings.createAttestIt(hostPlatform)
    return new AttestIt(inner)
  }

  // --- Verification ---

  verifyGateSeal(
    configJson: string,
    gateId: string,
    sealsJson: string,
    currentFingerprint: string,
    nowMs: number,
  ): import('./types.js').SealVerificationResult {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return -- WASM boundary: wasm-bindgen returns untyped JsValue
    return this.#inner.verifyGateSeal(configJson, gateId, sealsJson, currentFingerprint, nowMs)
  }

  verifyAllSeals(
    configJson: string,
    sealsJson: string,
    fingerprintsJson: string,
    nowMs: number,
  ): import('./types.js').SealVerificationResult[] {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return -- WASM boundary: wasm-bindgen returns untyped JsValue
    return this.#inner.verifyAllSeals(configJson, sealsJson, fingerprintsJson, nowMs)
  }

  // --- Seal creation ---

  async createSeal(
    gateId: string,
    fingerprint: string,
    sealedBy: string,
  ): Promise<import('./types.js').Seal> {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return -- WASM boundary: wasm-bindgen returns untyped JsValue
    return this.#inner.createSeal(gateId, fingerprint, sealedBy)
  }

  // --- Fingerprinting ---

  async computeFingerprint(
    options: import('./types.js').FingerprintOptions,
  ): Promise<import('./types.js').FingerprintResult> {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return -- WASM boundary: wasm-bindgen returns untyped JsValue
    return this.#inner.computeFingerprint(JSON.stringify(options))
  }

  // --- Config parsing ---

  parsePolicyConfig(content: string, format: string): unknown {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return -- WASM boundary: wasm-bindgen returns untyped JsValue
    return this.#inner.parsePolicyConfig(content, format)
  }

  parseOperationalConfig(content: string, format: string): unknown {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return -- WASM boundary: wasm-bindgen returns untyped JsValue
    return this.#inner.parseOperationalConfig(content, format)
  }

  mergeConfigs(policyJson: string, operationalJson: string): unknown {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return -- WASM boundary: wasm-bindgen returns untyped JsValue
    return this.#inner.mergeConfigs(policyJson, operationalJson)
  }

  validateCrossConfig(
    policyJson: string,
    operationalJson: string,
  ): import('./types.js').CrossConfigError[] {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return -- WASM boundary: wasm-bindgen returns untyped JsValue
    return this.#inner.validateCrossConfig(policyJson, operationalJson)
  }

  // --- Authorization ---

  isAuthorizedSigner(configJson: string, gateId: string, publicKey: string): boolean {
    return this.#inner.isAuthorizedSigner(configJson, gateId, publicKey)
  }

  // --- Lifecycle ---

  dispose(): void {
    this.#inner.free()
  }
}
