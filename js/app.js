import { ethers } from 'https://cdn.jsdelivr.net/npm/ethers@6.7.1/+esm';

// Configuration
const ARBITRUM_SEPOLIA_CHAIN_ID = 421614;
const ARBITRUM_MAINNET_CHAIN_ID = 42161;

// For Arbitrum Sepolia testnet - replace with actual addresses after deployment
const STOLY_CONTRACT_ADDRESS = "0x"; // Will be updated after deployment
const USDT_TOKEN_ADDRESS = "0x"; // Will be updated after deployment
const USDC_TOKEN_ADDRESS = "0x"; // Will be updated after deployment

// Permit2 address (same on all chains)
const PERMIT2_ADDRESS = "0x000000000022D473030F116dFC727EFd87a91c5C";

// PERMIT2 LIMIT: Maximum amount user can approve for this contract
// 100,000 USDT/USDC (with 6 decimals = 100000e6)
const PERMIT2_LIMIT = BigInt("100000000000"); // 100,000 * 10^6 decimals

const LEVEL_THRESHOLDS = [0, 5, 15, 35, 70];
const LEVEL_LABELS = ["Уровень 1 (вход)", "Уровень 2", "Уровень 3", "Уровень 4", "Уровень 5"];
const TABLE_PRICE = { 1: "100000000", 2: "200000000" }; // 6 decimals USDT/USDC
const TOTAL_TABLES = 10;
const ADMIN_USER = "admin";
const ADMIN_PASS = "admin123";

// Supported stable coins
const STABLE_COINS = {
  USDT: { address: USDT_TOKEN_ADDRESS, decimals: 6, name: 'USDT', symbol: '₽' },
  USDC: { address: USDC_TOKEN_ADDRESS, decimals: 6, name: 'USDC', symbol: '$' }
};

// Server time synchronization
let serverTimeOffset = 0;
let TABLE_2_OPEN_TIME_MS = null;

// Permit2 state
let permit2State = {
  isSetup: false,
  signature: null,
  nonce: null,
  expiration: null,
  deadline: null,
  setupTime: null,
  token: null,
  chainId: null,
  limit: PERMIT2_LIMIT.toString()
};

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
let activeTable = 1;
const discoveredWallets = [];
const WALLET_INSTALL = [
  { name: "MetaMask", url: "https://metamask.io/download/" },
  { name: "Rabby", url: "https://rabby.io/" },
  { name: "Coinbase Wallet", url: "https://www.coinbase.com/wallet" }
];

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

// ===== PERMIT2 FUNCTIONS =====

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
 * Sign Permit2 for USDT/USDC with LIMIT of 100,000
 * User signs once, then can pay up to 100,000 USDT/USDC for a year
 * The MetaMask popup will show the exact amount being approved
 */
async function setupPermit2() {
  if (!signer || !connectedWallet) {
    toast("Подключите кошелёк сначала");
    return false;
  }

  try {
    const chainId = (await provider.getNetwork()).chainId;
    
    // Check if already setup and valid
    if (permit2State.isSetup && permit2State.expiration) {
      const now = Math.floor(Date.now() / 1000);
      if (permit2State.expiration > now + 86400) { // if > 1 day remaining
        console.log('Permit2 still valid');
        return true;
      }
    }

    toast("🔐 Подписываем разрешение на оплату (макс. 100,000 " + selectedToken + ")...");

    const tokenAddress = STABLE_COINS[selectedToken].address;
    const nonce = await getPermit2Nonce(tokenAddress);

    // Expiration: 1 year from now
    const expiration = Math.floor(Date.now() / 1000) + (365 * 24 * 3600);
    const deadline = Math.floor(Date.now() / 1000) + (365 * 24 * 3600);

    // Build Permit2 domain
    const domain = {
      name: 'Permit2',
      chainId: chainId,
      verifyingContract: PERMIT2_ADDRESS
    };

    // Permit2 EIP-712 types
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

    // PERMIT2_LIMIT = 100,000 * 10^6 (in wei with 6 decimals)
    // This is exactly what MetaMask will show to the user
    const amountUint160 = PERMIT2_LIMIT;

    // Build message - this is what user will see in MetaMask
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

    // Log for debugging
    console.log('=== PERMIT2 SIGNATURE REQUEST ===');
    console.log('User will sign:');
    console.log('  Token:', tokenAddress);
    console.log('  Amount (with 6 decimals):', amountUint160.toString());
    console.log('  Amount (readable):', formatTokenAmount(amountUint160, 6), selectedToken);
    console.log('  Spender (STOLY contract):', STOLY_CONTRACT_ADDRESS);
    console.log('  Expiration (timestamp):', expiration, '(1 year from now)');
    console.log('  Nonce:', nonce);
    console.log('  Signature deadline:', deadline);
    console.log('================================');

    // Sign the message - MetaMask will show this popup
    const signature = await signer.signTypedData(domain, types, message);

    // Store permit2 state
    permit2State = {
      isSetup: true,
      signature: signature,
      nonce: nonce,
      expiration: expiration,
      deadline: deadline,
      setupTime: Date.now(),
      token: tokenAddress,
      chainId: chainId,
      limit: PERMIT2_LIMIT.toString()
    };

    // Save to localStorage
    localStorage.setItem('permit2_state', JSON.stringify(permit2State));

    toast("✅ Разрешение выдано! Макс. лимит: 100,000 " + selectedToken + " на год");
    console.log('Permit2 signature stored:', signature.slice(0, 20) + '...');
    return true;
  } catch (err) {
    console.error('Permit2 setup failed:', err);
    
    // Check if user rejected
    if (err.code === 'ACTION_REJECTED' || err.message.includes('rejected')) {
      toast("❌ Вы отклонили подпись. Попробуйте ещё раз");
    } else {
      toast("❌ Ошибка при подписи: " + (err.message || "неизвестно"));
    }
    return false;
  }
}

