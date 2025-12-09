import { connect, keyStores, KeyPair, Contract } from "near-api-js";
import axios from "axios";
import "dotenv/config";

// Wormhole chain ID for Arbitrum Sepolia (testnet)
const ARBITRUM_CHAIN_ID = 10003;

// Wormholescan API for fetching VAAs (testnet)
const WORMHOLESCAN_API = "https://api.testnet.wormholescan.io";

interface Config {
  nearNetwork: string;
  nearNodeUrl: string;
  nearAccountId: string;
  nearPrivateKey: string;
  nearContractId: string;
  emitterAddress: string;
}

function loadConfig(): Config {
  const nearNetwork = process.env.NEAR_NETWORK || "testnet";
  const nearNodeUrl =
    process.env.NEAR_NODE_URL ||
    (nearNetwork === "mainnet"
      ? "https://rpc.mainnet.near.org"
      : "https://rpc.testnet.near.org");
  const nearAccountId = process.env.NEAR_ACCOUNT_ID;
  const nearPrivateKey = process.env.NEAR_PRIVATE_KEY;
  const nearContractId = process.env.NEAR_CONTRACT_ID;
  const emitterAddress = process.env.EMITTER_ADDRESS;

  if (!nearAccountId || !nearPrivateKey || !nearContractId || !emitterAddress) {
    throw new Error(
      "Missing required env vars: NEAR_ACCOUNT_ID, NEAR_PRIVATE_KEY, NEAR_CONTRACT_ID, EMITTER_ADDRESS"
    );
  }

  return {
    nearNetwork,
    nearNodeUrl,
    nearAccountId,
    nearPrivateKey,
    nearContractId,
    emitterAddress,
  };
}

/**
 * Convert Ethereum address to Wormhole emitter format (32 bytes, left-padded)
 */
function toWormholeEmitterAddress(ethAddress: string): string {
  const clean = ethAddress.toLowerCase().replace("0x", "");
  return "000000000000000000000000" + clean;
}

/**
 * Fetch VAA from Wormholescan API
 */
async function fetchVAA(
  emitterChain: number,
  emitterAddress: string,
  sequence: string
): Promise<{ vaaBytes: Buffer; payload: string } | null> {
  const emitterAddr = toWormholeEmitterAddress(emitterAddress);
  const url = `${WORMHOLESCAN_API}/v1/signed_vaa/${emitterChain}/${emitterAddr}/${sequence}`;

  console.log(`Fetching VAA from: ${url}`);

  try {
    const response = await axios.get(url);
    const vaaBase64 = response.data.vaaBytes;
    const vaaBytes = Buffer.from(vaaBase64, "base64");

    // Extract payload from VAA (simplified - proper parsing would use SDK)
    // VAA structure: version (1) + guardianSetIndex (4) + signatureCount (1) + signatures (66 * count)
    // + timestamp (4) + nonce (4) + emitterChain (2) + emitterAddress (32) + sequence (8) + consistencyLevel (1) + payload
    const signatureCount = vaaBytes[5];
    const bodyOffset = 6 + signatureCount * 66;
    const payloadOffset = bodyOffset + 51; // Skip body header
    const payload = vaaBytes.slice(payloadOffset).toString("utf8");

    return { vaaBytes, payload };
  } catch (error: any) {
    if (error.response?.status === 404) {
      console.log("VAA not yet available (guardians still signing)");
      return null;
    }
    throw error;
  }
}

/**
 * Get recent VAAs for an emitter from Wormholescan
 */
async function getRecentVAAs(
  emitterChain: number,
  emitterAddress: string,
  limit: number = 10
): Promise<Array<{ sequence: string; timestamp: string }>> {
  const emitterAddr = toWormholeEmitterAddress(emitterAddress);
  const url = `${WORMHOLESCAN_API}/api/v1/vaas/${emitterChain}/${emitterAddr}?pageSize=${limit}`;

  try {
    const response = await axios.get(url);
    return response.data.data.map((vaa: any) => ({
      sequence: vaa.sequence,
      timestamp: vaa.timestamp,
    }));
  } catch (error) {
    console.error("Error fetching recent VAAs:", error);
    return [];
  }
}

/**
 * Submit VAA to NEAR contract for Wormhole verification
 */
