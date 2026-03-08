//! Host platform abstraction trait.
//!
//! The [`HostPlatform`] trait provides an inversion-of-control boundary between
//! the platform-agnostic core and the host environment (Node.js via WASM or
//! native OS). All file I/O, glob resolution, and signing operations are
//! delegated to the host.

use std::path::Path;

use crate::errors::AttestError;
use crate::types::{Platform, ResolvedFile, SignResult};

/// Abstraction over host environment capabilities.
///
/// In WASM builds, this is backed by JavaScript callbacks via `wasm-bindgen`.
/// In native builds, this uses `std::fs`, `globset`/`walkdir`, and VaultKeeper.
///
/// # Platform-specific bounds
///
/// - **Native (non-wasm32):** The trait requires `Send + Sync` and async methods
///   return `Send` futures, enabling use from multi-threaded async runtimes.
/// - **wasm32:** Neither `Send` nor `Sync` is required, because JavaScript values
///   (`JsValue`, etc.) are single-threaded and cannot cross thread boundaries.
///   Async methods return `!Send` futures via `async_trait(?Send)`.
#[cfg(not(target_arch = "wasm32"))]
#[async_trait::async_trait]
pub trait HostPlatform: Send + Sync {
    // --- File I/O ---

    /// Read a file's contents as raw bytes.
    async fn read_file(&self, path: &Path) -> Result<Vec<u8>, AttestError>;

    /// Write raw bytes to a file, creating parent directories as needed.
    async fn write_file(&self, path: &Path, content: &[u8]) -> Result<(), AttestError>;

    /// Check whether a file exists at the given path.
    async fn file_exists(&self, path: &Path) -> Result<bool, AttestError>;

    /// Recursively create directories at the given path.
    async fn create_dir_all(&self, path: &Path) -> Result<(), AttestError>;

    // --- Glob Resolution ---

    /// Resolve glob patterns into a sorted list of [`ResolvedFile`]s.
    ///
    /// The host handles glob expansion because different environments use
    /// different libraries: `tinyglobby` in Node.js/WASM, `globset`+`walkdir`
    /// in native Rust.
    async fn resolve_globs(
        &self,
        patterns: &[String],
        ignore: &[String],
        base_dir: &Path,
    ) -> Result<Vec<ResolvedFile>, AttestError>;

    // --- Signing ---

    /// Sign data using Ed25519 via the host's key management system.
    ///
    /// In production, this delegates to VaultKeeper's delegated exec pattern.
    /// Private keys never leave VaultKeeper — the core only sees signatures.
    async fn sign_ed25519(&self, data: &[u8], signer_id: &str) -> Result<SignResult, AttestError>;

    // --- Platform Info ---

    /// The host platform (`"darwin"`, `"linux"`, or `"win32"`).
    fn platform(&self) -> Platform;

    /// Current UTC time as an ISO 8601 string (e.g., `"2024-06-01T08:00:00.000Z"`).
    fn now_utc(&self) -> String;
}

/// wasm32 version of [`HostPlatform`] — no `Send`/`Sync` bounds.
///
/// See the [module-level docs](self) for why the bounds differ.
#[cfg(target_arch = "wasm32")]
#[async_trait::async_trait(?Send)]
pub trait HostPlatform {
    async fn read_file(&self, path: &Path) -> Result<Vec<u8>, AttestError>;
    async fn write_file(&self, path: &Path, content: &[u8]) -> Result<(), AttestError>;
    async fn file_exists(&self, path: &Path) -> Result<bool, AttestError>;
    async fn create_dir_all(&self, path: &Path) -> Result<(), AttestError>;
    async fn resolve_globs(
        &self,
        patterns: &[String],
        ignore: &[String],
        base_dir: &Path,
    ) -> Result<Vec<ResolvedFile>, AttestError>;
    async fn sign_ed25519(&self, data: &[u8], signer_id: &str) -> Result<SignResult, AttestError>;
    fn platform(&self) -> Platform;
    fn now_utc(&self) -> String;
}
