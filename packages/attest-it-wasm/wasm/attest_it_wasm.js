/* @ts-self-types="./attest_it_wasm.d.ts" */

/**
 * WASM-exposed attest-it wrapper.
 */
class WasmAttestIt {
  static __wrap(ptr) {
    ptr = ptr >>> 0
    const obj = Object.create(WasmAttestIt.prototype)
    obj.__wbg_ptr = ptr
    WasmAttestItFinalization.register(obj, obj.__wbg_ptr, obj)
    return obj
  }
  __destroy_into_raw() {
    const ptr = this.__wbg_ptr
    this.__wbg_ptr = 0
    WasmAttestItFinalization.unregister(this)
    return ptr
  }
  free() {
    const ptr = this.__destroy_into_raw()
    wasm.__wbg_wasmattestit_free(ptr, 0)
  }
  /**
   * Compute a content fingerprint.
   * @param {string} options_json
   * @returns {Promise<any>}
   */
  computeFingerprint(options_json) {
    const ptr0 = passStringToWasm0(options_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc)
    const len0 = WASM_VECTOR_LEN
    const ret = wasm.wasmattestit_computeFingerprint(this.__wbg_ptr, ptr0, len0)
    return ret
  }
  /**
   * Create a seal by signing via the host platform.
   * @param {string} gate_id
   * @param {string} fingerprint
   * @param {string} sealed_by
   * @returns {Promise<any>}
   */
  createSeal(gate_id, fingerprint, sealed_by) {
    const ptr0 = passStringToWasm0(gate_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc)
    const len0 = WASM_VECTOR_LEN
    const ptr1 = passStringToWasm0(fingerprint, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc)
    const len1 = WASM_VECTOR_LEN
    const ptr2 = passStringToWasm0(sealed_by, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc)
    const len2 = WASM_VECTOR_LEN
    const ret = wasm.wasmattestit_createSeal(this.__wbg_ptr, ptr0, len0, ptr1, len1, ptr2, len2)
    return ret
  }
  /**
   * Check if a public key belongs to an authorized signer for a gate.
   * @param {string} config_json
   * @param {string} gate_id
   * @param {string} public_key
   * @returns {boolean}
   */
  isAuthorizedSigner(config_json, gate_id, public_key) {
    const ptr0 = passStringToWasm0(config_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc)
    const len0 = WASM_VECTOR_LEN
    const ptr1 = passStringToWasm0(gate_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc)
    const len1 = WASM_VECTOR_LEN
    const ptr2 = passStringToWasm0(public_key, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc)
    const len2 = WASM_VECTOR_LEN
    const ret = wasm.wasmattestit_isAuthorizedSigner(
      this.__wbg_ptr,
      ptr0,
      len0,
      ptr1,
      len1,
      ptr2,
      len2,
    )
    if (ret[2]) {
      throw takeFromExternrefTable0(ret[1])
    }
    return ret[0] !== 0
  }
  /**
   * Merge policy and operational configs into a single runtime config.
   * @param {string} policy_json
   * @param {string} operational_json
   * @returns {any}
   */
  mergeConfigs(policy_json, operational_json) {
    const ptr0 = passStringToWasm0(policy_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc)
    const len0 = WASM_VECTOR_LEN
    const ptr1 = passStringToWasm0(
      operational_json,
      wasm.__wbindgen_malloc,
      wasm.__wbindgen_realloc,
    )
    const len1 = WASM_VECTOR_LEN
    const ret = wasm.wasmattestit_mergeConfigs(this.__wbg_ptr, ptr0, len0, ptr1, len1)
    if (ret[2]) {
      throw takeFromExternrefTable0(ret[1])
    }
    return takeFromExternrefTable0(ret[0])
  }
  /**
   * Parse an operational config from YAML or JSON content.
   * @param {string} content
   * @param {string} format
   * @returns {any}
   */
  parseOperationalConfig(content, format) {
    const ptr0 = passStringToWasm0(content, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc)
    const len0 = WASM_VECTOR_LEN
    const ptr1 = passStringToWasm0(format, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc)
    const len1 = WASM_VECTOR_LEN
    const ret = wasm.wasmattestit_parseOperationalConfig(this.__wbg_ptr, ptr0, len0, ptr1, len1)
    if (ret[2]) {
      throw takeFromExternrefTable0(ret[1])
    }
    return takeFromExternrefTable0(ret[0])
  }
  /**
   * Parse a policy config from YAML or JSON content.
   * @param {string} content
   * @param {string} format
   * @returns {any}
   */
  parsePolicyConfig(content, format) {
    const ptr0 = passStringToWasm0(content, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc)
    const len0 = WASM_VECTOR_LEN
    const ptr1 = passStringToWasm0(format, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc)
    const len1 = WASM_VECTOR_LEN
    const ret = wasm.wasmattestit_parsePolicyConfig(this.__wbg_ptr, ptr0, len0, ptr1, len1)
    if (ret[2]) {
      throw takeFromExternrefTable0(ret[1])
    }
    return takeFromExternrefTable0(ret[0])
  }
  /**
   * Validate cross-config consistency (suite→gate, signer references).
   *
   * Returns an array of validation errors (empty if valid).
   * @param {string} policy_json
   * @param {string} operational_json
   * @returns {any}
   */
  validateCrossConfig(policy_json, operational_json) {
    const ptr0 = passStringToWasm0(policy_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc)
    const len0 = WASM_VECTOR_LEN
    const ptr1 = passStringToWasm0(
      operational_json,
      wasm.__wbindgen_malloc,
      wasm.__wbindgen_realloc,
    )
    const len1 = WASM_VECTOR_LEN
    const ret = wasm.wasmattestit_validateCrossConfig(this.__wbg_ptr, ptr0, len0, ptr1, len1)
    if (ret[2]) {
      throw takeFromExternrefTable0(ret[1])
    }
    return takeFromExternrefTable0(ret[0])
  }
  /**
   * Verify all gate seals in bulk.
   * @param {string} config_json
   * @param {string} seals_json
   * @param {string} fingerprints_json
   * @param {number} now_ms
   * @returns {any}
   */
  verifyAllSeals(config_json, seals_json, fingerprints_json, now_ms) {
    const ptr0 = passStringToWasm0(config_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc)
    const len0 = WASM_VECTOR_LEN
    const ptr1 = passStringToWasm0(seals_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc)
    const len1 = WASM_VECTOR_LEN
    const ptr2 = passStringToWasm0(
      fingerprints_json,
      wasm.__wbindgen_malloc,
      wasm.__wbindgen_realloc,
    )
    const len2 = WASM_VECTOR_LEN
    const ret = wasm.wasmattestit_verifyAllSeals(
      this.__wbg_ptr,
      ptr0,
      len0,
      ptr1,
      len1,
      ptr2,
      len2,
      now_ms,
    )
    if (ret[2]) {
      throw takeFromExternrefTable0(ret[1])
    }
    return takeFromExternrefTable0(ret[0])
  }
  /**
   * Verify a single gate's seal.
   * @param {string} config_json
   * @param {string} gate_id
   * @param {string} seals_json
   * @param {string} current_fingerprint
   * @param {number} now_ms
   * @returns {any}
   */
  verifyGateSeal(config_json, gate_id, seals_json, current_fingerprint, now_ms) {
    const ptr0 = passStringToWasm0(config_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc)
    const len0 = WASM_VECTOR_LEN
    const ptr1 = passStringToWasm0(gate_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc)
    const len1 = WASM_VECTOR_LEN
    const ptr2 = passStringToWasm0(seals_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc)
    const len2 = WASM_VECTOR_LEN
    const ptr3 = passStringToWasm0(
      current_fingerprint,
      wasm.__wbindgen_malloc,
      wasm.__wbindgen_realloc,
    )
    const len3 = WASM_VECTOR_LEN
    const ret = wasm.wasmattestit_verifyGateSeal(
      this.__wbg_ptr,
      ptr0,
      len0,
      ptr1,
      len1,
      ptr2,
      len2,
      ptr3,
      len3,
      now_ms,
    )
    if (ret[2]) {
      throw takeFromExternrefTable0(ret[1])
    }
    return takeFromExternrefTable0(ret[0])
  }
}
if (Symbol.dispose) WasmAttestIt.prototype[Symbol.dispose] = WasmAttestIt.prototype.free
exports.WasmAttestIt = WasmAttestIt

