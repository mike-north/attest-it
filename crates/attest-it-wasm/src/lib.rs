//! WebAssembly bindings for attest-it.
//!
//! This crate is only meaningful when compiled for `wasm32-unknown-unknown`.
//! On native targets, it is an empty crate to avoid Send/Sync conflicts.

#[cfg(target_arch = "wasm32")]
mod wasm_impl;
