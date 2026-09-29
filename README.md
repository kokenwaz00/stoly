# STOLY — Blockchain Payment System on Arbitrum

Система столов (пирамидальная схема) с автоматическими выплатами в блокчейне на сети Arbitrum.

## 🏗️ Архитектура

### Компоненты

1. **Смарт-контракт (Solidity)** — `contracts/Stoly.sol`
   - Управляет открытием/закрытием столов
   - Принимает платежи в USDT
   - Автоматически распределяет выплаты между участниками
   - Хранит историю всех транзакций

2. **Фронтенд (JavaScript)** — `js/app.js`
   - Интеграция с Web3 (ethers.js)
   - Поддержка MetaMask, Rabby, Coinbase Wallet (EIP-6963)
   - Отправка транзакций на Arbitrum
   - Отображение баланса и выплат

3. **Тестовый USDT** — `contracts/TestUSDT.sol`
   - ERC-20 токен для Arbitrum Sepolia
   - Для локального тестирования

## 🚀 Деплой контракта

### Требования

- Node.js 18+
- Hardhat
- Приватный ключ Arbitrum кошелька с ETH

### Шаги деплоя

```bash
cd contracts

# Установить зависимости
npm install

# Создать .env файл
cat > .env << EOF
PRIVATE_KEY=0x... # Ваш приватный ключ
ARBITRUM_SEPOLIA_RPC=https://sepolia-rollup.arbitrum.io/rpc
ARBITRUM_RPC=https://arb1.arbitrum.io/rpc
USDT_ADDRESS=0x... # USDT на Arbitrum Sepolia
ARBISCAN_API_KEY=... # (опционально для верификации)
EOF

# Скомпилировать контракты
npm run compile

# Развернуть на Arbitrum Sepolia (тестнет)
npm run deploy:sepolia

# Или на Arbitrum One (продакшн)
npm run deploy:mainnet
```

### После деплоя

1. Скопируйте адрес контракта из вывода
2. Обновите в `js/app.js`:
   ```javascript
   const STOLY_CONTRACT_ADDRESS = "0x..."; // Адрес контракта
   const USDT_TOKEN_ADDRESS = "0x...";     // Адрес USDT
   ```
3. Верифицируйте контракт на Arbiscan (опционально)

## 📋 Правила работы

### Уровни участников

| Уровень | Требование | Описание |
|---------|-----------|---------|
| 1 | 0 покупок | Вход — получают выплаты со всех следующих уровней |
| 2 | 5+ покупок | Получают выплаты с уровней 3, 4, 5 |
| 3 | 15+ покупок | Получают выплаты с уровней 4, 5 |
| 4 | 35+ покупок | Получают выплаты с уровня 5 |
| 5 | 70+ покупок | Не получают выплат (пока не купит следующий уровень) |

### Распределение платежей

Когда новый участник покупает место:
1. 100 USDT переводятся в смарт-контракт
2. Сумма делится **поровну** между **всеми участниками предыдущих уровней**
3. Выплаты записываются в контракт как `claimable`
4. Участник может забрать выплаты функцией `claim()`

### Пример

Стол 1 имеет:
- Уровень 1: 3 участника
- Уровень 2: 2 участника
- Уровень 3: 1 участник

Новый участник (уровень 3) покупает за 100 USDT.

Выплата: 100 / (3+2+1) = **16.67 USDT** каждому из 6 предыдущих участников.

## 💰 Платежи и выплаты

### USDT на Arbitrum Sepolia (тест)

Для тестирования используйте тестовый USDT:
```bash
cd contracts
npx hardhat run scripts/deployTestUSDT.js --network arbitrumSepolia
```

**Популярные тестовые USDT:**
- Arbitrum Sepolia: [Radiant](https://sepolia-rollup.arbitrum.io/rpc)
- Можно использовать любой ERC-20 токен

### Реальный USDT на Arbitrum One

Адреса контрактов USDT:
- **Arbitrum One:** `0xFd086bC7CD5C481DCC9C85ebA8d8dA0e8f0e8b7d`
- **Arbitrum Sepolia (тест):** развертываем сами через `TestUSDT.sol`

## 🔒 Безопасность

### Аудит кода

Код использует:
- OpenZeppelin контракты (проверенные)
- ReentrancyGuard для защиты от re-entrance
- Проверки доступа (onlyOwner, onlyServer)
- Проверки баланса перед выплатами

### Риски

⚠️ **Это финансовая пирамида!** Участники платят новичкам. Система прекратит работать, если прекратятся новые участники.

Используйте только средства, которые вы готовы потерять полностью.

## 📱 Использование в браузере

1. Откройте сайт: `http://localhost:5173` (или на хостинге)
2. Нажмите "Подключить кошелёк"
3. Выберите MetaMask/Rabby/Coinbase
4. Убедитесь, что вы на Arbitrum Sepolia или Arbitrum One
5. Одобрите расход USDT
6. Нажмите "Купить место"
7. Подтвердите в кошельке
8. Ждите подтверждения транзакции
9. Проверьте выплаты в кабинете
10. Нажмите "Забрать выплаты" для получения USDT

## 🖥️ Запуск фронтенда

```bash
npm run dev
# Откройте http://localhost:5173
```

## 📂 Структура проекта

```
stoly/
├── contracts/
│   ├── Stoly.sol              # Основной контракт
│   ├── TestUSDT.sol           # Тестовый USDT
│   ├── hardhat.config.js      # Конфиг Hardhat
│   ├── package.json           # Зависимости
│   └── scripts/
│       └── deploy.js          # Скрипт деплоя
├── js/
│   └── app.js                 # Фронтенд Web3
├── css/
│   └── styles.css             # Стили
├── index.html                 # HTML страница
└── README.md                  # Этот файл
```

## 🔗 Ссылки

- **Arbitrum Docs:** https://docs.arbitrum.io/
- **OpenZeppelin Contracts:** https://docs.openzeppelin.com/contracts/
- **ethers.js v6:** https://docs.ethers.org/v6/
- **Hardhat:** https://hardhat.org/docs
- **Arbiscan:** https://arbiscan.io/ (Arbitrum One)
- **Arbiscan Sepolia:** https://sepolia.arbiscan.io/ (тестнет)

## ⚖️ Дисклеймер

Это экспериментальный проект. Используйте на свой риск. Авторы не несут ответственность за потерю средств. Убедитесь, что механика системы вам понятна перед тем, как вкладывать реальные деньги.

## 📞 Контакты

Для вопросов открывайте Issues в репозитории.
