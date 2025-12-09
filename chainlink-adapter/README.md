# Chainlink External Adapter - Google X.509 Certificates

A Chainlink-compatible External Adapter that fetches Google Firebase/Identity Platform X.509 certificates.

## What is this?

Chainlink nodes use [External Adapters](https://docs.chain.link/chainlink-nodes/external-adapters/developers) to fetch data from external APIs. This adapter allows Chainlink validators to:

1. Fetch Google's current X.509 signing certificates
2. Return them in various formats (JSON, hash, or bytes)
3. Deliver them on-chain via Chainlink's oracle network

## Quick Start

```bash
npm install
npm start
```

The adapter will run on `http://localhost:8080`.

## Test

```bash
# In one terminal, start the adapter
npm start

# In another terminal, run tests
npm test
```

## API

### POST / (Main Chainlink Endpoint)

Chainlink nodes call this endpoint with a standard request:

```json
{
  "id": "job-run-id",
  "data": {
    "format": "json"  // or "hash" or "bytes"
  }
}
```

**Response:**

```json
{
  "jobRunID": "job-run-id",
  "statusCode": 200,
  "data": {
    "result": { ... },
    "hash": "abc123...",
    "timestamp": 1702147200000,
    "kidCount": 2
  }
}
```

### Formats

| Format | Description | Use Case |
|--------|-------------|----------|
| `json` | Full certificate data with metadata | Off-chain consumers, debugging |
| `hash` | SHA256 hash of certificates | Cheap on-chain verification |
| `bytes` | Hex-encoded JSON | Direct on-chain storage |

### GET /health

Health check endpoint:

```json
{ "status": "ok", "timestamp": 1702147200000 }
```

## Chainlink Job Spec

Example job spec for a Chainlink node to use this adapter:

```toml
type = "directrequest"
schemaVersion = 1
name = "Google Certs Oracle"
contractAddress = "0xYourOracleContractAddress"
maxTaskDuration = "0s"
observationSource = """
    decode_log   [type="ethabidecodelog"
                  abi="OracleRequest(bytes32 indexed specId, address requester, bytes32 requestId, uint256 payment, address callbackAddr, bytes4 callbackFunctionId, uint256 cancelExpiration, uint256 dataVersion, bytes data)"
                  data="$(jobRun.logData)"
                  topics="$(jobRun.logTopics)"]

    decode_cbor  [type="cborparse" data="$(decode_log.data)"]

    fetch        [type="bridge" 
                  name="google-certs-adapter" 
                  requestData="{\\"id\\": \\"$(jobSpec.externalJobID)\\", \\"data\\": {\\"format\\": \\"hash\\"}}"]

    parse        [type="jsonparse" path="data,result" data="$(fetch)"]

    encode_data  [type="ethabiencode" 
                  abi="(bytes32 value)" 
                  data="{\\"value\\": $(parse)}"]

    encode_tx    [type="ethabiencode"
                  abi="fulfillOracleRequest(bytes32 requestId, uint256 payment, address callbackAddress, bytes4 callbackFunctionId, uint256 expiration, bytes32 data)"
                  data="{\\"requestId\\": $(decode_log.requestId), \\"payment\\": $(decode_log.payment), \\"callbackAddress\\": $(decode_log.callbackAddr), \\"callbackFunctionId\\": $(decode_log.callbackFunctionId), \\"expiration\\": $(decode_log.cancelExpiration), \\"data\\": $(encode_data)}"]

    submit_tx    [type="ethtx" to="0xYourOracleContractAddress" data="$(encode_tx)"]

    decode_log -> decode_cbor -> fetch -> parse -> encode_data -> encode_tx -> submit_tx
"""
```

## Adding to Chainlink Node

1. **Deploy this adapter** somewhere accessible (Docker, AWS, etc.)

2. **Add as a Bridge** in Chainlink Node UI:
   - Name: `google-certs-adapter`
   - URL: `http://your-adapter-host:8080`

3. **Create a Job** using the spec above

## Docker

```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build
EXPOSE 8080
CMD ["node", "dist/index.js"]
```

```bash
docker build -t chainlink-google-cert-adapter .
docker run -p 8080:8080 chainlink-google-cert-adapter
```

## Integration with the POC

This adapter can work alongside or instead of the Wormhole flow:

```
Option A: Wormhole Flow (cross-chain messaging)
  Bot → Arbitrum Emitter → Wormhole → NEAR

Option B: Chainlink Flow (oracle network)
  Adapter → Chainlink Node → On-chain Contract (any EVM chain)
```

For the **Arbitrum emitter** in this POC, you could use Chainlink to trigger the `publishGoogleSnapshot()` call instead of the custom bot.
