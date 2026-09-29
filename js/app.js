const LEVEL_THRESHOLDS = [0, 5, 15, 35, 70];
const LEVEL_LABELS = ["Уровень 1 (вход)", "Уровень 2", "Уровень 3", "Уровень 4", "Уровень 5"];
const TABLE_PRICE = { 1: 100, 2: 200 };
const TOTAL_TABLES = 10;
const OPEN_DELAY_MS = 24 * 60 * 60 * 1000;
const ADMIN_USER = "admin";
const ADMIN_PASS = "admin123";
const START_BALANCE = 5000;
const DB_KEY = "pyramid_tables_db_v3";

let db = loadDb();
let activeTable = 1;
let timeSpeed = 1;
let lastReal = Date.now();
let isAdmin = false;
let mode = "user";
let connectedWallet = null;
let connectedWalletName = localStorage.getItem("pyramid_wallet_name") || "";
let activeProvider = null;
const discoveredWallets = [];
const WALLET_INSTALL = [
  { name: "MetaMask", url: "https://metamask.io/download/" },
  { name: "Rabby", url: "https://rabby.io/" },
  { name: "Coinbase Wallet", url: "https://www.coinbase.com/wallet" }
];

function defaultDb() {
  return {
    wallets: {},
    purchases: [],
    openTables: [1],
    table2OpenAt: Date.now() + OPEN_DELAY_MS,
    nextId: 1,
    payoutLog: [],
    payouts: [],
    nextPayoutId: 1,
    simBase: Date.now(),
    simOffset: 0
  };
}

function loadDb() {
  try {
    const raw = localStorage.getItem(DB_KEY);
    if (!raw) return defaultDb();
    const d = JSON.parse(raw);
    if (!d.wallets || !d.purchases) return defaultDb();
    if (!d.payouts) d.payouts = [];
    if (!d.nextPayoutId) d.nextPayoutId = 1;
    return d;
  } catch (e) {
    return defaultDb();
  }
}

function saveDb() {
  localStorage.setItem(DB_KEY, JSON.stringify(db));
}

function simNow() {
  return db.simBase + db.simOffset;
}

function tickTime() {
  const real = Date.now();
  const delta = real - lastReal;
  lastReal = real;
  db.simOffset += delta * timeSpeed;
  const open = new Set(db.openTables);
  if (!open.has(2) && simNow() >= db.table2OpenAt) {
    db.openTables = [...open, 2];
    saveDb();
    toast("Стол 2 открыт");
  }
}

function priceOf(t) {
  return TABLE_PRICE[t] || 100 * t;
}

function shortAddr(a) {
  if (!a) return "";
  return a.slice(0, 6) + "…" + a.slice(-4);
}

function randomWallet() {
  const hex = "0123456789abcdef";
  let s = "0x";
  for (let i = 0; i < 40; i++) s += hex[Math.floor(Math.random() * 16)];
  return s;
}

function ensureWallet(addr) {
  addr = normalizeAddr(addr);
  if (!addr) return;
  if (!db.wallets[addr]) {
    db.wallets[addr] = { balance: START_BALANCE, createdAt: Date.now() };
  }
}

function formatWhen(ts) {
  try {
    return new Date(ts).toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "medium" });
  } catch (e) {
    return String(ts);
  }
}

function buysOnTable(t) {
  return db.purchases.filter((p) => p.tableId === t).length;
}

function currentLevel(t) {
  const buys = buysOnTable(t);
  let lvl = 1;
  for (let i = LEVEL_THRESHOLDS.length - 1; i >= 0; i--) {
    if (buys >= LEVEL_THRESHOLDS[i]) {
      lvl = i + 1;
      break;
    }
  }
  return lvl;
}

function progressToNext(t) {
  const buys = buysOnTable(t);
  const lvl = currentLevel(t);
  if (lvl >= 5) return { current: buys, need: 1, pct: 100 };
  const prev = LEVEL_THRESHOLDS[lvl - 1];
  const next = LEVEL_THRESHOLDS[lvl];
  const inLevel = buys - prev;
  const need = next - prev;
  return { current: inLevel, need, pct: Math.min(100, Math.round((inLevel / need) * 100)) };
}

function hasBoughtTable(wallet, tableId) {
  return db.purchases.some(
    (p) => p.wallet.toLowerCase() === wallet.toLowerCase() && p.tableId === tableId
  );
}

