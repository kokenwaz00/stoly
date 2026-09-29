# Быстрый старт STOLY на Arbitrum

## За 5 минут до первой транзакции

### 1. Клонируйте репозиторий
```bash
git clone https://github.com/kokenwaz00/stoly.git
cd stoly
```

### 2. Установите зависимости
```bash
npm install
cd contracts && npm install && cd ..
```

### 3. Подготовьте окружение

Получите приватный ключ MetaMask:
- Откройте MetaMask → Settings → Security → Export Private Key
- Скопируйте ключ

Создайте `.env` в папке `contracts`:
```bash
cat > contracts/.env << EOF
PRIVATE_KEY=0xyour_private_key
ARBITRUM_SEPOLIA_RPC=https://sepolia-rollup.arbitrum.io/rpc
ARBITRUM_RPC=https://arb1.arbitrum.io/rpc
USDT_ADDRESS=0x
EOF
```

### 4. Получите тестовый ETH

- Откройте https://faucet.arbitrum.io/
- Введите адрес MetaMask
- Получите 0.5 ETH на Arbitrum Sepolia

### 5. Разверните контракты

```bash
cd contracts

# Развернуть тестовый USDT
npx hardhat run scripts/deployTestUSDT.js --network arbitrumSepolia

# Скопируйте адрес TestUSDT и обновите .env:
# USDT_ADDRESS=0x...

# Развернуть Stoly контракт
npm run deploy:sepolia
```

Скопируйте адреса контрактов из вывода.

### 6. Обновите фронтенд

Откройте `js/app.js` и обновите:
```javascript
const STOLY_CONTRACT_ADDRESS = "0x..."; // Адрес Stoly
const USDT_TOKEN_ADDRESS = "0x...";     // Адрес TestUSDT
```

### 7. Запустите сайт

```bash
npm run dev
```

Откройте http://localhost:5173

### 8. Тестируйте

1. Нажмите "Подключить кошелёк"
2. Выберите MetaMask
3. Подтвердите подключение
4. Нажмите "Купить место" за 100 USDT
5. Подтвердите в MetaMask
6. Ждите подтверждения (обычно 1-5 секунд на Arbitrum Sepolia)
7. Проверьте выплаты в "Кабинете"

## Сетевые параметры

**Arbitrum Sepolia (тестнет):**
- Chain ID: 421614
- RPC: https://sepolia-rollup.arbitrum.io/rpc
- Фасет: https://faucet.arbitrum.io/

**Arbitrum One (продакшн):**
- Chain ID: 42161
- RPC: https://arb1.arbitrum.io/rpc
- USDT: 0xFd086bC7CD5C481DCC9C85ebA8d8dA0e8f0e8b7d

## Файлы для изменения

| Файл | Что менять |
|------|-----------|
| `js/app.js` | `STOLY_CONTRACT_ADDRESS`, `USDT_TOKEN_ADDRESS` |
| `contracts/.env` | `PRIVATE_KEY`, `USDT_ADDRESS` |
| `contracts/Stoly.sol` | TABLE_PRICE, LEVEL_THRESHOLDS (при необходимости) |
| `index.html` | Описание, метаданные |

## Проверка работы

### Просмотр контракта на Arbiscan
https://sepolia.arbiscan.io/address/YOUR_STOLY_ADDRESS

### Проверка транзакции
Скопируйте hash транзакции из MetaMask и вставьте в Arbiscan

### Отладка в консоли браузера
```javascript
// В консоли браузера (F12)
console.log(connectedWallet); // Ваш адрес
console.log(stolyContract);   // Контракт
```

## Обычные ошибки

| Ошибка | Решение |
|--------|---------|
| "Network mismatch" | Переключитесь на Arbitrum Sepolia в MetaMask |
| "Insufficient funds" | Получите ETH с фасета |
| "Contract not initialized" | Проверьте адреса в `js/app.js` |
| "Approve failed" | Убедитесь, что контракт имеет адрес USDT |

## Следующие шаги

1. **Для продакшна:** Измените на Arbitrum One в коде
2. **Для верификации:** Запустите `npx hardhat verify` (см. DEPLOYMENT.md)
3. **Для интеграции:** Разместите сайт на Netlify/Vercel/GitHub Pages
4. **Для серверной части:** Создайте backend для мониторинга событий

## Документация

- **DEPLOYMENT.md** — Подробное развертывание
- **README.md** — Описание системы
- **Код контракта** — `contracts/Stoly.sol`
- **Код фронтенда** — `js/app.js`

## Поддержка

- Все файлы открыты для редактирования
- Логи в консоли браузера (F12 → Console)
- Ошибки контракта видны в MetaMask