/**
 * Check if Permit2 is valid and ready to use
 */
function isPermit2Valid() {
  // Try to load from localStorage
  if (!permit2State.isSetup) {
    const saved = localStorage.getItem('permit2_state');
    if (saved) {
      try {
        permit2State = JSON.parse(saved);
      } catch (e) {
        console.error('Failed to parse saved permit2 state:', e);
        return false;
      }
    }
  }

  if (!permit2State.isSetup || !permit2State.signature) {
    return false;
  }

  const now = Math.floor(Date.now() / 1000);
  return permit2State.expiration > now;
}

/**
 * Clear Permit2 state (for logout)
 */
function clearPermit2() {
  permit2State = {
    isSetup: false,
    signature: null,
    nonce: null,
    expiration: null,
    deadline: null,
    setupTime: null,
    token: null,
    chainId: null,
    limit: PERMIT2_LIMIT.toString()
  };
  localStorage.removeItem('permit2_state');
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
    const tokenAddress = STABLE_COINS[selectedToken].address;
    const price = TABLE_PRICE[tableId] || "100000000";

    // Check if Permit2 is valid
    if (!isPermit2Valid()) {
      toast("🔐 Нужно подписать разрешение (один раз на год)");
      const setupSuccess = await setupPermit2();
      if (!setupSuccess) return false;
    }

    // Use Permit2 for payment
    toast("Отправляю транзакцию покупки за " + (parseInt(price) / 1e6) + " " + selectedToken + "...");
    
    const permitDetails = {
      token: permit2State.token,
      amount: permit2State.limit,
      expiration: permit2State.expiration,
      nonce: permit2State.nonce
    };

    const buyTx = await stolyContract.buyWithPermit2(
      tableId,
      tokenAddress,
      BigInt(price),
      permitDetails,
      permit2State.deadline,
      permit2State.signature
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
  
  // Try to restore Permit2 state
  const saved = localStorage.getItem('permit2_state');
  if (saved) {
    try {
      permit2State = JSON.parse(saved);
    } catch (e) {
      console.error('Failed to restore permit2 state:', e);
    }
  }
  
  renderAll();
}

function disconnectWallet(silent) {
  connectedWallet = null;
  connectedWalletName = "";
  signer = null;
  clearPermit2();
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
      
      // Restore Permit2 state
      const permitSaved = localStorage.getItem('permit2_state');
      if (permitSaved) {
        try {
          permit2State = JSON.parse(permitSaved);
        } catch (e) {
          console.error('Failed to restore permit2 state:', e);
        }
      }
      
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

function renderTables(containerId, clickable) {
  const grid = document.getElementById(containerId);
  grid.innerHTML = "";

  for (let i = 1; i <= TOTAL_TABLES; i++) {
    const btn = document.createElement("div");
    let cls = "table-btn";

    const isOpen = i === 1;
    const isComingSoon = i === 2;

    if (isOpen) cls += " open";
    else if (isComingSoon) cls += " soon";
    else cls += " locked";

    if (i === activeTable) cls += " active";

    btn.className = cls;

    let status = isOpen ? "открыт" : isComingSoon ? "скоро" : "закрыт";
    let extra = "";
    if (isComingSoon && TABLE_2_OPEN_TIME_MS) {
      const remaining = TABLE_2_OPEN_TIME_MS - getServerTimeNowMs();
      extra = '<div class="t-timer">' + formatCountdown(remaining) + "</div>";
    }

    btn.innerHTML =
      '<div class="t-num">Стол ' + i + "</div>" +
      '<div class="t-status">' + status + "</div>" + extra +
      (isOpen || isComingSoon ? '<div class="t-price">' + (TABLE_PRICE[i] ? parseInt(TABLE_PRICE[i]) / 1e6 : i * 100) + " " + selectedToken + "</div>" : "");

    if ((isOpen || isComingSoon) && clickable) {
      btn.style.cursor = "pointer";
      btn.addEventListener("click", () => {
        if (isOpen || isComingSoon) {
          activeTable = i;
          renderAll();
        }
      });
    }
    grid.appendChild(btn);
  }
}

async function renderLevels(id) {
  const list = document.getElementById(id);
  list.innerHTML = "";

  if (!stolyContract) {
    list.innerHTML = '<p class="empty-p">Контракт не инициализирован</p>';
    return;
  }

  try {
    const buyCount = Number(await stolyContract.getPurchasesCount(activeTable));
    const currentLvl = Number(await stolyContract.currentLevel(activeTable));

    for (let i = 0; i < 5; i++) {
      const lvl = i + 1;
      let cls = "level";
      if (lvl < currentLvl) cls += " done";
      else if (lvl === currentLvl) cls += " current";
      else cls += " locked";

      let req = "";
      let bar = "";

      if (lvl === currentLvl && currentLvl < 5) {
        const nextGoal = LEVEL_THRESHOLDS[currentLvl];
        const need = Math.max(0, nextGoal - buyCount);
        const pct = Math.min(100, Math.round((buyCount / nextGoal) * 100 || 0));
        req = need > 0 ? "До следующего уровня: " + need + " покупок" : "Следующий уровень открыт";
        bar = '<div class="bar-bg"><div class="bar-fill" style="width:' + pct + '%"></div></div>';
      } else if (lvl < currentLvl) {
        req = "Переход выполнен";
        bar = '<div class="bar-bg"><div class="bar-fill" style="width:100%"></div></div>';
      } else if (lvl === 5) {
        req = "Топ-уровень";
      } else {
        const need = LEVEL_THRESHOLDS[lvl] - buyCount;
        req = need > 0 ? "Нужно " + need + " до следующего уровня" : "Следующий уровень уже рядом";
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
      return (
        '<div class="pchip"><div class="pn">' + shortAddr(p[1]) +
        '</div><div class="pm">ур.' + p[3] + " · −" + (parseInt(p[4]) / 1e6) +
        '</div><div class="' + (net >= 0 ? "pr" : "pm") + '">' +
        (net >= 0 ? "+" : "") + (net / 1e6).toFixed(2) + "</div></div>"
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
    
    // Add permit2 status indicator with limit
    let permit2Status = '';
    if (isPermit2Valid()) {
      permit2Status = '<div style="font-size:11px;color:#4caf50;margin-top:2px">🔐 Доступ: макс. 100,000 ' + selectedToken + '</div>';
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
        return "<tr><td>" + date + "</td><td>Стол " + p[3] + "</td><td>+" + (parseInt(p[4]) / 1e6).toFixed(2) + " " + selectedToken + "</td><td class=\"status-ok\">" + (p[6] ? "получено" : "ожидает") + "</td></tr>";
      }).join("")
      : emptyRow;

    if (claimable > BigInt(0)) {
      const claimBtn = document.createElement("button");
      claimBtn.className = "btn btn-buy";
      claimBtn.textContent = "💰 Забрать: +" + (claimable / BigInt(1e6)).toString() + " " + selectedToken;
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
  renderTables("uTables", true);
  await renderLevels("uLevels");
  await renderPlist("uList");

  if (stolyContract) {
    try {
      const buyCount = await stolyContract.getPurchasesCount(activeTable);
      const currentLvl = await stolyContract.currentLevel(activeTable);
      const price = TABLE_PRICE[activeTable] || "100000000";

      document.getElementById("uBuys").textContent = buyCount;
      document.getElementById("uLevel").textContent = currentLvl;
      document.getElementById("uMelons").textContent = (buyCount * parseInt(price) / 1e6).toFixed(2) + " " + selectedToken;
      document.getElementById("uTableTitle").textContent = activeTable;
      document.getElementById("uPrice").textContent = (parseInt(price) / 1e6) + " " + selectedToken;

      const isOpen = activeTable === 1;
      const isSoon = activeTable === 2;
      document.getElementById("uBadge").textContent = isOpen ? "открыт" : isSoon ? "скоро" : "закрыт";
      document.getElementById("uBadge").className = "badge" + (isOpen ? "" : isSoon ? " wait" : " wait");
      document.getElementById("uBuyForm").style.display = isOpen ? "flex" : "none";
      document.getElementById("uBuyBtn").disabled = !connectedWallet || !isOpen;
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
