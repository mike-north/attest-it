//! Platform-agnostic core library for attest-it.
//!
//! This crate provides the domain model, fingerprinting, seal creation/verification,
//! and configuration parsing for the attest-it attestation system.

pub mod authorization;
pub mod config;
pub mod errors;
pub mod fingerprint;
pub mod host;
pub mod seal;
pub(crate) mod serde_helpers;
pub mod types;

// Re-export key types at crate root for convenience.
pub use errors::AttestError;
pub use host::HostPlatform;
pub use types::{Platform, ResolvedFile, SignResult};
