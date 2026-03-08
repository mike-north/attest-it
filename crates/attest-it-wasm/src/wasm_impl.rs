//! WASM bindings implementation — only compiled on wasm32.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use js_sys::{Array, Function, Promise, Reflect, Uint8Array};
use wasm_bindgen::prelude::*;
use wasm_bindgen_futures::JsFuture;

use attest_it_core::errors::AttestError;
use attest_it_core::host::HostPlatform;
use attest_it_core::types::{Platform, ResolvedFile, SignResult};

// ─── JsHostPlatform ──────────────────────────────────────────────

/// A `HostPlatform` implementation backed by JavaScript callbacks.
///
/// The JS object must implement:
/// - `readFile(path)` → `Promise<Uint8Array>`
/// - `writeFile(path, content)` → `Promise<void>`
/// - `fileExists(path)` → `Promise<boolean>`
/// - `createDirAll(path)` → `Promise<void>`
/// - `resolveGlobs(patterns, ignore, baseDir)` → `Promise<{relativePath, absolutePath}[]>`
/// - `signEd25519(data, signerId)` → `Promise<{signature, algorithm}>`
/// - `platform()` → `string` ("darwin"|"linux"|"win32")
/// - `nowUtc()` → `string` (ISO 8601)
struct JsHostPlatform {
    host: JsValue,
    platform: Platform,
}

// SAFETY: In single-threaded WASM, JsValue is never accessed from multiple threads.
unsafe impl Send for JsHostPlatform {}
unsafe impl Sync for JsHostPlatform {}

impl JsHostPlatform {
    fn new(host: JsValue) -> Result<Self, JsError> {
        let platform_fn = get_method(&host, "platform")?;
        let platform_str = platform_fn
            .call0(&host)
            .map_err(|e| JsError::new(&format!("platform() failed: {e:?}")))?;
        let platform_str = platform_str
            .as_string()
            .ok_or_else(|| JsError::new("platform() must return a string"))?;
        let platform = match platform_str.as_str() {
            "darwin" => Platform::Darwin,
            "linux" => Platform::Linux,
            "win32" => Platform::Win32,
            other => return Err(JsError::new(&format!("Unknown platform: {other}"))),
        };

        Ok(Self { host, platform })
    }
}

fn get_method(obj: &JsValue, name: &str) -> Result<Function, JsError> {
    let val = Reflect::get(obj, &JsValue::from_str(name))
        .map_err(|_| JsError::new(&format!("Missing method: {name}")))?;
    val.dyn_into::<Function>()
        .map_err(|_| JsError::new(&format!("{name} is not a function")))
}

fn attest_err(msg: &str) -> AttestError {
    AttestError::Other(msg.to_string())
}

#[async_trait::async_trait(?Send)]
impl HostPlatform for JsHostPlatform {
    async fn read_file(&self, path: &Path) -> Result<Vec<u8>, AttestError> {
        let read_fn =
            get_method(&self.host, "readFile").map_err(|e| attest_err(&format!("{e:?}")))?;

        let js_path = JsValue::from_str(&path.to_string_lossy());
        let promise = read_fn
            .call1(&self.host, &js_path)
            .map_err(|e| attest_err(&format!("readFile() call failed: {e:?}")))?;

        let result = JsFuture::from(Promise::from(promise))
            .await
            .map_err(|e| attest_err(&format!("readFile() rejected: {e:?}")))?;

        Ok(Uint8Array::new(&result).to_vec())
    }

    async fn write_file(&self, path: &Path, content: &[u8]) -> Result<(), AttestError> {
        let write_fn =
            get_method(&self.host, "writeFile").map_err(|e| attest_err(&format!("{e:?}")))?;

        let js_path = JsValue::from_str(&path.to_string_lossy());
        let js_content = Uint8Array::new_with_length(content.len() as u32);
        js_content.copy_from(content);

        let promise = write_fn
            .call2(&self.host, &js_path, &js_content.into())
            .map_err(|e| attest_err(&format!("writeFile() call failed: {e:?}")))?;

        JsFuture::from(Promise::from(promise))
            .await
            .map_err(|e| attest_err(&format!("writeFile() rejected: {e:?}")))?;

        Ok(())
    }

