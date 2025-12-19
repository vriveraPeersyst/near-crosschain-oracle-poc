import { ethers } from "hardhat";
import * as dotenv from "dotenv";

dotenv.config();

async function main() {
  const consumerAddress = process.env.CONSUMER_ADDRESS;
  if (!consumerAddress) {
    console.error("ERROR: CONSUMER_ADDRESS not set in .env");
    process.exit(1);
  }

  const [signer] = await ethers.getSigners();

  // Get consumer contract
  const consumer = await ethers.getContractAt("GoogleCertFunctionsConsumer", consumerAddress, signer);

  // Check latest payload
  const [payload, timestamp] = await consumer.getLatestPayload();
  
  if (payload.length === 0) {
    console.log("❌ No payload available yet.");
    console.log("   Either no request was made, or the request hasn't been fulfilled.");
    console.log("\n   Check the last request status:");
    
    const lastRequestId = await consumer.s_lastRequestId();
    const lastResponse = await consumer.s_lastResponse();
    const lastError = await consumer.s_lastError();
    
    console.log("   Last Request ID:", lastRequestId);
    console.log("   Last Response length:", lastResponse.length, "bytes");
    console.log("   Last Error length:", lastError.length, "bytes");
    
    if (lastError.length > 0) {
      console.log("   Error message:", ethers.toUtf8String(lastError));
    }
    process.exit(1);
  }

  console.log("✅ Payload available!");
  console.log("   Size:", payload.length, "bytes");
  console.log("   Timestamp:", new Date(Number(timestamp) * 1000).toISOString());
  
  // Try to decode as UTF-8 and parse as JSON
  try {
    const decoded = ethers.toUtf8String(payload);
    const parsed = JSON.parse(decoded);
    console.log("\n📄 Parsed payload:");
    console.log("   Timestamp:", parsed.timestamp);
    console.log("   Key count:", parsed.count);
    console.log("   Keys:");
    for (const key of parsed.keys) {
      console.log(`     - ${key.kid}`);
      console.log(`       n: ${key.n.substring(0, 32)}...`);
      console.log(`       e: ${key.e}`);
    }
  } catch (e) {
    console.log("\n   Raw payload (hex):", ethers.hexlify(payload));
  }

  // Check Wormhole status
  const lastSequence = await consumer.lastWormholeSequence();
  if (lastSequence > 0n) {
    console.log("\n🌉 Last Wormhole sequence:", lastSequence.toString());
  } else {
    console.log("\n🌉 Not yet published to Wormhole");
    console.log("   Run: npx hardhat run scripts/publish-wormhole.ts --network arbitrumSepolia");
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
