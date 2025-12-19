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
  console.log("Publishing to Wormhole with account:", signer.address);

  // Get consumer contract
  const consumer = await ethers.getContractAt("GoogleCertFunctionsConsumer", consumerAddress, signer);

  // Check if payload is available
  const [payload, timestamp] = await consumer.getLatestPayload();
  if (payload.length === 0) {
    console.error("ERROR: No payload available. Run 'npm run request-certs' first and wait for fulfillment.");
    process.exit(1);
  }

  console.log("Payload size:", payload.length, "bytes");
  console.log("Payload timestamp:", new Date(Number(timestamp) * 1000).toISOString());

  // Get Wormhole fee
  const fee = await consumer.getWormholeFee();
  console.log("Wormhole fee:", ethers.formatEther(fee), "ETH");

  // Publish to Wormhole
  console.log("\nPublishing to Wormhole...");
  const tx = await consumer.publishToWormhole({ value: fee });
  console.log("Transaction sent:", tx.hash);

  const receipt = await tx.wait();
  console.log("Transaction confirmed in block:", receipt?.blockNumber);

  // Parse the SnapshotPublished event
  const snapshotEvent = receipt?.logs.find((log: any) => {
    try {
      const parsed = consumer.interface.parseLog({ topics: log.topics as string[], data: log.data });
      return parsed?.name === "SnapshotPublished";
    } catch {
      return false;
    }
  });

  if (snapshotEvent) {
    const parsed = consumer.interface.parseLog({ 
      topics: snapshotEvent.topics as string[], 
      data: snapshotEvent.data 
    });
    const sequence = parsed?.args[0];
    console.log("\n✅ Published to Wormhole successfully!");
    console.log("Sequence number:", sequence.toString());
    console.log("\n📝 Next steps:");
    console.log("   1. Wait for Wormhole guardians to sign (~1 minute)");
    console.log("   2. Use the relayer to bridge to NEAR:");
    console.log(`      cd ../relayer && npm run relay -- relay ${sequence.toString()}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
