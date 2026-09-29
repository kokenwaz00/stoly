const hre = require("hardhat");

async function main() {
  console.log("Deploying TestUSDT...");

  const [deployer] = await ethers.getSigners();
  console.log("Deploying with account:", deployer.address);

  // Deploy TestUSDT
  const TestUSDT = await ethers.getContractFactory("TestUSDT");
  const testUSDT = await TestUSDT.deploy();
  await testUSDT.waitForDeployment();

  const testUSDTAddress = await testUSDT.getAddress();
  console.log("TestUSDT deployed to:", testUSDTAddress);

  // Get initial balance
  const balance = await testUSDT.balanceOf(deployer.address);
  console.log("Initial balance:", ethers.formatUnits(balance, 6), "USDT");

  // Save deployment info
  const fs = require("fs");
  const path = require("path");

  const deploymentInfo = {
    network: hre.network.name,
    testUSDT: testUSDTAddress,
    deployerAddress: deployer.address,
    initialBalance: ethers.formatUnits(balance, 6),
    deploymentBlockNumber: await ethers.provider.getBlockNumber(),
    timestamp: new Date().toISOString(),
  };

  const deploymentPath = path.join(__dirname, `../deployments/${hre.network.name}-testusdt.json`);
  const dir = path.dirname(deploymentPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(deploymentPath, JSON.stringify(deploymentInfo, null, 2));
  console.log("Deployment info saved to:", deploymentPath);

  console.log("\n========== DEPLOYMENT SUCCESS ==========");
  console.log("Update your .env file:");
  console.log(`USDT_ADDRESS=${testUSDTAddress}`);
  console.log("\nNext step:");
  console.log("1. Update USDT_ADDRESS in .env");
  console.log("2. Run: npm run deploy:sepolia");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
