import { ethers } from "hardhat";
import * as dotenv from "dotenv";

dotenv.config();

// Chainlink Automation Registrar addresses
// See: https://docs.chain.link/chainlink-automation/overview/supported-networks
const AUTOMATION_REGISTRAR_ADDRESSES: Record<string, string> = {
  "arbitrumSepolia": "0x881918E24290084409DaA91979A30e6f0dB52DB3",
  "arbitrum": "0x37D9dC70bfcd8BC77Ec2858836B923c560E891D1",
};

const LINK_TOKEN_ADDRESSES: Record<string, string> = {
  "arbitrumSepolia": "0xb1D4538B4571d411F07960EF2838Ce337FE1E80E",
  "arbitrum": "0xf97f4df75117a78c1A5a0DBb814Af92458539FB4",
};

async function main() {
  const consumerAddress = process.env.CONSUMER_ADDRESS;
  if (!consumerAddress) {
    console.error("ERROR: CONSUMER_ADDRESS not set in .env");
    process.exit(1);
  }

  const network = await ethers.provider.getNetwork();
  const networkName = network.name === "unknown" ? "arbitrumSepolia" : network.name;
  
  console.log("=".repeat(60));
  console.log("Chainlink Automation Registration Helper");
  console.log("=".repeat(60));
  console.log("\nNetwork:", networkName);
  console.log("Consumer Contract:", consumerAddress);

  const [signer] = await ethers.getSigners();
  console.log("Your Address:", signer.address);

  // Get consumer contract to check automation status
  const consumer = await ethers.getContractAt("GoogleCertFunctionsConsumer", consumerAddress, signer);
  
  const automationStatus = await consumer.getAutomationStatus();
  console.log("\n📊 Current Automation Status:");
  console.log("   Enabled:", automationStatus.enabled);
  console.log("   Interval:", automationStatus.interval.toString(), "seconds");
  console.log("   Last Update:", automationStatus.lastUpdate.toString() === "0" 
    ? "Never" 
    : new Date(Number(automationStatus.lastUpdate) * 1000).toISOString());

  console.log("\n" + "=".repeat(60));
  console.log("📋 MANUAL REGISTRATION STEPS");
  console.log("=".repeat(60));
  
  console.log(`
To register your contract for Chainlink Automation:

1. Go to the Chainlink Automation App:
   https://automation.chain.link/arbitrum-sepolia

2. Click "Register new Upkeep"

3. Select "Custom logic" as the trigger

4. Enter your contract address:
   ${consumerAddress}

5. Configure the upkeep:
   - Name: Google Cert Fetcher (or any name you prefer)
   - Gas limit: 500000 (recommended for Chainlink Functions)
   - Starting balance: At least 5 LINK (for Arbitrum Sepolia)

6. Fund the upkeep with LINK tokens

7. Complete the registration

LINK Token Address (${networkName}):
${LINK_TOKEN_ADDRESSES[networkName] || "Check docs.chain.link for the correct address"}

Automation Registrar (${networkName}):
${AUTOMATION_REGISTRAR_ADDRESSES[networkName] || "Check docs.chain.link for the correct address"}
`);

  console.log("=".repeat(60));
  console.log("🔧 CONFIGURATION OPTIONS");
  console.log("=".repeat(60));
  
  console.log(`
After registration, you can configure the automation:

// Change update interval (default: 1 hour = 3600 seconds)
npx hardhat run --network ${networkName} -e "
  const consumer = await ethers.getContractAt('GoogleCertFunctionsConsumer', '${consumerAddress}');
  await consumer.setUpdateInterval(3600); // 1 hour in seconds
"

// Disable automation temporarily
npx hardhat run --network ${networkName} -e "
  const consumer = await ethers.getContractAt('GoogleCertFunctionsConsumer', '${consumerAddress}');
  await consumer.setAutomationEnabled(false);
"

// Re-enable automation
npx hardhat run --network ${networkName} -e "
  const consumer = await ethers.getContractAt('GoogleCertFunctionsConsumer', '${consumerAddress}');
  await consumer.setAutomationEnabled(true);
"
`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
