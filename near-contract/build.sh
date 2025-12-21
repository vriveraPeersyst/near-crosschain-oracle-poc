#!/bin/bash
set -e

echo "Building NEAR contract..."

# Build the contract using cargo-near (properly optimizes WASM)
cargo near build non-reproducible-wasm

# Copy to more accessible location
mkdir -p ../out
cp target/near/google_cert_oracle.wasm ../out/

echo "Build complete! WASM file at: out/google_cert_oracle.wasm"
echo "Size: $(ls -lh ../out/google_cert_oracle.wasm | awk '{print $5}')"
