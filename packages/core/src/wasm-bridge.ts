/**
 * Optional WASM backend bridge for attest-it core.
 *
 * Call {@link initWasm} to lazily load the WASM module and switch
 * verification, authorization, and config operations to the Rust
 * implementation. When WASM is not initialized, the existing
 * TypeScript implementations are used as fallback.
 *
 * ## Delegation contract
 *
 * Functions that support WASM delegation follow this pattern:
 *
 * 1. Call {@link getWasm} to check if the WASM instance is initialized.
 * 2. If defined, serialize TypeScript objects to JSON strings before
 *    passing them across the `wasm-bindgen` boundary (which does not
 *    support arbitrary JS object references from Rust).
 * 3. Pass `Date.now()` explicitly as `nowMs` where needed — the WASM
 *    module cannot call the host clock directly.
 * 4. If {@link getWasm} returns `undefined`, fall through to the
 *    TypeScript implementation unchanged.
 *
 * @packageDocumentation
 * @internal
 */

// Use `import type` to avoid eagerly loading the WASM module.
// The actual module is loaded dynamically in initWasm().
import type { AttestIt } from '@attest-it/wasm'

let wasmInstance: AttestIt | undefined

/**
 * Initialize the WASM backend.
 *
 * After calling this function, verification and authorization
 * functions in `@attest-it/core` will transparently delegate to
 * the Rust/WASM implementation instead of the TypeScript one.
 *
 * Safe to call multiple times — subsequent calls are no-ops.
 *
 * @public
 */
export async function initWasm(): Promise<void> {
  if (wasmInstance) return

  const { AttestIt: Cls, createNodeHost } = await import('@attest-it/wasm')
  wasmInstance = await Cls.create(createNodeHost())
}

/**
 * Get the WASM instance, if initialized.
 * Returns `undefined` when WASM has not been initialized via {@link initWasm}.
 * @internal
 */
export function getWasm(): AttestIt | undefined {
  return wasmInstance
}

/**
 * Tear down the WASM instance and free its resources.
 *
 * Calls `dispose()` on the underlying WASM instance to free linear
 * memory, then clears the module-level reference so {@link initWasm}
 * will reinitialize on the next call.
 *
 * Primarily useful for test teardown hooks (`afterAll`).
 * @public
 */
export function teardownWasm(): void {
  if (wasmInstance) {
    wasmInstance.dispose()
    wasmInstance = undefined
  }
}
