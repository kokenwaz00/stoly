require('dotenv').config();
const hre = require('hardhat');

async function main() {
  const RPC = process.env.RPC_URL || '';
  const USDT = process.env.USDT_TOKEN_ADDRESS;
  const TABLE2_OPEN = process.env.TABLE2_OPEN_TIME ? parseInt(process.env.TABLE2_OPEN_TIME) : Math.floor(Date.now() / 1000) + 24 * 3600;

  if (!USDT) {
    console.error('Missing USDT_TOKEN_ADDRESS in .env');
    process.exit(1);
  }

  console.log('Network RPC:', RPC || '(use hardhat network)');
  console.log('USDT token:', USDT);
  console.log('Table 2 open timestamp:', TABLE2_OPEN);

  // Make sure contracts are compiled
  await hre.run('compile');

  const Stoly = await hre.ethers.getContractFactory('Stoly');
  console.log('Deploying Stoly...');
  const stoly = await Stoly.deploy(USDT, TABLE2_OPEN);
  await stoly.deployed();

  console.log('Stoly deployed to:', stoly.address);
  console.log('\nUpdate your js/app.js STOLY_CONTRACT_ADDRESS with this address and redeploy frontend.');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
