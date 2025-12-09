#!/bin/bash
set -e

# Configuration - edit these for your deployment
NEAR_NETWORK="${NEAR_NETWORK:-testnet}"
CONTRACT_ID="${CONTRACT_ID:-google-cert-oracle.testnet}"
OWNER_ID="${OWNER_ID:-your-account.testnet}"
TRUSTED_EMITTER="${TRUSTED_EMITTER:-0x0000000000000000000000000000000000000000}"

echo "Deploying to $NEAR_NETWORK..."
echo "Contract ID: $CONTRACT_ID"
echo "Owner: $OWNER_ID"
echo "Trusted Emitter: $TRUSTED_EMITTER"

# Build first
./build.sh

# Deploy
near deploy --accountId "$CONTRACT_ID" \
  --wasmFile ../out/google_cert_oracle.wasm \
  --network "$NEAR_NETWORK"

# Initialize
near call "$CONTRACT_ID" new \
  "{\"owner\": \"$OWNER_ID\", \"trusted_emitter\": \"$TRUSTED_EMITTER\"}" \
  --accountId "$CONTRACT_ID" \
  --network "$NEAR_NETWORK"

echo "Deployment complete!"
echo ""
echo "To submit a snapshot:"
echo "near call $CONTRACT_ID submit_snapshot '{\"snapshot_json\": \"{}\"}' --accountId $OWNER_ID --network $NEAR_NETWORK"
echo ""
echo "To view the snapshot:"
echo "near view $CONTRACT_ID get_snapshot '{}' --network $NEAR_NETWORK"
