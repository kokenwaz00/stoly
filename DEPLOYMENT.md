# Развертывание смарт-контрактов на Arbitrum

Этот документ описывает как развернуть и верифицировать смарт-контракты Stoly на Arbitrum.

## Предварительные требования

- **Node.js** 18+ и npm
- **Hardhat** (установится вместе с `npm install`)
- **Приватный ключ** кошелька с ETH на Arbitrum (для газа)
- **Arbiscan API Key** (опционально, для верификации)

## Установка

```bash
cd contracts
npm install
```

## Конфигурация

### 1. Создайте `.env` файл

Скопируйте `.env.example` и заполните значения:

```bash
cp .env.example .env
```

Отредактируйте `.env`:

```env
# Приватный ключ вашего развертывающего кошелька (БЕЗ 0x префикса)
PRIVATE_KEY=your_private_key_here

# RPC endpoints для Arbitrum
ARBITRUM_SEPOLIA_RPC=https://sepolia-rollup.arbitrum.io/rpc
ARBITRUM_RPC=https://arb1.arbitrum.io/rpc

# Адрес USDT контракта
# Для Arbitrum Sepolia: развертните TestUSDT (см. ниже)
# Для Arbitrum One: 0xFd086bC7CD5C481DCC9C85ebA8d8dA0e8f0e8b7d
USDT_ADDRESS=0x

# Arbiscan API Key (для верификации контрактов)
ARBISCAN_API_KEY=your_arbiscan_key
```

### 2. Получение ETH для газа

- **Arbitrum Sepolia (тестнет):** https://faucet.arbitrum.io/
- **Arbitrum One (продакшн):** Купите ETH и бридж на Arbitrum

## Desarrollo на тестнете (Arbitrum Sepolia)

### Шаг 1: Развернуть тестовый USDT

```bash
npx hardhat run scripts/deployTestUSDT.js --network arbitrumSepolia
```

Скопируйте адрес TestUSDT и обновите его в `.env`:

```env
USDT_ADDRESS=0x... # Скопированный адрес
```

### Шаг 2: Развернуть Stoly контракт

```bash
npm run deploy:sepolia
```

Вывод будет содержать:
- Адрес контракта Stoly
- Адрес владельца
- Блок развертывания

### Шаг 3: Обновите фронтенд

В файле `js/app.js` обновите константы:

```javascript
const STOLY_CONTRACT_ADDRESS = "0x..."; // Из шага 2
const USDT_TOKEN_ADDRESS = "0x...";     // Из шага 1
```

### Шаг 4: Верифицируйте контракты

```bash
npx hardhat verify --network arbitrumSepolia STOLY_ADDRESS USDT_ADDRESS TIMESTAMP
```

Где:
- `STOLY_ADDRESS` — адрес контракта Stoly
- `USDT_ADDRESS` — адрес USDT
- `TIMESTAMP` — время открытия стола 2 (вывод из deploy)

## Деплой на продакшн (Arbitrum One)

### Шаг 1: Используйте реальный USDT

На Arbitrum One используется официальный USDT:
```
0xFd086bC7CD5C481DCC9C85ebA8d8dA0e8f0e8b7d
```

Обновите `.env`:
```env
USDT_ADDRESS=0xFd086bC7CD5C481DCC9C85ebA8d8dA0e8f0e8b7d
```

### Шаг 2: Развернуть контракт

```bash
npm run deploy:mainnet
```

### Шаг 3: Верифицируйте на Arbiscan

```bash
npx hardhat verify --network arbitrum STOLY_ADDRESS USDT_ADDRESS TIMESTAMP
```

## Взаимодействие с контрактом

### Через Hardhat Console

```bash
npx hardhat console --network arbitrumSepolia
```

```javascript
const Stoly = await ethers.getContractFactory("Stoly");
const stoly = Stoly.attach("0x..."); // Ваш адрес контракта

// Получить текущий уровень стола 1
const level = await stoly.currentLevel(1);
console.log("Level:", level.toString());

// Получить количество покупок
const count = await stoly.getPurchasesCount(1);
console.log("Purchases:", count.toString());
```

### Через Arbiscan (UI)

1. Откройте контракт на Arbiscan: https://arbiscan.io/address/YOUR_STOLY_ADDRESS
2. Перейдите в "Contract" → "Read Contract"
3. Вводите параметры и читайте состояние

## Функции администратора

### Открыть новый стол

```javascript
const tx = await stoly.openTable(2);
await tx.wait();
```

### Закрыть стол

```javascript
const tx = await stoly.closeTable(1);
await tx.wait();
```

### Авторизовать сервер для автоматических выплат

```javascript
const tx = await stoly.authorizeServer("0x...");
await tx.wait();
```

## Тестирование

### Скомпилировать контракты

```bash
npm run compile
```

### Запустить Hardhat локальный узел (опционально)

```bash
npx hardhat node
```

## Решение проблем

### Ошибка: "Account does not have enough funds"

**Решение:** Вам не хватает ETH на счете для оплаты газа. Получите ETH с фасета.

### Ошибка: "Insufficient allowance"

**Решение:** Одобрите расход USDT контрактом перед вызовом `buy()`.

### Контракт не верифицируется

Убедитесь, что:
- Параметры конструктора правильные
- Версия Solidity совпадает
- Используется правильный сетевой Arbiscan

## Мониторинг

### Просмотр событий контракта

На Arbiscan:
1. Откройте контракт
2. Перейдите в "Events"
3. Фильтруйте по типам событий

### Отслеживание адреса

На Arbiscan введите адрес участника в поиск и смотрите его транзакции.

## Безопасность

⚠️ **ВАЖНО:**
- **Никогда** не коммитьте `.env` файл с приватным ключом
- Используйте счет только для этого контракта
- Проверьте адреса перед развертыванием
- Тестируйте на Sepolia перед продакшном
- Рассмотрите аудит перед запуском с реальными средствами

## Стоимость газа

Примерные расходы:
- **Развертывание Stoly:** 2-4 млн газа (~$2-5 на Sepolia)
- **Покупка:** 150-200k газа (~$0.20-0.30)
- **Выплата:** 50-100k газа (~$0.05-0.10)

## Контакты и поддержка

- **Arbitrum Discord:** https://discord.gg/arbitrum
- **Arbiscan Support:** support@arbiscan.io
