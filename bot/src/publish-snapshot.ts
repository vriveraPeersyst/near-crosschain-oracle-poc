import axios from "axios";
import { ethers } from "ethers";
import "dotenv/config";

const GOOGLE_X509_URL =
  "https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com";

// ABI for GoogleCertEmitter - only the functions we need
const GoogleCertEmitterAbi = [
  "function publishGoogleSnapshot(bytes calldata payload) external payable returns (uint64 sequence)",
  "function getMessageFee() external view returns (uint256)",
  "function owner() external view returns (address)",
  "event SnapshotPublished(uint64 sequence, uint32 nonce, uint8 consistencyLevel)",
];

interface Config {
  arbitrumRpcUrl: string;
  privateKey: string;
  emitterAddress: string;
}

function loadConfig(): Config {
  const arbitrumRpcUrl = process.env.ARBITRUM_SEPOLIA_RPC_URL || process.env.ARBITRUM_RPC_URL;
  const privateKey = process.env.PRIVATE_KEY;
  const emitterAddress = process.env.EMITTER_ADDRESS;

  if (!arbitrumRpcUrl || !privateKey || !emitterAddress) {
    throw new Error(
      "Missing required env vars: ARBITRUM_SEPOLIA_RPC_URL (or ARBITRUM_RPC_URL), PRIVATE_KEY, EMITTER_ADDRESS"
    );
  }

  return { arbitrumRpcUrl, privateKey, emitterAddress };
}

export async function fetchGoogleCerts(): Promise<string> {
  console.log("Fetching Google certs from:", GOOGLE_X509_URL);
  const response = await axios.get(GOOGLE_X509_URL);
  const jsonString = JSON.stringify(response.data);
  console.log(`Fetched ${Object.keys(response.data).length} certificates`);
  return jsonString;
}

export async function publishSnapshot(): Promise<{
  txHash: string;
  sequence: bigint;
}> {
  const config = loadConfig();

  const provider = new ethers.JsonRpcProvider(config.arbitrumRpcUrl);
  const wallet = new ethers.Wallet(config.privateKey, provider);
  const emitter = new ethers.Contract(
    config.emitterAddress,
    GoogleCertEmitterAbi,
    wallet
  );

  console.log("Wallet address:", wallet.address);

  // Verify we're the owner
  const owner = await emitter.owner();
  if (owner.toLowerCase() !== wallet.address.toLowerCase()) {
    throw new Error(`Wallet ${wallet.address} is not the owner (${owner})`);
  }

  // Get the message fee
  let messageFee: bigint;
  try {
    messageFee = await emitter.getMessageFee();
    console.log("Wormhole message fee:", ethers.formatEther(messageFee), "ETH");
  } catch (e) {
    // Fallback if getMessageFee fails
    console.log("Could not fetch message fee, using default 0.001 ETH");
    messageFee = ethers.parseEther("0.001");
  }

  // Fetch Google certs
  const snapshotJson = await fetchGoogleCerts();
  const payload = ethers.toUtf8Bytes(snapshotJson);
  console.log("Payload size:", payload.length, "bytes");

  // Publish to Wormhole
  console.log("Publishing snapshot to Wormhole...");
  const tx = await emitter.publishGoogleSnapshot(payload, {
    value: messageFee,
  });

  console.log("Transaction sent:", tx.hash);
  const receipt = await tx.wait();
  console.log("Transaction confirmed in block:", receipt.blockNumber);

  // Parse the SnapshotPublished event
  const iface = new ethers.Interface(GoogleCertEmitterAbi);
  let sequence: bigint = BigInt(0);

  for (const log of receipt.logs) {
    try {
      const parsed = iface.parseLog({ topics: log.topics as string[], data: log.data });
      if (parsed && parsed.name === "SnapshotPublished") {
        sequence = parsed.args[0];
        console.log("Wormhole sequence:", sequence.toString());
        console.log("Nonce:", parsed.args[1].toString());
        break;
      }
    } catch {
      // Not our event
    }
  }

  return { txHash: tx.hash, sequence };
}

// CLI entry point
if (import.meta.url === `file://${process.argv[1]}`) {
  publishSnapshot()
    .then(({ txHash, sequence }) => {
      console.log("\n=== Success ===");
      console.log("Transaction:", txHash);
      console.log("Sequence:", sequence.toString());
      console.log("\nNext step: Wait for Wormhole guardians to sign the VAA");
      console.log(
        "Check: https://wormholescan.io (search for tx hash or emitter)"
      );
    })
    .catch((error) => {
      console.error("Error:", error);
      process.exit(1);
    });
}
