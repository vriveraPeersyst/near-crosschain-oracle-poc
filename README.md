# Google Cert Oracle - Automated RSA Key Bridge

A fully automated, trustless oracle that bridges Google's Firebase/Identity Platform RSA public keys from **Arbitrum** to **NEAR** using **Chainlink Functions** + **Chainlink Automation** for decentralized data fetching and **Wormhole** for cross-chain messaging.

## 🎯 What This Does

Google rotates their OAuth signing certificates every ~7 days. To verify Google-signed JWTs (Firebase Auth, Google Identity) on NEAR, smart contracts need access to these RSA public keys. This oracle:

1. **Automatically fetches** Google's X.509 certificates every 15 minutes via **Chainlink Automation**
2. **Extracts** the raw 256-byte RSA modulus using **Chainlink Functions** (decentralized JS execution)
3. **Stores** the RSA key on Arbitrum
4. **Bridges** to NEAR via **Wormhole** cross-chain messaging
5. **Verifies** the VAA on NEAR using `wormhole.wormhole.testnet` before storing

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                         FULLY AUTOMATED FLOW                                     │
└─────────────────────────────────────────────────────────────────────────────────┘

  Every 15 minutes (Chainlink Automation)
           │
           ▼
┌─────────────────┐     ┌───────────────────┐     ┌────────────────────┐
│   Chainlink     │     │    Chainlink      │     │     Arbitrum       │
│   Automation    │────▶│    Functions      │────▶│     Contract       │
│   (Time-based)  │     │    (21 DON nodes) │     │                    │
└─────────────────┘     └───────────────────┘     └─────────┬──────────┘
                                │                           │
                                │ Fetch & Parse             │ Store 256-byte
                                ▼                           │ RSA modulus
                        ┌───────────────┐                   │
                        │    Google     │                   │
                        │    APIs       │                   │
                        │ (X.509 certs) │                   │
                        └───────────────┘                   │
                                                            │
                              Manual trigger                │
                        ┌───────────────────────────────────┘
                        │
                        ▼
              ┌─────────────────┐
              │    Wormhole     │
              │    Core         │
              │    (Arbitrum)   │
              └────────┬────────┘
                       │
                       │ Guardians sign (13/19 quorum)
                       ▼
              ┌─────────────────┐
              │    Relayer      │
              │    (anyone)     │──────────┐
              └─────────────────┘          │
                                           │ Submit VAA
                                           ▼
                              ┌─────────────────────┐
                              │        NEAR         │
                              │  ┌───────────────┐  │
                              │  │   Wormhole    │  │
                              │  │   Verifier    │◀─┼── Verify signatures
                              │  └───────┬───────┘  │
                              │          │          │
                              │          ▼          │
                              │  ┌───────────────┐  │
                              │  │  GoogleCert   │  │
                              │  │  Oracle       │  │
                              │  │  (stores key) │  │
                              │  └───────────────┘  │
                              └─────────────────────┘