function toast(msg) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove("show"), 2600);
}

function formatCountdown(ms) {
  if (ms <= 0) return "00:00:00";
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return [h, m, sec].map((x) => String(x).padStart(2, "0")).join(":");
}

function distribute(buyer) {
  const earlier = db.purchases.filter(
    (p) => p.tableId === buyer.tableId && p.id !== buyer.id && p.entryLevel < buyer.entryLevel
  );
  if (!earlier.length) return 0;
  const share = buyer.fee / earlier.length;
  earlier.forEach((p) => {
    const to = normalizeAddr(p.wallet);
    p.received += share;
    ensureWallet(to);
    db.wallets[to].balance += share;
    const rec = {
      id: db.nextPayoutId++,
      at: Date.now(),
      tableId: buyer.tableId,
      from: normalizeAddr(buyer.wallet),
      to,
      amount: share,
      status: "зачислено"
    };
    db.payouts.unshift(rec);
    db.payoutLog.unshift(
      "#" + rec.id + " → " + shortAddr(to) + " +" + roundAmt(share) +
      " · стол " + buyer.tableId + " · авто"
    );
  });
  if (db.payouts.length > 300) db.payouts.length = 300;
  if (db.payoutLog.length > 100) db.payoutLog.pop();
  return buyer.fee;
}

function roundAmt(n) {
  return Math.round(n * 100) / 100;
}

function buy(wallet, tableId) {
  wallet = normalizeAddr(wallet);
  if (!wallet) {
    toast("Подключите кошелёк");
    return false;
  }
  if (!db.openTables.includes(tableId)) {
    toast("Стол закрыт");
    return false;
  }
  if (hasBoughtTable(wallet, tableId)) {
    toast("Этот кошелёк уже купил данный стол");
    return false;
  }
  ensureWallet(wallet);
  const fee = priceOf(tableId);
  if (db.wallets[wallet].balance < fee) {
    toast("Недостаточно средств на адресе (нужно " + fee + ")");
    return false;
  }

  db.wallets[wallet].balance -= fee;

  const entryLevel = currentLevel(tableId);
  const row = {
    id: db.nextId++,
    wallet,
    tableId,
    entryLevel,
    fee,
    received: 0
  };
  db.purchases.push(row);

  const paid = distribute(row);
  saveDb();

  const newLvl = currentLevel(tableId);
  toast(paid
    ? "Покупка прошла · выплаты автоматически зачислены на кошельки ранних"
    : shortAddr(wallet) + " −" + fee);
  if (newLvl > entryLevel) setTimeout(() => toast("Стол " + tableId + " → ур. " + newLvl), 600);
  return true;
}

function normalizeAddr(addr) {
  return addr ? String(addr).toLowerCase() : "";
}

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

function unbindProvider() {
  if (!activeProvider || !activeProvider.removeListener) {
    activeProvider = null;
    return;
  }
  try {
    activeProvider.removeListener("accountsChanged", onAccountsChanged);
    activeProvider.removeListener("chainChanged", onChainChanged);
    activeProvider.removeListener("disconnect", onProviderDisconnect);
  } catch (e) { /* ignore */ }
  activeProvider = null;
}

function bindProvider(provider) {
  unbindProvider();
  activeProvider = provider;
  if (!provider || !provider.on) return;
  provider.on("accountsChanged", onAccountsChanged);
  provider.on("chainChanged", onChainChanged);
  provider.on("disconnect", onProviderDisconnect);
}

function onAccountsChanged(accounts) {
  if (!accounts || !accounts.length) {
    disconnectWallet(true);
    return;
  }
  setConnectedAccount(accounts[0], connectedWalletName);
}

function onChainChanged() {
  renderAll();
}

function onProviderDisconnect() {
  disconnectWallet(true);
}

function setConnectedAccount(addr, name) {
  connectedWallet = normalizeAddr(addr);
  connectedWalletName = name || connectedWalletName || "Кошелёк";
  ensureWallet(connectedWallet);
  localStorage.setItem("pyramid_connected_wallet", connectedWallet);
  localStorage.setItem("pyramid_wallet_name", connectedWalletName);
  saveDb();
  renderAll();
}

