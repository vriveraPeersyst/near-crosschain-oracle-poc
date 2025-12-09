#!/bin/bash
set -e

echo "Building NEAR contract..."

# Build the contract
RUSTFLAGS='-C link-arg=-s' cargo build --target wasm32-unknown-unknown --release

# Copy to more accessible location
mkdir -p ../out
cp target/wasm32-unknown-unknown/release/google_cert_oracle.wasm ../out/

echo "Build complete! WASM file at: out/google_cert_oracle.wasm"
echo "Size: $(ls -lh ../out/google_cert_oracle.wasm | awk '{print $5}')"
