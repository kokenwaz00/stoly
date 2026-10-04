#!/usr/bin/env node
/*
  scripts/authorizeServer.js

  Usage:
    - Set environment variables OWNER_PRIVATE_KEY and STOLY_ADDRESS (contract address)
      e.g. export OWNER_PRIVATE_KEY="0x..."; export STOLY_ADDRESS="0x..."
    - Optionally set RPC_URL (defaults to the provided Pocket RPC)
      e.g. export RPC_URL="https://arb-one.api.pocket.network"
    - Run: node scripts/authorizeServer.js

  This script will call Stoly.authorizeServer(<ADMIN_ADDRESS>) from the OWNER account.
  It does NOT store any private keys in the repository. You must provide OWNER_PRIVATE_KEY
  locally (or via CI secrets). The script logs transaction hash and waits for mining.
*/

import 'dotenv/config';
import { ethers } from 'ethers';

const ADMIN_ADDRESS = '0x75c6320E7C562a3a27E1507203aD5cE5D4dFe7B7';
const DEFAULT_RPC = 'https://arb-one.api.pocket.network';

const RPC_URL = process.env.RPC_URL || DEFAULT_RPC;
const OWNER_PRIVATE_KEY = process.env.OWNER_PRIVATE_KEY;
const STOLY_ADDRESS = process.env.STOLY_ADDRESS; // required

if (!OWNER_PRIVATE_KEY) {
  console.error('ERROR: OWNER_PRIVATE_KEY is not set. Export it and retry.');
  console.error('Example: export OWNER_PRIVATE_KEY=0x...');
  process.exit(1);
}
if (!STOLY_ADDRESS) {
  console.error('ERROR: STOLY_ADDRESS is not set. Export it and retry.');
  console.error('Example: export STOLY_ADDRESS=0x...');
  process.exit(1);
}

const STOLY_ABI = [
  'function authorizeServer(address _server) external',
  'function whitelistedServers(address) view returns (bool)'
];

async function main() {
  console.log('RPC URL:', RPC_URL);
  console.log('Admin address to authorize:', ADMIN_ADDRESS);
  console.log('Stoly contract address:', STOLY_ADDRESS);

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const owner = new ethers.Wallet(OWNER_PRIVATE_KEY, provider);

  const stoly = new ethers.Contract(STOLY_ADDRESS, STOLY_ABI, owner);

  try {
    const already = await stoly.whitelistedServers(ADMIN_ADDRESS);
    console.log('Already whitelisted:', already);
    if (already) {
      console.log('No action needed. Exiting.');
      return;
    }

    console.log('Sending authorizeServer transaction...');
    const tx = await stoly.authorizeServer(ADMIN_ADDRESS);
    console.log('Tx sent:', tx.hash);
    const receipt = await tx.wait();
    console.log('Tx mined:', receipt.transactionHash);

    const ok = await stoly.whitelistedServers(ADMIN_ADDRESS);
    console.log('Now whitelisted:', ok);
  } catch (err) {
    console.error('Error while authorizing server:', err);
    process.exit(1);
  }
}

main();
