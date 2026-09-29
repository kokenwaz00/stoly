import { ethers } from 'https://cdn.jsdelivr.net/npm/ethers@6.7.1/+esm';

// Configuration
const ARBITRUM_SEPOLIA_CHAIN_ID = 421614;
const ARBITRUM_MAINNET_CHAIN_ID = 42161;

// For Arbitrum Sepolia testnet - replace with actual addresses after deployment
const STOLY_CONTRACT_ADDRESS = "0x"; // Will be updated after deployment
const USDT_TOKEN_ADDRESS = "0x"; // Will be updated after deployment

const LEVEL_THRESHOLDS = [0, 5, 15, 35, 70];
const LEVEL_LABELS = ["Уровень 1 (вход)", "Уровень 2", "Уровень 3", "Уровень 4", "Уровень 5"];
const TABLE_PRICE = { 1: "100000000", 2: "200000000" }; // 6 decimals USDT
const TOTAL_TABLES = 10;
const ADMIN_USER = "admin";
const ADMIN_PASS = "admin123";

// Contract ABI (simplified)
const STOLY_ABI = [
  "function buy(uint256 _tableId) external",
  "function claim() external",
  "function getPrice(uint256 _tableId) external view returns (uint256)",
  "function currentLevel(uint256 _tableId) external view returns (uint256)",
  "function getPurchasesCount(uint256 _tableId) external view returns (uint256)",
  "function getPurchases(uint256 _tableId) external view returns (tuple(uint256, address, uint256, uint256, uint256, uint256)[])",
  "function getPayoutsCount() external view returns (uint256)",
  "function getPayouts() external view returns (tuple(uint256, address, address, uint256, uint256, uint256, bool)[])",
  "function claimableBalance(address) external view returns (uint256)",
  "function openTables(uint256) external view returns (bool)",
  "function hasBought(address, uint256) external view returns (bool)",
];

const USDT_ABI = [
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function allowance(address owner, address spender) external view returns (uint256)",
  "function balanceOf(address account) external view returns (uint256)",
];

let provider = null;
let signer = null;
let stolyContract = null;
let usdtContract = null;
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