/**
 * Factory function to create a WasmAttestIt.
 * @param {any} host
 * @returns {WasmAttestIt}
 */
function createAttestIt(host) {
  const ret = wasm.createAttestIt(host)
  if (ret[2]) {
    throw takeFromExternrefTable0(ret[1])
  }
  return WasmAttestIt.__wrap(ret[0])
}
exports.createAttestIt = createAttestIt

/**
 * Initialize the WASM module. Called once on load.
 */
function init() {
  wasm.init()
}
exports.init = init

function __wbg_get_imports() {
  const import0 = {
    __proto__: null,
    __wbg_Error_83742b46f01ce22d: function (arg0, arg1) {
      const ret = Error(getStringFromWasm0(arg0, arg1))
      return ret
    },
    __wbg___wbindgen_boolean_get_c0f3f60bac5a78d1: function (arg0) {
      const v = arg0
      const ret = typeof v === 'boolean' ? v : undefined
      return isLikeNone(ret) ? 0xffffff : ret ? 1 : 0
    },
    __wbg___wbindgen_debug_string_5398f5bb970e0daa: function (arg0, arg1) {
      const ret = debugString(arg1)
      const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc)
      const len1 = WASM_VECTOR_LEN
      getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true)
      getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true)
    },
    __wbg___wbindgen_is_function_3c846841762788c1: function (arg0) {
      const ret = typeof arg0 === 'function'
      return ret
    },
    __wbg___wbindgen_is_undefined_52709e72fb9f179c: function (arg0) {
      const ret = arg0 === undefined
      return ret
    },
    __wbg___wbindgen_string_get_395e606bd0ee4427: function (arg0, arg1) {
      const obj = arg1
      const ret = typeof obj === 'string' ? obj : undefined
      var ptr1 = isLikeNone(ret)
        ? 0
        : passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc)
      var len1 = WASM_VECTOR_LEN
      getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true)
      getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true)
    },
    __wbg___wbindgen_throw_6ddd609b62940d55: function (arg0, arg1) {
      throw new Error(getStringFromWasm0(arg0, arg1))
    },
    __wbg__wbg_cb_unref_6b5b6b8576d35cb1: function (arg0) {
      arg0._wbg_cb_unref()
    },
    __wbg_call_2d781c1f4d5c0ef8: function () {
      return handleError(function (arg0, arg1, arg2) {
        const ret = arg0.call(arg1, arg2)
        return ret
      }, arguments)
    },
    __wbg_call_dcc2662fa17a72cf: function () {
      return handleError(function (arg0, arg1, arg2, arg3) {
        const ret = arg0.call(arg1, arg2, arg3)
        return ret
      }, arguments)
    },
    __wbg_call_e133b57c9155d22c: function () {
      return handleError(function (arg0, arg1) {
        const ret = arg0.call(arg1)
        return ret
      }, arguments)
    },
    __wbg_call_f858478a02f9600f: function () {
      return handleError(function (arg0, arg1, arg2, arg3, arg4) {
        const ret = arg0.call(arg1, arg2, arg3, arg4)
        return ret
      }, arguments)
    },
    __wbg_error_a6fa202b58aa1cd3: function (arg0, arg1) {
      let deferred0_0
      let deferred0_1
      try {
        deferred0_0 = arg0
        deferred0_1 = arg1
        console.error(getStringFromWasm0(arg0, arg1))
      } finally {
        wasm.__wbindgen_free(deferred0_0, deferred0_1, 1)
      }
    },
    __wbg_from_4bdf88943703fd48: function (arg0) {
      const ret = Array.from(arg0)
      return ret
    },
    __wbg_get_3ef1eba1850ade27: function () {
      return handleError(function (arg0, arg1) {
        const ret = Reflect.get(arg0, arg1)
        return ret
      }, arguments)
    },
    __wbg_get_a8ee5c45dabc1b3b: function (arg0, arg1) {
      const ret = arg0[arg1 >>> 0]
      return ret
    },
    __wbg_length_b3416cf66a5452c8: function (arg0) {
      const ret = arg0.length
      return ret
    },
    __wbg_length_ea16607d7b61445b: function (arg0) {
      const ret = arg0.length
      return ret
    },
    __wbg_new_227d7c05414eb861: function () {
      const ret = new Error()
      return ret
    },
    __wbg_new_5f486cdf45a04d78: function (arg0) {
      const ret = new Uint8Array(arg0)
      return ret
    },
    __wbg_new_a70fbab9066b301f: function () {
      const ret = new Array()
      return ret
    },
    __wbg_new_typed_aaaeaf29cf802876: function (arg0, arg1) {
      try {
        var state0 = { a: arg0, b: arg1 }
        var cb0 = (arg0, arg1) => {
          const a = state0.a
          state0.a = 0
          try {
            return wasm_bindgen__convert__closures_____invoke__h193d137bdc45699a(
              a,
              state0.b,
              arg0,
              arg1,
            )
          } finally {
            state0.a = a
          }
        }
        const ret = new Promise(cb0)
        return ret
      } finally {
        state0.a = state0.b = 0
      }
    },
    __wbg_new_with_length_825018a1616e9e55: function (arg0) {
      const ret = new Uint8Array(arg0 >>> 0)
      return ret
    },
    __wbg_parse_e9eddd2a82c706eb: function () {
      return handleError(function (arg0, arg1) {
        const ret = JSON.parse(getStringFromWasm0(arg0, arg1))
        return ret
      }, arguments)
    },
    __wbg_prototypesetcall_d62e5099504357e6: function (arg0, arg1, arg2) {
      Uint8Array.prototype.set.call(getArrayU8FromWasm0(arg0, arg1), arg2)
    },
    __wbg_push_e87b0e732085a946: function (arg0, arg1) {
      const ret = arg0.push(arg1)
      return ret
    },
    __wbg_queueMicrotask_0c399741342fb10f: function (arg0) {
      const ret = arg0.queueMicrotask
      return ret
    },
    __wbg_queueMicrotask_a082d78ce798393e: function (arg0) {
      queueMicrotask(arg0)
    },
    __wbg_resolve_ae8d83246e5bcc12: function (arg0) {
      const ret = Promise.resolve(arg0)
      return ret
    },
    __wbg_set_8c0b3ffcf05d61c2: function (arg0, arg1, arg2) {
      arg0.set(getArrayU8FromWasm0(arg1, arg2))
    },
    __wbg_stack_3b0d974bbf31e44f: function (arg0, arg1) {
      const ret = arg1.stack
      const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc)
      const len1 = WASM_VECTOR_LEN
      getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true)
      getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true)
    },
    __wbg_static_accessor_GLOBAL_8adb955bd33fac2f: function () {
      const ret = typeof global === 'undefined' ? null : global
      return isLikeNone(ret) ? 0 : addToExternrefTable0(ret)
    },
    __wbg_static_accessor_GLOBAL_THIS_ad356e0db91c7913: function () {
      const ret = typeof globalThis === 'undefined' ? null : globalThis
      return isLikeNone(ret) ? 0 : addToExternrefTable0(ret)
    },
    __wbg_static_accessor_SELF_f207c857566db248: function () {
      const ret = typeof self === 'undefined' ? null : self
      return isLikeNone(ret) ? 0 : addToExternrefTable0(ret)
    },
    __wbg_static_accessor_WINDOW_bb9f1ba69d61b386: function () {
      const ret = typeof window === 'undefined' ? null : window
      return isLikeNone(ret) ? 0 : addToExternrefTable0(ret)
    },
    __wbg_then_098abe61755d12f6: function (arg0, arg1) {
      const ret = arg0.then(arg1)
      return ret
    },
    __wbg_then_9e335f6dd892bc11: function (arg0, arg1, arg2) {
      const ret = arg0.then(arg1, arg2)
      return ret
    },
    __wbindgen_cast_0000000000000001: function (arg0, arg1) {
      // Cast intrinsic for `Closure(Closure { dtor_idx: 168, function: Function { arguments: [Externref], shim_idx: 169, ret: Result(Unit), inner_ret: Some(Result(Unit)) }, mutable: true }) -> Externref`.
      const ret = makeMutClosure(
        arg0,
        arg1,
        wasm.wasm_bindgen__closure__destroy__hb45b502f8e96f14b,
        wasm_bindgen__convert__closures_____invoke__h23c21a968c6f5c30,
      )
      return ret
    },
    __wbindgen_cast_0000000000000002: function (arg0, arg1) {
      // Cast intrinsic for `Ref(String) -> Externref`.
      const ret = getStringFromWasm0(arg0, arg1)
      return ret
    },
    __wbindgen_init_externref_table: function () {
      const table = wasm.__wbindgen_externrefs
      const offset = table.grow(4)
      table.set(0, undefined)
      table.set(offset + 0, undefined)
      table.set(offset + 1, null)
      table.set(offset + 2, true)
      table.set(offset + 3, false)
    },
  }
  return {
    __proto__: null,
    './attest_it_wasm_bg.js': import0,
  }
}