    async fn file_exists(&self, path: &Path) -> Result<bool, AttestError> {
        let exists_fn =
            get_method(&self.host, "fileExists").map_err(|e| attest_err(&format!("{e:?}")))?;

        let js_path = JsValue::from_str(&path.to_string_lossy());
        let promise = exists_fn
            .call1(&self.host, &js_path)
            .map_err(|e| attest_err(&format!("fileExists() call failed: {e:?}")))?;

        let result = JsFuture::from(Promise::from(promise))
            .await
            .map_err(|e| attest_err(&format!("fileExists() rejected: {e:?}")))?;

        Ok(result.as_bool().unwrap_or(false))
    }

    async fn create_dir_all(&self, path: &Path) -> Result<(), AttestError> {
        let mkdir_fn =
            get_method(&self.host, "createDirAll").map_err(|e| attest_err(&format!("{e:?}")))?;

        let js_path = JsValue::from_str(&path.to_string_lossy());
        let promise = mkdir_fn
            .call1(&self.host, &js_path)
            .map_err(|e| attest_err(&format!("createDirAll() call failed: {e:?}")))?;

        JsFuture::from(Promise::from(promise))
            .await
            .map_err(|e| attest_err(&format!("createDirAll() rejected: {e:?}")))?;

        Ok(())
    }

    async fn resolve_globs(
        &self,
        patterns: &[String],
        ignore: &[String],
        base_dir: &Path,
    ) -> Result<Vec<ResolvedFile>, AttestError> {
        let resolve_fn =
            get_method(&self.host, "resolveGlobs").map_err(|e| attest_err(&format!("{e:?}")))?;

        let js_patterns = Array::new();
        for p in patterns {
            js_patterns.push(&JsValue::from_str(p));
        }
        let js_ignore = Array::new();
        for i in ignore {
            js_ignore.push(&JsValue::from_str(i));
        }
        let js_base_dir = JsValue::from_str(&base_dir.to_string_lossy());

        let promise = resolve_fn
            .call3(
                &self.host,
                &js_patterns.into(),
                &js_ignore.into(),
                &js_base_dir,
            )
            .map_err(|e| attest_err(&format!("resolveGlobs() call failed: {e:?}")))?;

        let result = JsFuture::from(Promise::from(promise))
            .await
            .map_err(|e| attest_err(&format!("resolveGlobs() rejected: {e:?}")))?;

        let arr = Array::from(&result);
        let mut files = Vec::new();
        for i in 0..arr.length() {
            let item = arr.get(i);
            let relative_path = Reflect::get(&item, &JsValue::from_str("relativePath"))
                .ok()
                .and_then(|v| v.as_string())
                .unwrap_or_default();
            let absolute_path = Reflect::get(&item, &JsValue::from_str("absolutePath"))
                .ok()
                .and_then(|v| v.as_string())
                .map(PathBuf::from)
                .unwrap_or_default();
            files.push(ResolvedFile {
                relative_path,
                absolute_path,
            });
        }
        Ok(files)
    }

    async fn sign_ed25519(&self, data: &[u8], signer_id: &str) -> Result<SignResult, AttestError> {
        let sign_fn =
            get_method(&self.host, "signEd25519").map_err(|e| attest_err(&format!("{e:?}")))?;

        let js_data = Uint8Array::new_with_length(data.len() as u32);
        js_data.copy_from(data);
        let js_signer_id = JsValue::from_str(signer_id);

        let promise = sign_fn
            .call2(&self.host, &js_data.into(), &js_signer_id)
            .map_err(|e| attest_err(&format!("signEd25519() call failed: {e:?}")))?;

        let result = JsFuture::from(Promise::from(promise))
            .await
            .map_err(|e| attest_err(&format!("signEd25519() rejected: {e:?}")))?;

        let signature = Reflect::get(&result, &JsValue::from_str("signature"))
            .ok()
            .and_then(|v| v.as_string())
            .ok_or_else(|| attest_err("signEd25519 result missing 'signature' string"))?;
        let algorithm = Reflect::get(&result, &JsValue::from_str("algorithm"))
            .ok()
            .and_then(|v| v.as_string())
            .unwrap_or_else(|| "ed25519".to_string());

        Ok(SignResult {
            signature,
            algorithm,
        })
    }

    fn platform(&self) -> Platform {
        self.platform
    }

