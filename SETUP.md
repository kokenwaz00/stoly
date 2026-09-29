# STOLY — Полная интеграция с Arbitrum ✅

Все готово к развертыванию и использованию на блокчейне!

## 📦 Что было создано

### Смарт-контракты (Solidity)
```
contracts/
├── Stoly.sol              ✅ Основной контракт с автовыплатами
├── TestUSDT.sol           ✅ Тестовый USDT для Arbitrum Sepolia
├── hardhat.config.js      ✅ Конфиг для развертывания
├── package.json           ✅ Зависимости
└── scripts/
    ├── deploy.js          ✅ Развертывание Stoly
    └── deployTestUSDT.js  ✅ Развертывание TestUSDT
```

### Фронтенд (Web3)
```
js/
└── app.js                 ✅ Полная интеграция с ethers.js
```

### HTML & UI
```
index.html                 ✅ Обновлен для блокчейна
css/styles.css             ✅ Стили без изменений
```

### Документация
```
QUICKSTART.md              ✅ Быстрый старт за 5 минут
DEPLOYMENT.md              ✅ Подробная инструкция развертывания
README.md                  ✅ Полное описание системы
.env.example               ✅ Шаблон переменных окружения
```

## 🎯 Основные возможности

### Смарт-контракт
- ✅ Управление открытыми столами
- ✅ Покупка мест за USDT (100 USDT за стол 1)
- ✅ Автоматическое распределение выплат между всеми участниками предыдущих уровней
- ✅ 5 уровней участников с прогрессией:
  - Уровень 1: вход (0 покупок)
  - Уровень 2: 5+ покупок
  - Уровень 3: 15+ покупок
  - Уровень 4: 35+ покупок
  - Уровень 5: 70+ покупок
- ✅ Функция `claim()` для забирания выплат
- ✅ Защита от re-entrance (ReentrancyGuard)
- ✅ Управление серверами для автоматических выплат

### Фронтенд
- ✅ Подключение кошелька через EIP-6963
- ✅ Поддержка MetaMask, Rabby, Coinbase Wallet
- ✅ Отправка транзакций в блокчейн
- ✅ Одобрение расходования USDT (approve)
- ✅ Отображение баланса в реальном времени
- ✅ Просмотр истории выплат
- ✅ Кнопка "Забрать выплаты" (claim)
- ✅ Отслеживание статуса транзакций

## 🚀 Быстрый старт

### 1. Подготовка
```bash
# Получите приватный ключ из MetaMask
# Получите тестовый ETH: https://faucet.arbitrum.io/

# Создайте .env в папке contracts
echo "PRIVATE_KEY=0xyour_key" > contracts/.env
echo "USDT_ADDRESS=0x" >> contracts/.env
```

### 2. Развертывание
```bash
cd contracts

# Развернуть тестовый USDT
npx hardhat run scripts/deployTestUSDT.js --network arbitrumSepolia

# Развернуть Stoly контракт
npm run deploy:sepolia
```

### 3. Конфигурация
```bash
# Скопируйте адреса и обновите js/app.js
const STOLY_CONTRACT_ADDRESS = "0x...";
const USDT_TOKEN_ADDRESS = "0x...";
```

### 4. Запуск
```bash
npm run dev
# Откройте http://localhost:5173
```

## 📋 Сетевые параметры

| Параметр | Sepolia (тест) | One (продакшн) |
|----------|---|---|
| Chain ID | 421614 | 42161 |
| RPC | https://sepolia-rollup.arbitrum.io/rpc | https://arb1.arbitrum.io/rpc |
| Фасет | https://faucet.arbitrum.io/ | N/A |
| USDT | Разворачиваем (TestUSDT) | 0xFd086bC7CD5C481DCC9C85ebA8d8dA0e8f0e8b7d |
| Обозреватель | https://sepolia.arbiscan.io/ | https://arbiscan.io/ |

## 💰 Механика работы

### Пример транзакции

**Стол 1 имеет:**
- Уровень 1: 3 участника (платили по 100 USDT каждый)
- Уровень 2: 2 участника (платили по 100 USDT каждый)

**Новый участник покупает за 100 USDT:**
- 100 USDT делится на 5 участников (3+2)
- **Каждый получает: 100 / 5 = 20 USDT**
- Выплаты записываются в контракт как `claimable`
- Участники нажимают "Забрать выплаты" и получают 20 USDT на кошелек

## 🔐 Безопасность

✅ **OpenZeppelin контракты** — проверенные и аудированные
✅ **ReentrancyGuard** — защита от re-entrance атак
✅ **Проверки баланса** — перед каждым переводом
✅ **Проверки доступа** — onlyOwner, onlyServer
✅ **EIP-6963 поддержка** — безопасное подключение кошельков

⚠️ **Внимание:** Это финансовая пирамида. Используйте только средства, которые готовы потерять!

## 📁 Важные файлы для редактирования

| Файл | Для чего |
|------|----------|
| `js/app.js` | Обновить адреса контрактов |
| `contracts/.env` | Приватный ключ и USDT адрес |
| `index.html` | Описание и метаданные |
| `contracts/Stoly.sol` | Цены, уровни, комиссии |

## 🧪 Тестирование

### На Arbitrum Sepolia
```bash
npm run deploy:sepolia
```

### На Arbitrum One (продакшн)
```bash
npm run deploy:mainnet
```

## 📊 Мониторинг

**Просмотр контракта:**
- Arbiscan Sepolia: https://sepolia.arbiscan.io/address/STOLY_ADDRESS
- Arbiscan One: https://arbiscan.io/address/STOLY_ADDRESS

**Отслеживание адреса:**
- Введите адрес кошелька в Arbiscan
- Смотрите все транзакции и баланс

## 🔧 Команды

```bash
# Фронтенд
npm run dev              # Запустить локально
npm run build            # Собрать для продакшна

# Контракты
cd contracts
npm install              # Установить зависимости
npm run compile          # Скомпилировать контракты
npm run deploy:sepolia   # Развернуть на тестнете
npm run deploy:mainnet   # Развернуть на продакшене
```

## 📚 Документация

1. **QUICKSTART.md** — За 5 минут до первой транзакции
2. **DEPLOYMENT.md** — Подробное развертывание и верификация
3. **README.md** — Полное описание системы
4. **Код контрактов** — `contracts/Stoly.sol`
5. **Код фронтенда** — `js/app.js`

## 🎓 Дополнительно

- **Arbitrum Docs:** https://docs.arbitrum.io/
- **ethers.js v6:** https://docs.ethers.org/v6/
- **OpenZeppelin:** https://docs.openzeppelin.com/contracts/
- **Hardhat:** https://hardhat.org/

## ✨ Готово к использованию!

Всё на месте. Следуйте QUICKSTART.md и начните тестировать! 🚀

---

**Создано:** 29.09.2026
**Версия:** 1.0.0
**Сеть:** Arbitrum Sepolia / Arbitrum One
**Язык контракта:** Solidity 0.8.20