function wasm_bindgen__convert__closures_____invoke__h23c21a968c6f5c30(arg0, arg1, arg2) {
  const ret = wasm.wasm_bindgen__convert__closures_____invoke__h23c21a968c6f5c30(arg0, arg1, arg2)
  if (ret[1]) {
    throw takeFromExternrefTable0(ret[0])
  }
}

function wasm_bindgen__convert__closures_____invoke__h193d137bdc45699a(arg0, arg1, arg2, arg3) {
  wasm.wasm_bindgen__convert__closures_____invoke__h193d137bdc45699a(arg0, arg1, arg2, arg3)
}

const WasmAttestItFinalization =
  typeof FinalizationRegistry === 'undefined'
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry((ptr) => wasm.__wbg_wasmattestit_free(ptr >>> 0, 1))

function addToExternrefTable0(obj) {
  const idx = wasm.__externref_table_alloc()
  wasm.__wbindgen_externrefs.set(idx, obj)
  return idx
}

const CLOSURE_DTORS =
  typeof FinalizationRegistry === 'undefined'
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry((state) => state.dtor(state.a, state.b))

function debugString(val) {
  // primitive types
  const type = typeof val
  if (type == 'number' || type == 'boolean' || val == null) {
    return `${val}`
  }
  if (type == 'string') {
    return `"${val}"`
  }
  if (type == 'symbol') {
    const description = val.description
    if (description == null) {
      return 'Symbol'
    } else {
      return `Symbol(${description})`
    }
  }
  if (type == 'function') {
    const name = val.name
    if (typeof name == 'string' && name.length > 0) {
      return `Function(${name})`
    } else {
      return 'Function'
    }
  }
  // objects
  if (Array.isArray(val)) {
    const length = val.length
    let debug = '['
    if (length > 0) {
      debug += debugString(val[0])
    }
    for (let i = 1; i < length; i++) {
      debug += ', ' + debugString(val[i])
    }
    debug += ']'
    return debug
  }
  // Test for built-in
  const builtInMatches = /\[object ([^\]]+)\]/.exec(toString.call(val))
  let className
  if (builtInMatches && builtInMatches.length > 1) {
    className = builtInMatches[1]
  } else {
    // Failed to match the standard '[object ClassName]'
    return toString.call(val)
  }
  if (className == 'Object') {
    // we're a user defined class or Object
    // JSON.stringify avoids problems with cycles, and is generally much
    // easier than looping through ownProperties of `val`.
    try {
      return 'Object(' + JSON.stringify(val) + ')'
    } catch (_) {
      return 'Object'
    }
  }
  // errors
  if (val instanceof Error) {
    return `${val.name}: ${val.message}\n${val.stack}`
  }
  // TODO we could test for more things here, like `Set`s and `Map`s.
  return className
}