```

## 🔐 Security Model

| Component | Trust Level | Description |
|-----------|-------------|-------------|
| Google Certs | Public | Anyone can fetch from `googleapis.com` |
| Chainlink Automation | **Decentralized** | Triggers contract on schedule |
| Chainlink Functions | **Decentralized** | 21 nodes execute JS, aggregate results |
| Wormhole Guardians | **Decentralized** | 19 nodes, 13/19 quorum required |
| Relayer | **Untrusted** | Just submits data, can't forge signatures |
| NEAR Contract | **Trustless** | Verifies VAA via Wormhole on-chain |

**No trusted bot needed!** Everything is decentralized and verifiable.

## 📦 Deployed Contracts

### Arbitrum Sepolia (Testnet)

| Contract | Address |
|----------|---------|
| GoogleCertFunctionsConsumer | `0x4948Adae83B9f7A321A543744C4D97f3089163d9` |
| Wormhole Core | `0x6b9C8671cdDC8dEab9c719bB87cBd3e782bA6a35` |
| Chainlink Functions Router | `0x234a5fb5Bd614a7AA2FfAB244D603abFA0Ac5C5C` |

### NEAR Testnet

| Contract | Address |
|----------|---------|
| GoogleCertOracle | `googlecertoraclepoc.testnet` |
| Wormhole Core | `wormhole.wormhole.testnet` |

### Chainlink Services

| Service | Details |
|---------|---------|
| Functions Subscription | [#548](https://functions.chain.link/arbitrum-sepolia/548) |
| Automation Upkeep | [View](https://automation.chain.link/arbitrum-sepolia) - Time-based, 15 min |
| DON ID | `fun-arbitrum-sepolia-1` |
| Callback Gas Limit | `300000` (Arbitrum Sepolia max) |

## 📁 Project Structure

```
near-oracle-poc/
├── arbitrum/                    # Solidity contracts + scripts
│   ├── contracts/
│   │   └── GoogleCertFunctionsConsumer.sol  # Main contract with automation
│   └── scripts/
│       ├── deploy-functions-consumer.ts     # Deploy contract
│       ├── set-source.ts                    # Upload JS to contract
│       ├── request-certs.ts                 # Manual trigger
│       ├── publish-wormhole.ts              # Publish to Wormhole
│       └── check-payload.ts                 # View stored RSA key
│
├── chainlink-functions/         # JavaScript executed by DON
│   ├── source.js               # Full source (readable)
│   └── source.min.js           # Minified (deployed, 1.3KB)
│
├── relayer/                     # Bridges VAAs to NEAR
│   └── src/
│       ├── index.ts            # Watch mode
│       └── relay.ts            # Relay logic
│
└── near-contract/               # NEAR oracle contract
    └── src/lib.rs              # Rust contract
```

## 🚀 Quick Start

### Prerequisites

- Node.js 18+
- Rust + `wasm32-unknown-unknown` target
- LINK tokens on Arbitrum Sepolia ([faucet](https://faucets.chain.link/arbitrum-sepolia))
- ETH on Arbitrum Sepolia

### 1. Clone & Install

```bash
git clone <repo>
cd near-oracle-poc

# Install all dependencies
cd arbitrum && npm install && cd ..
cd relayer && npm install && cd ..
cd chainlink-functions && npm install && cd ..
```

### 2. Deploy Arbitrum Contract

```bash
cd arbitrum
cp .env.example .env
# Edit .env: PRIVATE_KEY, SUBSCRIPTION_ID (create at functions.chain.link)

npx hardhat run scripts/deploy-functions-consumer.ts --network arbitrumSepolia
# Add consumer address to subscription at functions.chain.link

# Set the source code
npx hardhat run scripts/set-source.ts --network arbitrumSepolia
```

### 3. Setup Chainlink Automation

Register at [automation.chain.link](https://automation.chain.link/arbitrum-sepolia):

1. Click **Register new Upkeep**
2. Select **Time-based** trigger
3. Target contract: Your deployed contract address
4. Target function: `performUpkeep(bytes)`
5. Function input: `0x`
6. Cron expression: `*/15 * * * *` (every 15 mins)
7. Gas limit: `500000`
8. Fund with LINK

### 4. Deploy NEAR Contract

```bash
# Create a new NEAR testnet account
near create-account your-new-account.testnet --useFaucet

cd near-contract
./build.sh  # Uses cargo-near for proper WASM optimization

# Deploy contract
near deploy your-new-account.testnet ./target/near/google_cert_oracle.wasm

# Initialize with your Arbitrum contract as trusted emitter
near call your-new-account.testnet new '{"owner": "your-new-account.testnet", "trusted_emitter": "0x4948Adae83B9f7A321A543744C4D97f3089163d9"}' --accountId your-new-account.testnet
```

### 5. Bridge to NEAR

After Chainlink fetches data automatically, publish to Wormhole:

```bash
cd arbitrum
npx hardhat run scripts/publish-wormhole.ts --network arbitrumSepolia
# Note the sequence number