// Wallet connection
async function connectWithProvider(wallet) {
  try {
    const eth = wallet.provider;
    const accounts = await eth.request({ method: "eth_requestAccounts" });
    
    if (!accounts || !accounts.length) throw new Error("Кошелёк не вернул адрес");
    
    // Check network
    const chainId = await eth.request({ method: "eth_chainId" });
    const chainIdNum = parseInt(chainId, 16);
    
    if (chainIdNum !== ARBITRUM_SEPOLIA_CHAIN_ID && chainIdNum !== ARBITRUM_MAINNET_CHAIN_ID) {
      toast("Пожалуйста, переключитесь на Arbitrum");
      return;
    }
    
    provider = new ethers.BrowserProvider(eth);
    signer = await provider.getSigner();
    stolyContract = new ethers.Contract(STOLY_CONTRACT_ADDRESS, STOLY_ABI, signer);
    usdtContract = new ethers.Contract(USDT_TOKEN_ADDRESS, USDT_ABI, signer);
    
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
  renderAll();
}

function disconnectWallet(silent) {
  connectedWallet = null;
  connectedWalletName = "";
  signer = null;
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
      usdtContract = new ethers.Contract(USDT_TOKEN_ADDRESS, USDT_ABI, signer);
      connectedWallet = match.address;
      connectedWalletName = localStorage.getItem("stoly_wallet_name") || "Кошелёк";
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

// Purchase function
async function buy(tableId) {
  if (!connectedWallet) {
    toast("Подключите кошелёк");
    return false;
  }

  if (!stolyContract || !usdtContract) {
    toast("Контракт не инициализирован");
    return false;
  }

  try {
    const price = TABLE_PRICE[tableId] || "100000000";
    
    // Check allowance
    const allowance = await usdtContract.allowance(connectedWallet, STOLY_CONTRACT_ADDRESS);
    
    if (allowance < BigInt(price)) {
      toast("Подтверждаю расход USDT...");
      const approveTx = await usdtContract.approve(STOLY_CONTRACT_ADDRESS, BigInt(price) * BigInt(10));
      await approveTx.wait();
      toast("Расход подтвержден");
    }

    toast("Отправляю транзакцию покупки...");
    const buyTx = await stolyContract.buy(tableId);
    const receipt = await buyTx.wait();
    
    if (receipt && receipt.status === 1) {
      toast("Покупка успешна! Выплаты отправлены участникам");
      await renderAll();
      return true;
    } else {
      toast("Транзакция отклонена");
      return false;
    }
  } catch (err) {
    const msg = err && (err.message || err.data?.message || err.reason || "Неизвестная ошибка");
    toast("Ошибка: " + msg.slice(0, 50));
    console.error(err);
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
      toast("Выплаты получены!");
      await renderAll();
      return true;
    } else {
      toast("Транзакция отклонена");
      return false;
    }
  } catch (err) {
    const msg = err && (err.message || err.data?.message || err.reason || "Неизвестная ошибка");
    toast("Ошибка: " + msg.slice(0, 50));
    console.error(err);
    return false;
  }
}

// Rendering functions
function renderTables(containerId, clickable) {
  const grid = document.getElementById(containerId);
  grid.innerHTML = "";
  
  for (let i = 1; i <= TOTAL_TABLES; i++) {
    const btn = document.createElement("div");
    let cls = "table-btn";
    
    // In blockchain version, all tables are accessible (open status depends on contract)
    cls += " open";
    if (i === activeTable) cls += " active";
    
    btn.className = cls;
    btn.innerHTML =
      '<div class="t-num">Стол ' + i + "</div>" +
      '<div class="t-status">открыт</div>' +
      '<div class="t-price">' + (TABLE_PRICE[i] ? TABLE_PRICE[i] / 1e6 : i * 100) + " USDT</div>";
    
    if (clickable) {
      btn.style.cursor = "pointer";
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
  list.innerHTML = "";
  
  if (!stolyContract) {
    list.innerHTML = '<p class="empty-p">Контракт не инициализирован</p>';
    return;
  }

  try {
    const buyCount = await stolyContract.getPurchasesCount(activeTable);
    const currentLvl = await stolyContract.currentLevel(activeTable);
    
    for (let i = 0; i < 5; i++) {
      const lvl = i + 1;
      let cls = "level";
      if (lvl < currentLvl) cls += " done";
      else if (lvl === currentLvl) cls += " current";
      else cls += " locked";
      
      let req = lvl === 1
        ? "Вход · получают выплаты с ур. 2–5"
        : "Нужно " + LEVEL_THRESHOLDS[i] + " покупок (" + buyCount + ")";
      
      let bar = "";
      if (lvl === currentLvl && currentLvl < 5 && LEVEL_THRESHOLDS[i + 1]) {
        const prev = LEVEL_THRESHOLDS[lvl - 1];
        const next = LEVEL_THRESHOLDS[lvl];
        const inLevel = buyCount - prev;
        const need = next - prev;
        const pct = Math.min(100, Math.round((inLevel / need) * 100));
        req = "До ур. " + (currentLvl + 1) + ": ещё " + (need - inLevel) + " / " + need;
        bar = '<div class="bar-bg"><div class="bar-fill" style="width:' + pct + '%"></div></div><div class="bar-text">' + inLevel + "/" + need + "</div>";
      } else if (lvl < currentLvl) {
        bar = '<div class="bar-bg"><div class="bar-fill" style="width:100%"></div></div>';
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
      const net = (parseInt(p[5]) - parseInt(p[4])); // received - fee
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
    info.innerHTML =
      (connectedWalletName ? '<div class="wname">' + escapeHtml(connectedWalletName) + "</div>" : "") +
      '<div class="addr">' + connectedWallet + '</div><div class="bal">Адрес подключен</div>';
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
  const emptyRow = '<tr><td colspan="5" style="color:var(--muted)">Пока пусто</td></tr>';
  
  if (!connectedWallet || !stolyContract || !usdtContract) {
    wEl.textContent = "Подключите кошелёк, чтобы видеть баланс и выплаты на ваш адрес.";
    document.getElementById("cabBal").textContent = "—";
    document.getElementById("cabIn").textContent = "—";
    document.getElementById("cabOut").textContent = "—";
    document.getElementById("cabPayouts").innerHTML = emptyRow;
    document.getElementById("cabBuys").innerHTML = '<tr><td colspan="4" style="color:var(--muted)">Пока пусто</td></tr>';
    return;
  }

  try {
    const balance = await usdtContract.balanceOf(connectedWallet);
    const claimable = await stolyContract.claimableBalance(connectedWallet);
    const allPayouts = await stolyContract.getPayouts();
    
    const mine = allPayouts.filter((p) => p[1].toLowerCase() === connectedWallet.toLowerCase());
    
    let incoming = BigInt(0);
    mine.forEach((p) => {
      incoming += BigInt(p[4]);
    });

    wEl.innerHTML = "Адрес выплат: <span class=\"addr\">" + escapeHtml(connectedWallet) + "</span>";
    document.getElementById("cabBal").textContent = (balance / BigInt(1e6)).toString();
    document.getElementById("cabIn").textContent = (incoming / BigInt(1e6)).toString();
    document.getElementById("cabOut").textContent = "—";
    
    document.getElementById("cabPayouts").innerHTML = mine.length
      ? mine.map((p) => {
        const date = new Date(parseInt(p[5]) * 1000).toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "medium" });
        return "<tr><td>" + date + "</td><td>" + p[3] + "</td><td>" + shortAddr(p[2]) +
          "</td><td>+" + (parseInt(p[4]) / 1e6).toFixed(2) + '</td><td class="status-ok">' + (p[6] ? "получено" : "ожидает") + "</td></tr>";
      }).join("")
      : emptyRow;
    
    // Button to claim
    const claimBtn = document.createElement("button");
    claimBtn.className = "btn btn-buy";
    claimBtn.textContent = "Забрать выплаты: +" + (claimable / BigInt(1e6)).toString() + " USDT";
    claimBtn.style.marginTop = "15px";
    if (claimable > BigInt(0)) {
      claimBtn.addEventListener("click", claim);
      document.getElementById("cabPayouts").parentElement.appendChild(claimBtn);
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
      document.getElementById("uMelons").textContent = (buyCount * parseInt(price) / 1e6).toFixed(2);
      document.getElementById("uPaid").textContent = "—";
      document.getElementById("uTableTitle").textContent = activeTable;
      document.getElementById("uPrice").textContent = "= " + (parseInt(price) / 1e6) + " USDT";
      document.getElementById("uBadge").textContent = "открыт";
      document.getElementById("uBadge").className = "badge";
      document.getElementById("uBuyForm").style.display = "flex";
      document.getElementById("uBuyBtn").disabled = !connectedWallet;
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

// Event listeners
document.getElementById("headerConnect").addEventListener("click", () => {
  if (connectedWallet) location.hash = "#/cabinet";
  else connectWallet();
});

document.getElementById("loginBtn").addEventListener("click", () => {
  const u = document.getElementById("loginUser").value.trim();
  const p = document.getElementById("loginPass").value;
  if (u === ADMIN_USER && p === ADMIN_PASS) {
    isAdmin = true;
    document.getElementById("loginPass").value = "";
    document.getElementById("loginErr").textContent = "";
    location.hash = "#/admin";
    applyRoute();
    toast("Вход выполнен");
  } else document.getElementById("loginErr").textContent = "Неверный логин или пароль";
});

document.getElementById("loginPass").addEventListener("keydown", (e) => {
  if (e.key === "Enter") document.getElementById("loginBtn").click();
});

document.getElementById("logoutBtn").addEventListener("click", () => {
  isAdmin = false;
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

setInterval(() => {
  if (mode === "user" || mode === "cabinet") renderAll();
}, 3000);

window.addEventListener("hashchange", applyRoute);

// Initialize on load
window.addEventListener("load", async () => {
  if (initializeWeb3()) {
    await restoreWallet();
  }
  applyRoute();
});