    fn now_utc(&self) -> String {
        let now_fn = match get_method(&self.host, "nowUtc") {
            Ok(f) => f,
            Err(_) => return String::new(),
        };
        now_fn
            .call0(&self.host)
            .ok()
            .and_then(|v| v.as_string())
            .unwrap_or_default()
    }
}

// ─── WASM API ──────────────────────────────────────────────────────

/// Initialize the WASM module. Called once on load.
#[wasm_bindgen(start)]
pub fn init() {
    console_error_panic_hook::set_once();
}

/// WASM-exposed attest-it wrapper.
#[wasm_bindgen]
pub struct WasmAttestIt {
    host: Arc<JsHostPlatform>,
}

// SAFETY: Single-threaded WASM — no concurrent access.
unsafe impl Send for WasmAttestIt {}
unsafe impl Sync for WasmAttestIt {}

/// Factory function to create a WasmAttestIt.
#[wasm_bindgen(js_name = "createAttestIt")]
pub fn create_attest_it(host: JsValue) -> Result<WasmAttestIt, JsError> {
    let js_host = JsHostPlatform::new(host)?;
    Ok(WasmAttestIt {
        host: Arc::new(js_host),
    })
}

#[wasm_bindgen]
impl WasmAttestIt {
    // --- Verification (pure — no host needed) ---

    /// Verify a single gate's seal.
    #[wasm_bindgen(js_name = "verifyGateSeal")]
    pub fn verify_gate_seal(
        &self,
        config_json: &str,
        gate_id: &str,
        seals_json: &str,
        current_fingerprint: &str,
        now_ms: f64,
    ) -> Result<JsValue, JsError> {
        let config: attest_it_core::config::AttestItConfig =
            serde_json::from_str(config_json).map_err(|e| JsError::new(&e.to_string()))?;
        let seals: attest_it_core::seal::SealsFile =
            serde_json::from_str(seals_json).map_err(|e| JsError::new(&e.to_string()))?;

        let result = attest_it_core::seal::verify_gate_seal(
            &config,
            gate_id,
            &seals,
            current_fingerprint,
            now_ms as i64,
        );
        to_js_value(&result)
    }

    /// Verify all gate seals in bulk.
    #[wasm_bindgen(js_name = "verifyAllSeals")]
    pub fn verify_all_seals(
        &self,
        config_json: &str,
        seals_json: &str,
        fingerprints_json: &str,
        now_ms: f64,
    ) -> Result<JsValue, JsError> {
        let config: attest_it_core::config::AttestItConfig =
            serde_json::from_str(config_json).map_err(|e| JsError::new(&e.to_string()))?;
        let seals: attest_it_core::seal::SealsFile =
            serde_json::from_str(seals_json).map_err(|e| JsError::new(&e.to_string()))?;
        let fingerprints: std::collections::HashMap<String, String> =
            serde_json::from_str(fingerprints_json).map_err(|e| JsError::new(&e.to_string()))?;

        let results =
            attest_it_core::seal::verify_all_seals(&config, &seals, &fingerprints, now_ms as i64);
        to_js_value(&results)
    }

    // --- Seal creation (needs host for signing + timestamp) ---

    /// Create a seal by signing via the host platform.
    #[wasm_bindgen(js_name = "createSeal")]
    pub async fn create_seal(
        &self,
        gate_id: &str,
        fingerprint: &str,
        sealed_by: &str,
    ) -> Result<JsValue, JsError> {
        let seal =
            attest_it_core::seal::create_seal(gate_id, fingerprint, sealed_by, self.host.as_ref())
                .await
                .map_err(|e| JsError::new(&e.to_string()))?;
        to_js_value(&seal)
    }

    // --- Fingerprinting (needs host for file I/O + glob) ---

    /// Compute a content fingerprint.
    #[wasm_bindgen(js_name = "computeFingerprint")]
    pub async fn compute_fingerprint(&self, options_json: &str) -> Result<JsValue, JsError> {
        let options: attest_it_core::fingerprint::FingerprintOptions =
            serde_json::from_str(options_json).map_err(|e| JsError::new(&e.to_string()))?;

        let result = attest_it_core::fingerprint::compute_fingerprint(&options, self.host.as_ref())
            .await
            .map_err(|e| JsError::new(&e.to_string()))?;
        to_js_value(&result)
    }