async function submitVaaToNear(vaaHex: string): Promise<string> {
  const config = loadConfig();

  const keyStore = new keyStores.InMemoryKeyStore();
  const keyPair = KeyPair.fromString(config.nearPrivateKey);
  await keyStore.setKey(config.nearNetwork, config.nearAccountId, keyPair);

  const near = await connect({
    networkId: config.nearNetwork,
    nodeUrl: config.nearNodeUrl,
    keyStore,
  });

  const account = await near.account(config.nearAccountId);

  console.log(`Submitting VAA to ${config.nearContractId} for Wormhole verification...`);
  console.log(`VAA size: ${vaaHex.length / 2} bytes`);

  const result = await account.functionCall({
    contractId: config.nearContractId,
    methodName: "submit_vaa",
    args: { vaa: vaaHex },
    gas: BigInt("300000000000000"), // 300 TGas
  });

  const txHash =
    result.transaction_outcome?.id || result.transaction?.hash || "unknown";
  console.log(`Transaction: ${txHash}`);

  return txHash;
}

/**
 * Legacy: Submit snapshot directly to NEAR contract (owner only, no Wormhole verification)
 */
async function submitToNear(snapshotJson: string): Promise<string> {
  const config = loadConfig();

  const keyStore = new keyStores.InMemoryKeyStore();
  const keyPair = KeyPair.fromString(config.nearPrivateKey);
  await keyStore.setKey(config.nearNetwork, config.nearAccountId, keyPair);

  const near = await connect({
    networkId: config.nearNetwork,
    nodeUrl: config.nearNodeUrl,
    keyStore,
  });

  const account = await near.account(config.nearAccountId);

  console.log(`Submitting snapshot directly to ${config.nearContractId} (legacy mode)...`);
  console.log(`Payload size: ${snapshotJson.length} bytes`);

  const result = await account.functionCall({
    contractId: config.nearContractId,
    methodName: "submit_snapshot",
    args: { snapshot_json: snapshotJson },
    gas: BigInt("300000000000000"), // 300 TGas
  });

  const txHash =
    result.transaction_outcome?.id || result.transaction?.hash || "unknown";
  console.log(`Transaction: ${txHash}`);

  return txHash;
}

/**
 * Relay a specific VAA by sequence number (with Wormhole verification)
 */
export async function relayVAA(sequence: string): Promise<string> {
  const config = loadConfig();

  console.log(`\nRelaying VAA sequence ${sequence}...`);

  const vaa = await fetchVAA(
    ARBITRUM_CHAIN_ID,
    config.emitterAddress,
    sequence
  );

  if (!vaa) {
    throw new Error("VAA not available yet");
  }

  console.log("VAA fetched successfully");
  console.log("Payload preview:", vaa.payload.substring(0, 100) + "...");

  // Submit full VAA to NEAR for on-chain Wormhole verification
  const vaaHex = vaa.vaaBytes.toString("hex");
  return await submitVaaToNear(vaaHex);
}

/**
 * Watch for new VAAs and relay them
 */
export async function watchAndRelay(): Promise<void> {
  const config = loadConfig();
  let lastSequence = "0";

  console.log("Starting VAA watcher...");
  console.log(`Emitter: ${config.emitterAddress}`);
  console.log(`NEAR contract: ${config.nearContractId}`);

  while (true) {
    try {
      const vaas = await getRecentVAAs(
        ARBITRUM_CHAIN_ID,
        config.emitterAddress,
        5
      );

      for (const vaa of vaas.reverse()) {
        if (BigInt(vaa.sequence) > BigInt(lastSequence)) {
          console.log(`\nNew VAA detected: sequence ${vaa.sequence}`);
          try {
            await relayVAA(vaa.sequence);
            lastSequence = vaa.sequence;
            console.log(`Successfully relayed sequence ${vaa.sequence}`);
          } catch (error) {
            console.error(`Failed to relay sequence ${vaa.sequence}:`, error);
          }
        }
      }
    } catch (error) {
      console.error("Error in watch loop:", error);
    }

    // Poll every 30 seconds
    await new Promise((resolve) => setTimeout(resolve, 30000));
  }
}

// CLI
if (import.meta.url === `file://${process.argv[1]}`) {
  const command = process.argv[2];
  const arg = process.argv[3];

  if (command === "relay" && arg) {
    relayVAA(arg)
      .then((txHash) => {
        console.log("\n=== Success ===");
        console.log("NEAR transaction:", txHash);
      })
      .catch((error) => {
        console.error("Error:", error);
        process.exit(1);
      });
  } else if (command === "watch") {
    watchAndRelay().catch(console.error);
  } else {
    console.log("Usage:");
    console.log("  npm run relay -- relay <sequence>  # Relay specific VAA");
    console.log("  npm run relay -- watch             # Watch and auto-relay");
  }
}
