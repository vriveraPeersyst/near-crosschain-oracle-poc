import { ethers, network } from "hardhat";

// Wormhole Core addresses (checksummed)
const WORMHOLE_CORE_ADDRESSES: Record<string, string> = {
  arbitrum: "0xa5f208e072434bC67592E4C49C1B991BA79BCA46", // Mainnet
  arbitrumSepolia: "0x6b9C8671cdDC8dEab9c719bB87cBd3e782bA6a35", // Sepolia testnet (correct address)
};

async function main() {
  const networkName = network.name;
  const wormholeCore = WORMHOLE_CORE_ADDRESSES[networkName];

  if (!wormholeCore) {
    throw new Error(`No Wormhole Core address configured for network: ${networkName}`);
  }

  console.log(`Deploying GoogleCertEmitter to ${networkName}...`);
  console.log(`Using Wormhole Core at: ${wormholeCore}`);

  const [deployer] = await ethers.getSigners();
  console.log(`Deployer address: ${deployer.address}`);

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log(`Deployer balance: ${ethers.formatEther(balance)} ETH`);

  const GoogleCertEmitter = await ethers.getContractFactory("GoogleCertEmitter");
  const emitter = await GoogleCertEmitter.deploy(wormholeCore);

  await emitter.waitForDeployment();

  const address = await emitter.getAddress();
  console.log(`GoogleCertEmitter deployed to: ${address}`);

  // Save deployment info
  console.log("\n--- Deployment Info ---");
  console.log(`Network: ${networkName}`);
  console.log(`Contract: ${address}`);
  console.log(`Wormhole Core: ${wormholeCore}`);
  console.log(`Owner: ${deployer.address}`);
  console.log("\nTo verify on Arbiscan:");
  console.log(`npx hardhat verify --network ${networkName} ${address} ${wormholeCore}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
