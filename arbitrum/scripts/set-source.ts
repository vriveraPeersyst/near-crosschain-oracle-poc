import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";

dotenv.config();

async function main() {
  const consumerAddress = process.env.CONSUMER_ADDRESS;
  if (!consumerAddress) {
    console.error("ERROR: CONSUMER_ADDRESS not set in .env");
    process.exit(1);
  }

  const [signer] = await ethers.getSigners();
  console.log("Setting source with account:", signer.address);

  // Read the minified source code from chainlink-functions/source.min.js
  const sourcePath = path.join(__dirname, "../../chainlink-functions/source.min.js");
  
  if (!fs.existsSync(sourcePath)) {
    // Fallback to non-minified version
    const altSourcePath = path.join(__dirname, "../../chainlink-functions/source.js");
    if (!fs.existsSync(altSourcePath)) {
      console.error("ERROR: Cannot find source.min.js or source.js");
      console.log("Expected at:", sourcePath);
      process.exit(1);
    }
  }

  const source = fs.readFileSync(sourcePath, "utf8");
  console.log("Source code loaded, size:", source.length, "bytes");

  // Get consumer contract
  const consumer = await ethers.getContractAt("GoogleCertFunctionsConsumer", consumerAddress, signer);

  // Set the source
  console.log("Setting source code on consumer contract...");
  const tx = await consumer.setSource(source);
  console.log("Transaction sent:", tx.hash);
  
  await tx.wait();
  console.log("✅ Source code set successfully!");

  // Verify
  const storedSourceHash = ethers.keccak256(ethers.toUtf8Bytes(await consumer.source()));
  const localSourceHash = ethers.keccak256(ethers.toUtf8Bytes(source));
  
  if (storedSourceHash === localSourceHash) {
    console.log("✅ Source verification passed");
  } else {
    console.error("❌ Source verification failed - hashes don't match");
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