# Wait ~1 minute for guardian signatures, then relay
cd ../relayer
npm run relay relay <sequence-number>
```

## 📊 Data Flow

### Step 1: Automated Fetch (Chainlink)

Every 15 minutes, Chainlink Automation triggers `performUpkeep()`:

1. Contract calls Chainlink Functions with JavaScript source
2. 21 DON nodes fetch Google's X.509 certificates
3. JavaScript parses first cert, extracts 256-byte RSA modulus
4. Callback stores raw bytes in `latestCertPayload`

### Step 2: Publish to Wormhole (Manual)

1. Call `publishToWormhole()` on Arbitrum contract
2. Wormhole Core emits a cross-chain message
3. 19 Guardian nodes observe and sign (~1 minute)

### Step 3: Relay to NEAR

1. Relayer fetches signed VAA from Wormhole API
2. Submits to NEAR contract via `submit_vaa()`
3. NEAR calls `wormhole.wormhole.testnet` to verify signatures
4. If valid, stores RSA modulus as hex string

### Step 4: Read on NEAR

```bash
near view googlecertoraclepoc.testnet get_snapshot
# Returns: {"rsa_modulus":"a8cb66e482dbd9fc...", "bytes":256}
```

## 🔧 Configuration

### Change Automation Interval

```bash
cd arbitrum
npx hardhat console --network arbitrumSepolia

> const c = await ethers.getContractAt("GoogleCertFunctionsConsumer", "0x4948Adae83B9f7A321A543744C4D97f3089163d9")
> await c.setUpdateInterval(3600)  // 1 hour in seconds
```

### Disable/Enable Automation

```solidity
> await c.setAutomationEnabled(false)  // Pause
> await c.setAutomationEnabled(true)   // Resume
```

### Update Trusted Emitter on NEAR

If you redeploy the Arbitrum contract:

```bash
near call googlecertoraclepoc.testnet set_trusted_emitter '{"emitter": "0xNewContractAddress"}' --accountId googlecertoraclepoc.testnet
```

## 💰 Cost Estimates

| Operation | Cost |
|-----------|------|
| Chainlink Functions request | ~0.26 LINK |
| Chainlink Automation trigger | ~0.001 LINK |
| Wormhole publish | ~0.0001 ETH |
| Relay to NEAR | ~0.03 NEAR |

**Estimated monthly cost** (15-min intervals): ~25 LINK + gas fees

## 🔍 Monitoring

| Service | Link |
|---------|------|
| Chainlink Functions | [functions.chain.link/arbitrum-sepolia/548](https://functions.chain.link/arbitrum-sepolia/548) |
| Chainlink Automation | [automation.chain.link](https://automation.chain.link/arbitrum-sepolia) |
| Wormhole Explorer | [wormholescan.io](https://wormholescan.io/#/?network=Testnet) |
| Arbitrum Explorer | [sepolia.arbiscan.io](https://sepolia.arbiscan.io/address/0x4948Adae83B9f7A321A543744C4D97f3089163d9) |
| NEAR Explorer | [testnet.nearblocks.io](https://testnet.nearblocks.io) |

## 🛠️ Development

### Simulate Chainlink Functions Locally

```bash
cd chainlink-functions
npm run simulate
```

### Build NEAR Contract

```bash
cd near-contract
./build.sh
```

### Check On-Chain Data

```bash
# Arbitrum - view stored RSA modulus
cd arbitrum
npx hardhat run scripts/check-payload.ts --network arbitrumSepolia

# NEAR - view stored snapshot
near view googlecertoraclepoc.testnet get_snapshot
near view googlecertoraclepoc.testnet get_snapshot_count
near view googlecertoraclepoc.testnet get_last_update_ts
```

## 📝 Data Format

### On Arbitrum

Raw 256 bytes (RSA modulus) stored in `latestCertPayload`.

### On NEAR

JSON object with hex-encoded RSA modulus:

```json
{
  "rsa_modulus": "bd9e39e910f3ad5c8e2b4d7f1a0e6c9b...",
  "bytes": 256
}
```

## 📄 License

MIT