function getArrayU8FromWasm0(ptr, len) {
  ptr = ptr >>> 0
  return getUint8ArrayMemory0().subarray(ptr / 1, ptr / 1 + len)
}

let cachedDataViewMemory0 = null
function getDataViewMemory0() {
  if (
    cachedDataViewMemory0 === null ||
    cachedDataViewMemory0.buffer.detached === true ||
    (cachedDataViewMemory0.buffer.detached === undefined &&
      cachedDataViewMemory0.buffer !== wasm.memory.buffer)
  ) {
    cachedDataViewMemory0 = new DataView(wasm.memory.buffer)
  }
  return cachedDataViewMemory0
}

function getStringFromWasm0(ptr, len) {
  ptr = ptr >>> 0
  return decodeText(ptr, len)
}

let cachedUint8ArrayMemory0 = null
function getUint8ArrayMemory0() {
  if (cachedUint8ArrayMemory0 === null || cachedUint8ArrayMemory0.byteLength === 0) {
    cachedUint8ArrayMemory0 = new Uint8Array(wasm.memory.buffer)
  }
  return cachedUint8ArrayMemory0
}

function handleError(f, args) {
  try {
    return f.apply(this, args)
  } catch (e) {
    const idx = addToExternrefTable0(e)
    wasm.__wbindgen_exn_store(idx)
  }
}

