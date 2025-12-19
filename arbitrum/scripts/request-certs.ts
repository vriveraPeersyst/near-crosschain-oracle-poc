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
  console.log("Requesting certificates with account:", signer.address);

  // Get consumer contract
  const consumer = await ethers.getContractAt("GoogleCertFunctionsConsumer", consumerAddress, signer);

  // Check if source is set
  const source = await consumer.source();
  if (!source || source.length === 0) {
    console.error("ERROR: Source code not set. Run 'npm run set-source' first.");
    process.exit(1);
  }
  console.log("Source code is set, length:", source.length, "bytes");

  // Request certificates via Chainlink Functions
  console.log("\nRequesting Google certificates via Chainlink Functions...");
  const tx = await consumer.requestCertificates();
  console.log("Transaction sent:", tx.hash);

  const receipt = await tx.wait();
  console.log("Transaction confirmed in block:", receipt?.blockNumber);

  // Parse the RequestSent event
  const requestSentEvent = receipt?.logs.find((log: any) => {
    try {
      const parsed = consumer.interface.parseLog({ topics: log.topics as string[], data: log.data });
      return parsed?.name === "RequestSent";
    } catch {
      return false;
    }
  });

  if (requestSentEvent) {
    const parsed = consumer.interface.parseLog({ 
      topics: requestSentEvent.topics as string[], 
      data: requestSentEvent.data 
    });
    console.log("\n✅ Request sent successfully!");
    console.log("Request ID:", parsed?.args[0]);
    console.log("\n⏳ Waiting for Chainlink Functions to fulfill the request...");
    console.log("   This typically takes 1-2 minutes.");
    console.log("\n📝 Next steps:");
    console.log("   1. Wait for the RequestFulfilled event");
    console.log("   2. Check the payload: npx hardhat run scripts/check-payload.ts --network arbitrumSepolia");
    console.log("   3. Publish to Wormhole: npx hardhat run scripts/publish-wormhole.ts --network arbitrumSepolia");
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
