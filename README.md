# Google Cert Oracle POC

A proof-of-concept that bridges Google's Firebase/Identity Platform X.509 certificates from Arbitrum to NEAR using Wormhole.

## Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   Google APIs   │     │    Wormhole     │     │      NEAR       │
│                 │     │    Guardians    │     │                 │
│  X.509 Certs    │     │                 │     │  Oracle Contract│
└────────┬────────┘     └────────┬────────┘     └────────▲────────┘
         │                       │                       │
         │ 1. Fetch              │ 3. Sign VAA          │ 5. Submit
         ▼                       │                       │
┌─────────────────┐     ┌────────┴────────┐     ┌────────┴────────┐
│   Off-chain     │────▶│    Arbitrum     │     │    Wormhole     │
│      Bot        │     │    Emitter      │────▶│    Relayer      │
│                 │ 2.  │   (Wormhole)    │ 4.  │                 │
└─────────────────┘     └─────────────────┘     └─────────────────┘
```

### Flow

1. **Bot** fetches Google X.509 certificates from `googleapis.com`
2. **Bot** calls `publishGoogleSnapshot()` on Arbitrum's `GoogleCertEmitter`
3. **Wormhole Guardians** observe the message and create a signed VAA
4. **Relayer** fetches the VAA from Wormholescan API
5. **Relayer** submits the payload to NEAR's `GoogleCertOracle`

## Project Structure

```
near-oracle-poc/
├── arbitrum/           # Solidity contract + Hardhat
│   ├── contracts/
│   │   └── GoogleCertEmitter.sol
│   ├── scripts/
│   │   └── deploy.ts
│   └── hardhat.config.ts
│
├── bot/                # Off-chain bot (fetches & publishes)
│   └── src/
│       ├── index.ts    # Continuous polling mode
│       └── publish-snapshot.ts
│
├── relayer/            # Wormhole → NEAR relayer
│   └── src/
│       ├── index.ts    # Watch mode
│       └── relay.ts    # Core relay logic
│
├── near-contract/      # Rust NEAR contract
│   ├── src/
│   │   └── lib.rs
│   ├── build.sh
│   └── deploy.sh
│
└── chainlink-adapter/  # Chainlink External Adapter
    └── src/
        ├── index.ts    # Express server
        └── test.ts     # Test script
```

## Quick Start

### Prerequisites

- Node.js 18+
- Rust + `wasm32-unknown-unknown` target
- NEAR CLI (`npm install -g near-cli`)
- Hardhat (`npm install -g hardhat`)

### 1. Deploy Arbitrum Contract

```bash
cd arbitrum
npm install
cp .env.example .env
# Edit .env with your private key and RPC URL

# Deploy to Arbitrum Sepolia (testnet)
npm run deploy:sepolia

# Or mainnet
npm run deploy:arbitrum
```

### 2. Deploy NEAR Contract

```bash
cd near-contract

# Add wasm target if needed
rustup target add wasm32-unknown-unknown

# Build
chmod +x build.sh
./build.sh

# Deploy (edit deploy.sh with your account info first)
chmod +x deploy.sh
./deploy.sh
```

### 3. Run the Bot

```bash
cd bot
npm install
cp .env.example .env
# Edit .env with:
# - ARBITRUM_RPC_URL
# - PRIVATE_KEY (owner of GoogleCertEmitter)
# - EMITTER_ADDRESS (deployed contract address)

# One-shot publish
npm run publish

# Or continuous polling
npm start
```

### 4. Run the Relayer

```bash
cd relayer
npm install
cp .env.example .env
# Edit .env with:
# - NEAR credentials
# - NEAR_CONTRACT_ID
# - EMITTER_ADDRESS

# Relay specific VAA by sequence
npm run relay -- relay 123

# Or watch mode (auto-relay)
npm start
```

### 5. (Optional) Run Chainlink Adapter

If you want Chainlink nodes to fetch Google certs:

```bash
cd chainlink-adapter
npm install
npm start
# Adapter runs on http://localhost:8080

# Test it
npm test
```

## Chainlink Integration

The `chainlink-adapter/` provides a standard [Chainlink External Adapter](https://docs.chain.link/chainlink-nodes/external-adapters/developers) that any Chainlink node can use:

```
POST http://localhost:8080/
{
  "id": "job-123",
  "data": { "format": "hash" }  // or "json" or "bytes"
}
```

**Formats:**
- `json` - Full certificate data with metadata
- `hash` - SHA256 hash (32 bytes) - cheapest on-chain
- `bytes` - Hex-encoded JSON for direct storage

See `chainlink-adapter/README.md` for job spec examples.

## Contract Addresses

### Wormhole Core (Official)

| Network          | Address                                      |
|------------------|----------------------------------------------|
| Arbitrum Mainnet | `0xa5f208e072434bC67592E4C49C1B991BA79BCA46` |
| Arbitrum Sepolia | `0x6b9C8671cdDC8dEab9c719bB87cBd3e5c44Be9bF` |

## Reading Certificates from NEAR

Once deployed, any dApp can read the Google certs:

### NEAR CLI

```bash
near view google-cert-oracle.testnet get_snapshot '{}'
```

### JavaScript/TypeScript

```typescript
import { connect, keyStores } from "near-api-js";

const near = await connect({
  networkId: "testnet",
  nodeUrl: "https://rpc.testnet.near.org",
  keyStore: new keyStores.InMemoryKeyStore(),
});

const account = await near.account("any-account.testnet");
const snapshot = await account.viewFunction({
  contractId: "google-cert-oracle.testnet",
  methodName: "get_snapshot",
  args: {},
});

console.log(JSON.parse(snapshot));
// {
//   "3811b07f28b841f4b49e482585fd66d55e38db5d": "-----BEGIN CERTIFICATE-----\n...",
//   "951891911076054344e15e256425bb425eeb3a5c": "-----BEGIN CERTIFICATE-----\n..."
// }
```

### Rust (NEAR Contract)

```rust
use near_sdk::ext_contract;

#[ext_contract(ext_oracle)]
trait GoogleCertOracle {
    fn get_snapshot(&self) -> String;
}

// In your contract:
ext_oracle::ext("google-cert-oracle.near".parse().unwrap())
    .get_snapshot()
    .then(Self::ext(env::current_account_id()).handle_certs_callback())
```

## Security Notes

⚠️ **POC Warning**: This is a proof-of-concept with a **trusted relayer** model.

In production, you should:

1. **Verify VAAs on-chain**: Use NEAR's `wormhole_crypto.near` contract to verify guardian signatures
2. **Add rate limiting**: Prevent spam/DoS attacks
3. **Multi-sig ownership**: Don't use a single EOA as owner
4. **Circuit breakers**: Add pause functionality for emergencies

## Costs

| Operation | Estimated Cost |
|-----------|----------------|
| Arbitrum publish | ~0.001 ETH (gas) + ~0.0001 ETH (Wormhole fee) |
| NEAR submit | ~0.001 NEAR |

## Links

- [Wormhole Docs](https://wormhole.com/docs/)
- [Wormhole Contract Addresses](https://wormhole.com/docs/products/reference/contract-addresses/)
- [Wormholescan Explorer](https://wormholescan.io/)
- [Google X.509 Endpoint](https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com)
- [NEAR Docs](https://docs.near.org/)