    // --- Config parsing (pure) ---

    /// Parse a policy config from YAML or JSON content.
    #[wasm_bindgen(js_name = "parsePolicyConfig")]
    pub fn parse_policy_config(&self, content: &str, format: &str) -> Result<JsValue, JsError> {
        let config: attest_it_core::config::PolicyConfig = match format {
            "yaml" | "yml" => {
                serde_yaml::from_str(content).map_err(|e| JsError::new(&e.to_string()))?
            }
            "json" => serde_json::from_str(content).map_err(|e| JsError::new(&e.to_string()))?,
            other => return Err(JsError::new(&format!("Unsupported config format: {other}"))),
        };
        attest_it_core::config::validation::validate_policy(&config)
            .map_err(|e| JsError::new(&e.to_string()))?;
        to_js_value(&config)
    }

    /// Parse an operational config from YAML or JSON content.
    #[wasm_bindgen(js_name = "parseOperationalConfig")]
    pub fn parse_operational_config(
        &self,
        content: &str,
        format: &str,
    ) -> Result<JsValue, JsError> {
        let config: attest_it_core::config::OperationalConfig = match format {
            "yaml" | "yml" => {
                serde_yaml::from_str(content).map_err(|e| JsError::new(&e.to_string()))?
            }
            "json" => serde_json::from_str(content).map_err(|e| JsError::new(&e.to_string()))?,
            other => return Err(JsError::new(&format!("Unsupported config format: {other}"))),
        };
        attest_it_core::config::validation::validate_operational(&config)
            .map_err(|e| JsError::new(&e.to_string()))?;
        to_js_value(&config)
    }

    /// Merge policy and operational configs into a single runtime config.
    #[wasm_bindgen(js_name = "mergeConfigs")]
    pub fn merge_configs(
        &self,
        policy_json: &str,
        operational_json: &str,
    ) -> Result<JsValue, JsError> {
        let policy: attest_it_core::config::PolicyConfig =
            serde_json::from_str(policy_json).map_err(|e| JsError::new(&e.to_string()))?;
        let operational: attest_it_core::config::OperationalConfig =
            serde_json::from_str(operational_json).map_err(|e| JsError::new(&e.to_string()))?;

        let merged = attest_it_core::config::AttestItConfig::merge(policy, operational);
        to_js_value(&merged)
    }

    /// Validate cross-config consistency (suite→gate, signer references).
    ///
    /// Returns an array of validation errors (empty if valid).
    #[wasm_bindgen(js_name = "validateCrossConfig")]
    pub fn validate_cross_config(
        &self,
        policy_json: &str,
        operational_json: &str,
    ) -> Result<JsValue, JsError> {
        let policy: attest_it_core::config::PolicyConfig =
            serde_json::from_str(policy_json).map_err(|e| JsError::new(&e.to_string()))?;
        let operational: attest_it_core::config::OperationalConfig =
            serde_json::from_str(operational_json).map_err(|e| JsError::new(&e.to_string()))?;

        let errors = attest_it_core::config::validation::collect_cross_config_errors(
            &operational.suites,
            &policy.gates,
            &policy.team,
        );
        to_js_value(&errors)
    }

    // --- Authorization (pure) ---

    /// Check if a public key belongs to an authorized signer for a gate.
    #[wasm_bindgen(js_name = "isAuthorizedSigner")]
    pub fn is_authorized_signer(
        &self,
        config_json: &str,
        gate_id: &str,
        public_key: &str,
    ) -> Result<bool, JsError> {
        let config: attest_it_core::config::AttestItConfig =
            serde_json::from_str(config_json).map_err(|e| JsError::new(&e.to_string()))?;
        Ok(attest_it_core::authorization::is_authorized_signer(
            &config, gate_id, public_key,
        ))
    }
}

/// Serialize a Rust value to a JsValue via JSON round-trip.
fn to_js_value<T: serde::Serialize>(value: &T) -> Result<JsValue, JsError> {
    let json = serde_json::to_string(value).map_err(|e| JsError::new(&e.to_string()))?;
    js_sys::JSON::parse(&json).map_err(|e| JsError::new(&format!("JSON parse error: {e:?}")))
}
