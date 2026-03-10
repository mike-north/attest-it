//! Binary that emits conformance test vectors as JSON on stdout.
//!
//! Called by the TypeScript test suite (via a subprocess or pre-generated
//! file) to obtain authoritative expected values for fingerprinting,
//! Ed25519 seal verification, config parsing, and duration parsing.
//! The generated JSON is the cross-language contract between the Rust
//! and TypeScript implementations.

fn main() {
    let vectors = attest_it_conformance::generate_vectors();
    println!(
        "{}",
        serde_json::to_string_pretty(&vectors).expect("ConformanceVectors must serialize to JSON")
    );
}
