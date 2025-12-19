import { ethers } from "hardhat";
import * as dotenv from "dotenv";

dotenv.config();

// Chainlink Functions Router on Arbitrum Sepolia
// See: https://docs.chain.link/chainlink-functions/supported-networks
const FUNCTIONS_ROUTER_ARBITRUM_SEPOLIA = "0x234a5fb5Bd614a7AA2FfAB244D603abFA0Ac5C5C";

// Wormhole Core on Arbitrum Sepolia
const WORMHOLE_CORE_ARBITRUM_SEPOLIA = "0x6b9C8671cdDC8dEab9c719bB87cBd3e782bA6a35";

// DON ID for Arbitrum Sepolia (must be bytes32)
// "fun-arbitrum-sepolia-1" -> bytes32
const DON_ID_STRING = "fun-arbitrum-sepolia-1";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying GoogleCertFunctionsConsumer with account:", deployer.address);

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log("Account balance:", ethers.formatEther(balance), "ETH");

  // Get configuration from env
  const subscriptionId = process.env.SUBSCRIPTION_ID;
  if (!subscriptionId) {
    console.error("ERROR: SUBSCRIPTION_ID not set in .env");
    console.log("\nTo create a subscription:");
    console.log("1. Go to https://functions.chain.link/arbitrum-sepolia");
    console.log("2. Connect your wallet");
    console.log("3. Create a new subscription");
    console.log("4. Fund it with LINK tokens");
    console.log("5. Add the consumer address after deployment");
    process.exit(1);
  }

  const functionsRouter = process.env.FUNCTIONS_ROUTER || FUNCTIONS_ROUTER_ARBITRUM_SEPOLIA;
  const wormholeCore = process.env.WORMHOLE_CORE || WORMHOLE_CORE_ARBITRUM_SEPOLIA;

  // Convert DON ID string to bytes32
  const donIdBytes32 = ethers.encodeBytes32String(DON_ID_STRING);
  console.log("\nDeployment parameters:");
  console.log("  Functions Router:", functionsRouter);
  console.log("  Wormhole Core:", wormholeCore);
  console.log("  DON ID:", DON_ID_STRING, "->", donIdBytes32);
  console.log("  Subscription ID:", subscriptionId);

  // Deploy the contract
  const GoogleCertFunctionsConsumer = await ethers.getContractFactory("GoogleCertFunctionsConsumer");
  const consumer = await GoogleCertFunctionsConsumer.deploy(
    functionsRouter,
    wormholeCore,
    donIdBytes32,
    BigInt(subscriptionId)
  );

  await consumer.waitForDeployment();
  const consumerAddress = await consumer.getAddress();

  console.log("\n✅ GoogleCertFunctionsConsumer deployed to:", consumerAddress);
  console.log("\n⚠️  IMPORTANT: Add this consumer to your Chainlink Functions subscription!");
  console.log("   1. Go to https://functions.chain.link/arbitrum-sepolia");
  console.log("   2. Select subscription", subscriptionId);
  console.log("   3. Add Consumer:", consumerAddress);
  console.log("\n📝 Next steps:");
  console.log("   1. Set CONSUMER_ADDRESS=" + consumerAddress + " in .env");
  console.log("   2. Run: npm run set-source");
  console.log("   3. Run: npm run request-certs");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
