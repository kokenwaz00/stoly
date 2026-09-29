const hre = require("hardhat");

async function main() {
  console.log("Deploying Stoly contracts...");

  // Get deployer account
  const [deployer] = await ethers.getSigners();
  console.log("Deploying contracts with account:", deployer.address);

  // TODO: Set these to your actual token address on Arbitrum
  // For Arbitrum Sepolia testnet, deploy a mock USDT first or use an existing test token
  const USDT_ADDRESS = process.env.USDT_ADDRESS || "0x"; // Replace with actual USDT
  const TABLE_2_OPEN_TIME = Math.floor(Date.now() / 1000) + 24 * 60 * 60; // 24 hours from now

  if (!USDT_ADDRESS || USDT_ADDRESS === "0x") {
    console.warn("WARNING: USDT_ADDRESS not set. Please set it in .env file.");
    console.warn("For Arbitrum Sepolia, you need to deploy a test USDT token first.");
    process.exit(1);
  }

  // Deploy Stoly contract
  const Stoly = await ethers.getContractFactory("Stoly");
  const stoly = await Stoly.deploy(USDT_ADDRESS, TABLE_2_OPEN_TIME);
  await stoly.waitForDeployment();

  const stolyAddress = await stoly.getAddress();
  console.log("Stoly contract deployed to:", stolyAddress);

  // Save deployment addresses
  const fs = require("fs");
  const path = require("path");

  const deploymentInfo = {
    network: hre.network.name,
    stoly: stolyAddress,
    usdt: USDT_ADDRESS,
    table2OpenTime: TABLE_2_OPEN_TIME,
    deployerAddress: deployer.address,
    deploymentBlockNumber: await ethers.provider.getBlockNumber(),
    timestamp: new Date().toISOString(),
  };

  const deploymentPath = path.join(__dirname, `../deployments/${hre.network.name}.json`);
  const dir = path.dirname(deploymentPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(deploymentPath, JSON.stringify(deploymentInfo, null, 2));
  console.log("Deployment info saved to:", deploymentPath);

  // Print instructions
  console.log("\n========== DEPLOYMENT SUCCESS ==========");
  console.log("Update your frontend with these values:");
  console.log(`STOLY_CONTRACT_ADDRESS = "${stolyAddress}"`);
  console.log(`USDT_TOKEN_ADDRESS = "${USDT_ADDRESS}"`);
  console.log("\nVerify contract:");
  console.log(`npx hardhat verify --network ${hre.network.name} ${stolyAddress} ${USDT_ADDRESS} ${TABLE_2_OPEN_TIME}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
