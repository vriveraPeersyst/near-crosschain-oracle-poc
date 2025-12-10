# Google Cert Oracle POC

A proof-of-concept that bridges Google's Firebase/Identity Platform X.509 certificates from Arbitrum to NEAR using Wormhole, enabling **trustless JWT verification on NEAR**.

## Why This Exists

Google rotates their OAuth signing certificates every ~7 days. To verify Google-signed JWTs (Firebase Auth, Google Identity) on-chain, smart contracts need access to these certificates. This oracle:

1. **Fetches** Google's public X.509 certificates (no API key needed - public endpoint)
2. **Publishes** them to Arbitrum via a Wormhole-enabled contract
3. **Bridges** the data trustlessly to NEAR via Wormhole guardian signatures
4. **Verifies** the VAA on-chain using `wormhole.wormhole.testnet` before storing

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              TRUSTLESS FLOW                                  │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────┐    ┌─────────────┐    ┌─────────────┐    ┌─────────────────────┐
│   Google    │    │   Arbitrum  │    │  Wormhole   │    │        NEAR         │
│   APIs      │    │   Sepolia   │    │  Guardians  │    │                     │
│             │    │             │    │  (19 nodes) │    │  ┌───────────────┐  │
│  X.509      │    │  Emitter    │    │             │    │  │ wormhole.     │  │
│  Certs      │    │  Contract   │    │  Sign VAA   │    │  │ wormhole.     │  │
│  (public)   │    │             │    │             │    │  │ testnet       │  │
└──────┬──────┘    └──────┬──────┘    └──────┬──────┘    │  └───────┬───────┘  │
       │                  │                  │           │          │          │
       │ 1. Fetch         │ 2. Emit          │ 3. Sign   │          │ verify   │
       ▼                  │    Message       │    VAA    │          ▼          │
┌──────────────┐          │                  │           │  ┌───────────────┐  │
│     Bot      │──────────┘                  │           │  │ GoogleCert    │  │
│  (cron/manual)                             │           │  │ Oracle        │  │
└──────────────┘                             │           │  │ Contract      │  │
                                             │           │  └───────▲───────┘  │
┌──────────────┐                             │           │          │          │
│   Relayer    │◄────────────────────────────┘           │          │          │
│              │─────────────────────────────────────────┼──────────┘          │
└──────────────┘         4. Submit VAA                   │   5. Store if valid │
                                                         └─────────────────────┘
```

### Security Model

| Component | Trust Level | Notes |
|-----------|-------------|-------|
| Google Certs | Public | Anyone can fetch from `googleapis.com` |
| Bot | **Untrusted** | Anyone can trigger, data is verified on-chain |
| Wormhole | Decentralized | 19 guardian nodes must sign (13/19 quorum) |
| NEAR Contract | **Trustless** | Verifies VAA signatures via `wormhole.wormhole.testnet` |
| Relayer | **Untrusted** | Just submits data, can't forge signatures |

**Key insight**: The bot and relayer are permissionless - anyone can run them. Security comes from Wormhole guardian signatures verified on NEAR.

## Project Structure

```
near-oracle-poc/
├── arbitrum/           # Solidity Wormhole emitter
│   ├── contracts/
│   │   └── GoogleCertEmitter.sol
│   └── scripts/deploy.ts
│
├── bot/                # Fetches Google certs & publishes to Arbitrum
│   └── src/
│       ├── index.ts           # Continuous polling (checks for changes)
│       └── publish-snapshot.ts # One-shot publish
│
├── relayer/            # Bridges VAAs from Wormhole to NEAR
│   └── src/
│       ├── index.ts    # Watch mode (auto-relay new VAAs)
│       └── relay.ts    # Core relay logic
│
├── near-contract/      # NEAR oracle with Wormhole verification
│   └── src/lib.rs      # Verifies VAA via wormhole.wormhole.testnet
│
└── chainlink-adapter/  # (NOT USED) - See "Future: Chainlink Automation"
```

> **Note**: The `chainlink-adapter/` folder exists but is not used in the current implementation. Since Google's certificate endpoint is public (no API key needed), we don't need Chainlink's external adapter pattern. See "Future: Chainlink Automation" section for how Chainlink could automate the refresh cycle.

## Deployed Contracts (Testnet)

| Network | Contract | Address |
|---------|----------|---------|
| Arbitrum Sepolia | GoogleCertEmitter | `0x62E14A87805CCd1AAA223347cbc35b64CbF02d63` |
| Arbitrum Sepolia | Wormhole Core | `0x6b9C8671cdDC8dEab9c719bB87cBd3e782bA6a35` |
| NEAR Testnet | GoogleCertOracle | `ff94854f6edb59ea4f762f10899cc29ed9d8c37245a935a8673a166bcc4a9856` |
| NEAR Testnet | Wormhole Core | `wormhole.wormhole.testnet` |

## Quick Start

### Prerequisites

- Node.js 18+
- Rust 1.86 + `wasm32-unknown-unknown` target
- NEAR CLI (`npm install -g near-cli`)

### 1. Deploy Arbitrum Contract

```bash
cd arbitrum
npm install
cp .env.example .env
# Edit .env with your private key

npx hardhat run scripts/deploy.ts --network arbitrumSepolia
```

### 2. Deploy NEAR Contract

```bash
cd near-contract
rustup override set 1.86  # Required for NEAR VM compatibility
rustup target add wasm32-unknown-unknown
cargo near build non-reproducible-wasm --no-abi

# Deploy and initialize
NEAR_ENV=testnet near deploy <your-account> ./target/near/google_cert_oracle.wasm
NEAR_ENV=testnet near call <your-account> new '{"owner": "<your-account>", "trusted_emitter": "0x62E14A87805CCd1AAA223347cbc35b64CbF02d63"}' --accountId <your-account>
```

### 3. Publish Certificates (Bot)

```bash
cd bot
npm install
cp .env.example .env
# Edit .env with Arbitrum RPC, private key, emitter address

