const payoutFeed = [
  { user: '0xA3F2...', amount: 24.5, table: 'Стол 1', level: 'ур. 2' },
  { user: '0xB91C...', amount: 31.2, table: 'Стол 1', level: 'ур. 3' },
  { user: '0x7D1D...', amount: 18.7, table: 'Стол 1', level: 'ур. 2' },
  { user: '0xC9E1...', amount: 42.9, table: 'Стол 1', level: 'ур. 4' },
  { user: '0x42F0...', amount: 11.4, table: 'Стол 1', level: 'ур. 1' },
  { user: '0xE78A...', amount: 55.3, table: 'Стол 1', level: 'ур. 5' },
  { user: '0xD12A...', amount: 28.1, table: 'Стол 1', level: 'ур. 3' },
  { user: '0xF6BC...', amount: 20.6, table: 'Стол 1', level: 'ур. 2' },
  { user: '0x124D...', amount: 36.8, table: 'Стол 1', level: 'ур. 4' },
  { user: '0x98CE...', amount: 49.5, table: 'Стол 1', level: 'ур. 5' },
  { user: '0x5A2E...', amount: 14.9, table: 'Стол 1', level: 'ур. 2' },
  { user: '0xCC44...', amount: 63.2, table: 'Стол 1', level: 'ур. 5' }
];

const tickerTape = document.getElementById('tickerTape');
const livePayoutsFeed = document.getElementById('livePayoutsFeed');
const totalPayoutsEl = document.getElementById('totalPayouts');
const totalAmountEl = document.getElementById('totalAmount');

function timeStamp() {
  return new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

function buildTickerItems(items) {
  if (!tickerTape) return;

  const repeated = [...items, ...items];
  tickerTape.innerHTML = '';

  repeated.forEach((item) => {
    const el = document.createElement('div');
    el.className = 'ticker-item';
    el.innerHTML = `
      <span class="table">${item.table}</span>
      <span class="user">${item.user}</span>
      <span>получил</span>
      <span class="amount">+${item.amount.toFixed(1)} USDT</span>
      <span class="table">${item.level}</span>
    `;
    tickerTape.appendChild(el);
  });
}

function buildLiveFeed(items) {
  if (!livePayoutsFeed) return;

  livePayoutsFeed.innerHTML = '';
  items.slice(0, 8).forEach((item) => {
    const row = document.createElement('div');
    row.className = 'feed-row';
    row.innerHTML = `
      <span class="feed-time">${timeStamp()}</span>
      <span class="feed-user">${item.user}</span>
      <span class="feed-text">получил</span>
      <span class="feed-amount">+${item.amount.toFixed(1)} USDT</span>
      <span class="feed-level">${item.level}</span>
    `;
    livePayoutsFeed.appendChild(row);
  });
}

function updateStats(items) {
  if (!totalPayoutsEl || !totalAmountEl) return;

  totalPayoutsEl.textContent = String(items.length);
  const sum = items.reduce((acc, item) => acc + item.amount, 0);
  totalAmountEl.textContent = sum.toFixed(1);
}

function rotateFeed() {
  const next = [...payoutFeed.slice(1), payoutFeed[0]];
  payoutFeed.splice(0, payoutFeed.length, ...next);
  buildTickerItems(payoutFeed);
  buildLiveFeed(payoutFeed);
  updateStats(payoutFeed);
}

function initFeed() {
  buildTickerItems(payoutFeed);
  buildLiveFeed(payoutFeed);
  updateStats(payoutFeed);
  setInterval(rotateFeed, 2800);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initFeed);
} else {
  initFeed();
}