async function connectWithProvider(wallet) {
  const provider = wallet.provider;
  const accounts = await provider.request({ method: "eth_requestAccounts" });
  if (!accounts || !accounts.length) throw new Error("Кошелёк не вернул адрес");
  bindProvider(provider);
  setConnectedAccount(accounts[0], wallet.info.name);
  closeWalletModal();
  toast("Подключён " + wallet.info.name);
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
        try {
          await connectWithProvider(w);
        } catch (err) {
          const msg = err && (err.message || err.code);
          if (err && err.code === 4001) toast("Подключение отклонено");
          else toast("Не удалось подключить: " + (msg || "ошибка"));
        }
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

function disconnectWallet(silent) {
  unbindProvider();
  connectedWallet = null;
  connectedWalletName = "";
  localStorage.removeItem("pyramid_connected_wallet");
  localStorage.removeItem("pyramid_wallet_name");
  if (!silent) toast("Кошелёк отключён");
  renderAll();
}

function safeWalletIcon(icon) {
  if (!icon || typeof icon !== "string") return "";
  if (icon.startsWith("data:image/") || icon.startsWith("https://")) return icon;
  return "";
}

async function restoreWallet() {
  const saved = localStorage.getItem("pyramid_connected_wallet");
  if (!saved) return;
  window.dispatchEvent(new Event("eip6963:requestProvider"));
  const wallets = listAvailableWallets();
  for (const w of wallets) {
    try {
      const accounts = await w.provider.request({ method: "eth_accounts" });
      const match = (accounts || []).find((a) => normalizeAddr(a) === normalizeAddr(saved));
      if (!match) continue;
      bindProvider(w.provider);
      connectedWalletName = localStorage.getItem("pyramid_wallet_name") || w.info.name || "";
      setConnectedAccount(match, connectedWalletName);
      return;
    } catch (e) { /* try next */ }
  }
  localStorage.removeItem("pyramid_connected_wallet");
  connectedWallet = null;
}

function escapeHtml(s) {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

function setHidden(el, hidden) {
  el.classList.toggle("hidden", hidden);
}

function renderTables(containerId, clickable) {
  tickTime();
  const grid = document.getElementById(containerId);
  grid.innerHTML = "";
  const openSet = new Set(db.openTables);
  for (let i = 1; i <= TOTAL_TABLES; i++) {
    const open = openSet.has(i);
    const btn = document.createElement("div");
    let cls = "table-btn";
    if (open) cls += " open";
    else if (i === 2) cls += " soon";
    if (i === activeTable) cls += " active";
    btn.className = cls;
    let status = open ? "открыт" : "закрыт";
    let extra = "";
    if (i === 2 && !open) {
      status = "скоро";
      extra = '<div class="t-timer">' + formatCountdown(db.table2OpenAt - simNow()) + "</div>";
    }
    btn.innerHTML =
      '<div class="t-num">Стол ' + i + "</div>" +
      '<div class="t-status">' + status + "</div>" + extra +
      (open || i === 2 ? '<div class="t-price">' + priceOf(i) + "</div>" : "");
    if (open && clickable) {
      btn.style.cursor = "pointer";
      btn.addEventListener("click", () => {
        activeTable = i;
        renderAll();
      });
    }
    grid.appendChild(btn);
  }
}

function renderLevels(id) {
  const list = document.getElementById(id);
  list.innerHTML = "";
  if (!db.openTables.includes(activeTable)) {
    list.innerHTML = '<p class="empty-p">Стол не открыт</p>';
    return;
  }
  const buys = buysOnTable(activeTable);
  const cur = currentLevel(activeTable);
  for (let i = 0; i < 5; i++) {
    const lvl = i + 1;
    let cls = "level";
    if (lvl < cur) cls += " done";
    else if (lvl === cur) cls += " current";
    else cls += " locked";
    let req = lvl === 1
      ? "Вход · получают выплаты с ур. 2–5"
      : "Нужно " + LEVEL_THRESHOLDS[i] + " покупок (" + buys + ")";
    let bar = "";
    if (lvl === cur && cur < 5) {
      const p = progressToNext(activeTable);
      req = "До ур. " + (cur + 1) + ": ещё " + (p.need - p.current) + " / " + p.need;
      bar =
        '<div class="bar-bg"><div class="bar-fill" style="width:' + p.pct +
        '%"></div></div><div class="bar-text">' + p.current + "/" + p.need + "</div>";
    } else if (lvl < cur) {
      bar = '<div class="bar-bg"><div class="bar-fill" style="width:100%"></div></div>';
    }
    const el = document.createElement("div");
    el.className = cls;
    el.innerHTML =
      '<div class="level-num">' + lvl + '</div><div class="level-info"><div class="level-title">' +
      LEVEL_LABELS[i] + '</div><div class="level-req">' + req + "</div>" + bar + "</div>";
    list.appendChild(el);
  }
}

function renderPlist(id) {
  const box = document.getElementById(id);
  const list = db.purchases.filter((p) => p.tableId === activeTable);
  if (!list.length) {
    box.innerHTML = '<span class="empty-p">Никого нет</span>';
    return;
  }
  box.innerHTML = list.map((p) => {
    const net = Math.round(p.received - p.fee);
    return (
      '<div class="pchip"><div class="pn">' + shortAddr(p.wallet) +
      '</div><div class="pm">ур.' + p.entryLevel + " · −" + p.fee +
      '</div><div class="' + (net >= 0 ? "pr" : "pm") + '">' +
      (net >= 0 ? "+" : "") + net + "</div></div>"
    );
  }).join("");
}

function renderWalletBar() {
  const info = document.getElementById("walletInfo");
  const conn = document.getElementById("connectBtn");
  const disc = document.getElementById("disconnectBtn");
  if (connectedWallet) {
    ensureWallet(connectedWallet);
    const bal = Math.round(db.wallets[connectedWallet].balance);
    info.className = "";
    info.innerHTML =
      (connectedWalletName ? '<div class="wname">' + escapeHtml(connectedWalletName) + "</div>" : "") +
      '<div class="addr">' + connectedWallet + '</div><div class="bal">Баланс адреса: ' + bal + "</div>";
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

function renderCabinet() {
  renderWalletBar();
  const wEl = document.getElementById("cabWallet");
  const emptyRow = '<tr><td colspan="5" style="color:var(--muted)">Пока пусто</td></tr>';
  if (!connectedWallet) {
    wEl.textContent = "Подключите кошелёк, чтобы видеть баланс и выплаты на ваш адрес.";
    document.getElementById("cabBal").textContent = "—";
    document.getElementById("cabIn").textContent = "—";
    document.getElementById("cabOut").textContent = "—";
    document.getElementById("cabPayouts").innerHTML = emptyRow;
    document.getElementById("cabBuys").innerHTML = '<tr><td colspan="4" style="color:var(--muted)">Пока пусто</td></tr>';
    return;
  }
  ensureWallet(connectedWallet);
  const mine = db.payouts.filter((p) => normalizeAddr(p.to) === connectedWallet);
  const buys = db.purchases.filter((p) => normalizeAddr(p.wallet) === connectedWallet);
  const incoming = mine.reduce((s, p) => s + p.amount, 0);
  const spent = buys.reduce((s, p) => s + p.fee, 0);
  wEl.innerHTML = "Адрес выплат: <span class=\"addr\">" + escapeHtml(connectedWallet) + "</span>";
  document.getElementById("cabBal").textContent = Math.round(db.wallets[connectedWallet].balance);
  document.getElementById("cabIn").textContent = roundAmt(incoming);
  document.getElementById("cabOut").textContent = spent;
  document.getElementById("cabPayouts").innerHTML = mine.length
    ? mine.map((p) =>
      "<tr><td>" + formatWhen(p.at) + "</td><td>" + p.tableId + "</td><td>" + shortAddr(p.from) +
      "</td><td>+" + roundAmt(p.amount) + '</td><td class="status-ok">' + escapeHtml(p.status) + "</td></tr>"
    ).join("")
    : emptyRow;
  document.getElementById("cabBuys").innerHTML = buys.length
    ? buys.map((p) =>
      "<tr><td>" + p.tableId + "</td><td>" + p.entryLevel + "</td><td>" + p.fee +
      "</td><td>" + roundAmt(p.received) + "</td></tr>"
    ).join("")
    : '<tr><td colspan="4" style="color:var(--muted)">Пока пусто</td></tr>';
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

function renderUser() {
  renderWalletBar();
  renderTables("uTables", true);
  renderLevels("uLevels");
  renderPlist("uList");
  const buys = buysOnTable(activeTable);
  const paid = db.purchases.filter((p) => p.tableId === activeTable).reduce((s, p) => s + p.received, 0);
  document.getElementById("uBuys").textContent = buys;
  document.getElementById("uLevel").textContent = db.openTables.includes(activeTable)
    ? currentLevel(activeTable)
    : "—";
  document.getElementById("uMelons").textContent = buys * priceOf(activeTable);
  document.getElementById("uPaid").textContent = Math.round(paid);
  document.getElementById("uTableTitle").textContent = activeTable;
  document.getElementById("uPrice").textContent = "= " + priceOf(activeTable);
  const open = db.openTables.includes(activeTable);
  document.getElementById("uBadge").textContent = open ? "открыт" : "ожидание";
  document.getElementById("uBadge").className = "badge" + (open ? "" : " wait");
  document.getElementById("uBuyForm").style.display = open ? "flex" : "none";
  document.getElementById("uBuyBtn").disabled = !connectedWallet;
}

function renderAdmin() {
  renderTables("aTables", true);
  renderLevels("aLevels");
  const volume = db.purchases.reduce((s, p) => s + p.fee, 0);
  const payout = db.purchases.reduce((s, p) => s + p.received, 0);
  document.getElementById("aTotal").textContent = db.purchases.length;
  document.getElementById("aWallets").textContent = Object.keys(db.wallets).length;
  document.getElementById("aOpen").textContent = db.openTables.length;
  document.getElementById("aVolume").textContent = volume;
  document.getElementById("aPayout").textContent = Math.round(payout);
  document.getElementById("aTableTitle").textContent = activeTable;

  document.getElementById("aAllBody").innerHTML =
    db.purchases.slice().reverse().map((p) =>
      "<tr><td>" + p.id + "</td><td>" + shortAddr(p.wallet) + "</td><td>" + p.tableId +
      "</td><td>" + p.entryLevel + "</td><td>" + p.fee + "</td><td>" + Math.round(p.received) + "</td></tr>"
    ).join("") || '<tr><td colspan="6" style="color:var(--muted)">Пусто</td></tr>';

  document.getElementById("aWalletBody").innerHTML =
    Object.entries(db.wallets).map(([addr, w]) => {
      const cnt = db.purchases.filter((p) => p.wallet === addr).length;
      return "<tr><td>" + shortAddr(addr) + "</td><td>" + Math.round(w.balance) + "</td><td>" + cnt + "</td></tr>";
    }).join("") || '<tr><td colspan="3" style="color:var(--muted)">Пусто</td></tr>';

  document.getElementById("aLog").innerHTML = db.payoutLog.length
    ? db.payoutLog.map((l) => "<div>" + escapeHtml(l) + "</div>").join("")
    : '<span class="empty-p">Нет транзакций</span>';
}

function renderAll() {
  const hc = document.getElementById("headerConnect");
  hc.textContent = connectedWallet ? shortAddr(connectedWallet) : "Кошелёк";
  if (mode === "user") renderUser();
  else if (mode === "admin") renderAdmin();
  else if (mode === "cabinet") renderCabinet();
}

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
  if (buy(connectedWallet, activeTable)) renderAll();
});

document.getElementById("aAdd5").addEventListener("click", () => {
  let n = 0;
  let t = 0;
  while (n < 5 && t < 30) {
    t++;
    const w = randomWallet();
    ensureWallet(w);
    if (buy(w, activeTable)) n++;
  }
  renderAll();
});

document.getElementById("aOpenT2").addEventListener("click", () => {
  if (db.openTables.includes(2)) {
    toast("Уже открыт");
    return;
  }
  db.table2OpenAt = simNow();
  saveDb();
  renderAll();
});

document.getElementById("aReset").addEventListener("click", () => {
  if (!confirm("Сбросить базу данных?")) return;
  db = defaultDb();
  disconnectWallet(true);
  saveDb();
  activeTable = 1;
  toast("БД сброшена");
  renderAll();
});

document.getElementById("aExport").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(db, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "pyramid-db.json";
  a.click();
});

document.querySelectorAll(".speed-bar button[data-speed]").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".speed-bar button[data-speed]").forEach((b) => b.classList.remove("on"));
    btn.classList.add("on");
    timeSpeed = Number(btn.dataset.speed);
    toast("Скорость ×" + timeSpeed);
  });
});

setInterval(() => {
  tickTime();
  if (mode === "user" || mode === "admin") renderAll();
}, 1000);
window.addEventListener("hashchange", applyRoute);
restoreWallet().then(applyRoute);
applyRoute();