# One-shot publish
npm run publish

# Or continuous mode (checks every hour, publishes on change)
npm start
```

### 4. Relay to NEAR

```bash
cd relayer
npm install
cp .env.example .env
# Edit .env with NEAR credentials and emitter address

# Relay specific VAA
npm run relay -- relay <sequence-number>

# Or watch mode (auto-relay new VAAs)
npm start
```

## E2E Test Results

Successfully tested on December 9, 2025:

| Step | Transaction | Details |
|------|-------------|---------|
| 1. Bot → Arbitrum | [`0x010de53b...`](https://sepolia.arbiscan.io/tx/0x010de53b1107fa45988520e34b37ac256901551e42751ebd93ecc1c0ef4b5900) | Published 2 Google certs |
| 2. Wormhole Signs | Sequence 1 | 19 guardians signed VAA |
| 3. Relay → NEAR | [`2vgDH9W8...`](https://testnet.nearblocks.io/txns/2vgDH9W8ZudN7jBoQY1CvMo5k5ux9HyTQCKQEpQ5R8GE) | VAA verified on-chain ✓ |

Logs from NEAR transaction:
```
Log: Verifying VAA: chain=10003, emitter=00000000000000000000000062e14a87805ccd1aaa223347cbc35b64cbf02d63, sequence=1
Log: wormhole/src/lib.rs#371: vaa_verify
Log: VAA verified by guardian set 0
Log: Snapshot #1 submitted via Wormhole VAA
```

## Reading Certificates from NEAR

### NEAR CLI

```bash
NEAR_ENV=testnet near view ff94854f6edb59ea4f762f10899cc29ed9d8c37245a935a8673a166bcc4a9856 get_snapshot '{}'
```

### JavaScript

```typescript
const snapshot = await account.viewFunction({
  contractId: "ff94854f6edb59ea4f762f10899cc29ed9d8c37245a935a8673a166bcc4a9856",
  methodName: "get_snapshot",
});

const certs = JSON.parse(snapshot);
// {
//   "3811b07f28b841f4b49e482585fd66d55e38db5d": "-----BEGIN CERTIFICATE-----\n...",
//   "951891911076054344e15e256425bb425eeb3a5c": "-----BEGIN CERTIFICATE-----\n..."
// }
```

## Future: Chainlink Automation

Google rotates certificates every ~7 days. To fully automate refreshes, you could use **Chainlink Automation** (formerly Keepers):

### Option 1: Time-based Automation

```solidity
// Add to GoogleCertEmitter.sol
import "@chainlink/contracts/src/v0.8/automation/AutomationCompatible.sol";

contract GoogleCertEmitter is AutomationCompatibleInterface {
    uint256 public lastUpdate;
    uint256 public constant UPDATE_INTERVAL = 7 days;
    
    function checkUpkeep(bytes calldata) external view override returns (bool upkeepNeeded, bytes memory) {
        upkeepNeeded = (block.timestamp - lastUpdate) > UPDATE_INTERVAL;
    }
    
    function performUpkeep(bytes calldata) external override {
        // Called by Chainlink Automation every 7 days
        // Fetch certs via Chainlink Functions and publish
        lastUpdate = block.timestamp;
    }
}
```

### Option 2: Chainlink Functions (fetch + publish in one tx)

```javascript
// Chainlink Functions source code
const response = await Functions.makeHttpRequest({
  url: "https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com"
});
return Functions.encodeString(JSON.stringify(response.data));
```

This would:
1. **Chainlink Automation** triggers every 7 days
2. **Chainlink Functions** fetches Google certs (no API key needed)
3. **GoogleCertEmitter** receives data and emits Wormhole message
4. **Relayer** (or another Automation job) submits to NEAR

### Why We Don't Need a Chainlink Adapter

The `chainlink-adapter/` pattern is for when Chainlink nodes need to fetch from authenticated APIs. Since Google's certificate endpoint is:
- ✅ Public (no authentication)
- ✅ Rate-limit friendly
- ✅ Stable URL

We can use **Chainlink Functions** directly to fetch and publish, making the external adapter unnecessary.

## Cost Estimates

| Operation | Network | Cost |
|-----------|---------|------|
| Publish snapshot | Arbitrum Sepolia | ~0.0001 ETH |
| Relay VAA | NEAR Testnet | ~0.01 NEAR |
| Chainlink Automation | Arbitrum | ~0.1 LINK/month |

## Security Considerations

### Current Implementation ✅

- [x] VAA signatures verified on NEAR via `wormhole.wormhole.testnet`
- [x] Emitter chain validated (must be Arbitrum Sepolia = 10003)
- [x] Emitter address validated (must match trusted emitter)
- [x] Replay protection (processed VAA hashes tracked)

### Production Recommendations

- [ ] Deploy to mainnet (Arbitrum One + NEAR Mainnet)
- [ ] Add rate limiting on NEAR contract
- [ ] Multi-sig ownership for contract upgrades
- [ ] Monitor certificate expiry dates
- [ ] Add circuit breaker for emergencies

## Links

- [Wormhole Docs](https://wormhole.com/docs/)
- [Wormhole Contract Addresses](https://docs.wormhole.com/wormhole/reference/constants)
- [Wormholescan Explorer](https://wormholescan.io/)
- [Google X.509 Endpoint](https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com)
- [Chainlink Automation](https://docs.chain.link/chainlink-automation)
- [Chainlink Functions](https://docs.chain.link/chainlink-functions)
- [NEAR Docs](https://docs.near.org/)