function isLikeNone(x) {
  return x === undefined || x === null
}

function makeMutClosure(arg0, arg1, dtor, f) {
  const state = { a: arg0, b: arg1, cnt: 1, dtor }
  const real = (...args) => {
    // First up with a closure we increment the internal reference
    // count. This ensures that the Rust closure environment won't
    // be deallocated while we're invoking it.
    state.cnt++
    const a = state.a
    state.a = 0
    try {
      return f(a, state.b, ...args)
    } finally {
      state.a = a
      real._wbg_cb_unref()
    }
  }
  real._wbg_cb_unref = () => {
    if (--state.cnt === 0) {
      state.dtor(state.a, state.b)
      state.a = 0
      CLOSURE_DTORS.unregister(state)
    }
  }
  CLOSURE_DTORS.register(real, state, state)
  return real
}

function passStringToWasm0(arg, malloc, realloc) {
  if (realloc === undefined) {
    const buf = cachedTextEncoder.encode(arg)
    const ptr = malloc(buf.length, 1) >>> 0
    getUint8ArrayMemory0()
      .subarray(ptr, ptr + buf.length)
      .set(buf)
    WASM_VECTOR_LEN = buf.length
    return ptr
  }

  let len = arg.length
  let ptr = malloc(len, 1) >>> 0

  const mem = getUint8ArrayMemory0()

  let offset = 0

  for (; offset < len; offset++) {
    const code = arg.charCodeAt(offset)
    if (code > 0x7f) break
    mem[ptr + offset] = code
  }
  if (offset !== len) {
    if (offset !== 0) {
      arg = arg.slice(offset)
    }
    ptr = realloc(ptr, len, (len = offset + arg.length * 3), 1) >>> 0
    const view = getUint8ArrayMemory0().subarray(ptr + offset, ptr + len)
    const ret = cachedTextEncoder.encodeInto(arg, view)

    offset += ret.written
    ptr = realloc(ptr, len, offset, 1) >>> 0
  }

  WASM_VECTOR_LEN = offset
  return ptr
}

function takeFromExternrefTable0(idx) {
  const value = wasm.__wbindgen_externrefs.get(idx)
  wasm.__externref_table_dealloc(idx)
  return value
}

let cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true })
cachedTextDecoder.decode()
function decodeText(ptr, len) {
  return cachedTextDecoder.decode(getUint8ArrayMemory0().subarray(ptr, ptr + len))
}

const cachedTextEncoder = new TextEncoder()

if (!('encodeInto' in cachedTextEncoder)) {
  cachedTextEncoder.encodeInto = function (arg, view) {
    const buf = cachedTextEncoder.encode(arg)
    view.set(buf)
    return {
      read: arg.length,
      written: buf.length,
    }
  }
}

let WASM_VECTOR_LEN = 0

const wasmPath = `${__dirname}/attest_it_wasm_bg.wasm`
const wasmBytes = require('fs').readFileSync(wasmPath)
const wasmModule = new WebAssembly.Module(wasmBytes)
let wasm = new WebAssembly.Instance(wasmModule, __wbg_get_imports()).exports
wasm.__wbindgen_start()
