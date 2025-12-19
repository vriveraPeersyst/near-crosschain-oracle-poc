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
  console.log("Configuring automation with account:", signer.address);

  const consumer = await ethers.getContractAt("GoogleCertFunctionsConsumer", consumerAddress, signer);

  // Parse command line arguments
  const args = process.argv.slice(2);
  
  if (args.includes("--status")) {
    // Just show status
    const status = await consumer.getAutomationStatus();
    console.log("\n📊 Automation Status:");
    console.log("   Enabled:", status.enabled);
    console.log("   Interval:", status.interval.toString(), "seconds", `(${Number(status.interval) / 3600} hours)`);
    console.log("   Last Update:", status.lastUpdate.toString() === "0" 
      ? "Never" 
      : new Date(Number(status.lastUpdate) * 1000).toISOString());
    console.log("   Next Update:", status.lastUpdate.toString() === "0"
      ? "When automation triggers for the first time"
      : new Date(Number(status.nextUpdate) * 1000).toISOString());
    return;
  }

  if (args.includes("--enable")) {
    console.log("\n✅ Enabling automation...");
    const tx = await consumer.setAutomationEnabled(true);
    await tx.wait();
    console.log("Automation enabled!");
    return;
  }

  if (args.includes("--disable")) {
    console.log("\n⏸️  Disabling automation...");
    const tx = await consumer.setAutomationEnabled(false);
    await tx.wait();
    console.log("Automation disabled!");
    return;
  }

  const intervalIndex = args.indexOf("--interval");
  if (intervalIndex !== -1 && args[intervalIndex + 1]) {
    const intervalSeconds = parseInt(args[intervalIndex + 1]);
    if (isNaN(intervalSeconds) || intervalSeconds < 60) {
      console.error("ERROR: Interval must be a number >= 60 seconds");
      process.exit(1);
    }
    console.log(`\n⏱️  Setting update interval to ${intervalSeconds} seconds (${intervalSeconds / 3600} hours)...`);
    const tx = await consumer.setUpdateInterval(intervalSeconds);
    await tx.wait();
    console.log("Update interval set!");
    return;
  }

  // Show help
  console.log(`
📋 Automation Configuration Script

Usage:
  npx hardhat run scripts/configure-automation.ts --network arbitrumSepolia -- [options]

Options:
  --status              Show current automation status
  --enable              Enable automation
  --disable             Disable automation
  --interval <seconds>  Set update interval (minimum 60 seconds)

Examples:
  # Check status
  npx hardhat run scripts/configure-automation.ts --network arbitrumSepolia -- --status

  # Set 1 hour interval
  npx hardhat run scripts/configure-automation.ts --network arbitrumSepolia -- --interval 3600

  # Set 30 minute interval
  npx hardhat run scripts/configure-automation.ts --network arbitrumSepolia -- --interval 1800

  # Disable automation
  npx hardhat run scripts/configure-automation.ts --network arbitrumSepolia -- --disable
`);

  // Show current status anyway
  const status = await consumer.getAutomationStatus();
  console.log("📊 Current Automation Status:");
  console.log("   Enabled:", status.enabled);
  console.log("   Interval:", status.interval.toString(), "seconds", `(${Number(status.interval) / 3600} hours)`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
