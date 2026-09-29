// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

/**
 * @title Stoly
 * @dev Pyramid table system with blockchain-based payments and automatic distributions
 * Participants buy seats at a table. When a new participant at a higher level buys,
 * all participants from previous levels automatically receive their share.
 */
contract Stoly is Ownable, ReentrancyGuard {
    IERC20 public usdtToken;

    // Configuration
    uint256 public constant LEVEL_THRESHOLDS_0 = 0;      // Level 1: entry
    uint256 public constant LEVEL_THRESHOLDS_1 = 5;      // Level 2
    uint256 public constant LEVEL_THRESHOLDS_2 = 15;     // Level 3
    uint256 public constant LEVEL_THRESHOLDS_3 = 35;     // Level 4
    uint256 public constant LEVEL_THRESHOLDS_4 = 70;     // Level 5
    uint256 public constant PRICE_TABLE_1 = 100e6;       // 100 USDT (6 decimals)
    uint256 public constant PRICE_TABLE_2 = 200e6;       // 200 USDT
    uint256 public constant TOTAL_TABLES = 10;
    uint256 public TABLE_2_OPEN_TIME;                    // Timestamp when table 2 opens

    // State
    mapping(uint256 => bool) public openTables;           // tableId => isOpen
    mapping(address => mapping(uint256 => bool)) public hasBought; // wallet => tableId => hasAlreadyBought
    mapping(uint256 => Purchase[]) public purchases;      // tableId => list of purchases
    mapping(address => uint256) public claimableBalance;  // wallet => amount to claim
    mapping(address => bool) public whitelistedServers;   // server addresses authorized to trigger payouts

    uint256 public nextPurchaseId = 1;
    uint256 public nextPayoutId = 1;

    // Data structures
    struct Purchase {
        uint256 id;
        address wallet;
        uint256 tableId;
        uint256 entryLevel;
        uint256 amount;
        uint256 timestamp;
    }

    struct Payout {
        uint256 id;
        address to;
        address from;
        uint256 tableId;
        uint256 amount;
        uint256 timestamp;
        bool claimed;
    }

    Payout[] public allPayouts;

    // Events
    event TableOpened(uint256 indexed tableId, uint256 timestamp);
    event TableClosed(uint256 indexed tableId, uint256 timestamp);
    event PurchaseCreated(
        uint256 indexed purchaseId,
        address indexed wallet,
        uint256 indexed tableId,
        uint256 entryLevel,
        uint256 amount,
        uint256 timestamp
    );
    event PayoutCreated(
        uint256 indexed payoutId,
        address indexed to,
        address indexed from,
        uint256 tableId,
        uint256 amount,
        uint256 timestamp
    );
    event PayoutClaimed(
        uint256 indexed payoutId,
        address indexed wallet,
        uint256 amount,
        uint256 timestamp
    );
    event ServerAuthorized(address indexed server);
    event ServerRevoked(address indexed server);

    // Modifiers
    modifier onlyServer() {
        require(whitelistedServers[msg.sender], "Not authorized server");
        _;
    }

    // Constructor
    constructor(address _usdtToken, uint256 _table2OpenTime) {
        usdtToken = IERC20(_usdtToken);
        TABLE_2_OPEN_TIME = _table2OpenTime;
        
        // Table 1 starts open
        openTables[1] = true;
        emit TableOpened(1, block.timestamp);
    }

    // Admin functions
    function authorizeServer(address _server) external onlyOwner {
        whitelistedServers[_server] = true;
        emit ServerAuthorized(_server);
    }

    function revokeServer(address _server) external onlyOwner {
        whitelistedServers[_server] = false;
        emit ServerRevoked(_server);
    }

    function openTable(uint256 _tableId) external onlyOwner {
        require(_tableId > 0 && _tableId <= TOTAL_TABLES, "Invalid table");
        require(!openTables[_tableId], "Already open");
        openTables[_tableId] = true;
        emit TableOpened(_tableId, block.timestamp);
    }

    function closeTable(uint256 _tableId) external onlyOwner {
        require(openTables[_tableId], "Not open");
        openTables[_tableId] = false;
        emit TableClosed(_tableId, block.timestamp);
    }

    // Public functions
    function getPrice(uint256 _tableId) public pure returns (uint256) {
        if (_tableId == 1) return PRICE_TABLE_1;
        if (_tableId == 2) return PRICE_TABLE_2;
        return PRICE_TABLE_1 * _tableId; // fallback
    }

    function currentLevel(uint256 _tableId) public view returns (uint256) {
        uint256 buyCount = purchases[_tableId].length;
        if (buyCount < LEVEL_THRESHOLDS_1) return 1;
        if (buyCount < LEVEL_THRESHOLDS_2) return 2;
        if (buyCount < LEVEL_THRESHOLDS_3) return 3;
        if (buyCount < LEVEL_THRESHOLDS_4) return 4;
        return 5;
    }

    function getPurchases(uint256 _tableId) external view returns (Purchase[] memory) {
        return purchases[_tableId];
    }

    function getPurchasesCount(uint256 _tableId) external view returns (uint256) {
        return purchases[_tableId].length;
    }

    function getPayouts() external view returns (Payout[] memory) {
        return allPayouts;
    }

    function getPayoutsCount() external view returns (uint256) {
        return allPayouts.length;
    }

    // Main purchase function
    function buy(uint256 _tableId) external nonReentrant {
        require(openTables[_tableId], "Table not open");
        require(_tableId > 0 && _tableId <= TOTAL_TABLES, "Invalid table");
        require(!hasBought[msg.sender][_tableId], "Already bought this table");

        uint256 price = getPrice(_tableId);
        uint256 entryLevel = currentLevel(_tableId);

        // Transfer USDT from buyer to contract
        require(
            usdtToken.transferFrom(msg.sender, address(this), price),
            "Transfer failed"
        );

        // Create purchase record
        uint256 purchaseId = nextPurchaseId++;
        hasBought[msg.sender][_tableId] = true;
        purchases[_tableId].push(
            Purchase({
                id: purchaseId,
                wallet: msg.sender,
                tableId: _tableId,
                entryLevel: entryLevel,
                amount: price,
                timestamp: block.timestamp
            })
        );

        emit PurchaseCreated(purchaseId, msg.sender, _tableId, entryLevel, price, block.timestamp);

        // Distribute payouts to earlier participants
        _distribute(_tableId, purchaseId, msg.sender, price);
    }

    // Internal function: distribute payouts to all earlier level participants
    function _distribute(uint256 _tableId, uint256 _buyerId, address _buyer, uint256 _amount) internal {
        Purchase[] storage tablePurchases = purchases[_tableId];
        
        // Find all participants from earlier levels
        uint256 newLevel = currentLevel(_tableId);
        Purchase[] memory earlierParticipants = new Purchase[](tablePurchases.length);
        uint256 count = 0;

        for (uint256 i = 0; i < tablePurchases.length - 1; i++) {
            if (tablePurchases[i].entryLevel < newLevel) {
                earlierParticipants[count] = tablePurchases[i];
                count++;
            }
        }

        // If no earlier participants, funds stay in contract
        if (count == 0) {
            return;
        }

        // Split amount equally among earlier participants
        uint256 share = _amount / count;
        if (share == 0) return;

        for (uint256 i = 0; i < count; i++) {
            address recipient = earlierParticipants[i].wallet;
            
            uint256 payoutId = nextPayoutId++;
            claimableBalance[recipient] += share;

            allPayouts.push(
                Payout({
                    id: payoutId,
                    to: recipient,
                    from: _buyer,
                    tableId: _tableId,
                    amount: share,
                    timestamp: block.timestamp,
                    claimed: false
                })
            );

            emit PayoutCreated(payoutId, recipient, _buyer, _tableId, share, block.timestamp);
        }
    }

    // Claim payout
    function claim() external nonReentrant {
        uint256 amount = claimableBalance[msg.sender];
        require(amount > 0, "No claimable balance");

        claimableBalance[msg.sender] = 0;

        require(usdtToken.transfer(msg.sender, amount), "Transfer failed");

        // Mark payouts as claimed
        for (uint256 i = allPayouts.length; i > 0; i--) {
            if (allPayouts[i - 1].to == msg.sender && !allPayouts[i - 1].claimed) {
                allPayouts[i - 1].claimed = true;
                emit PayoutClaimed(allPayouts[i - 1].id, msg.sender, allPayouts[i - 1].amount, block.timestamp);
            }
        }
    }

    // Server-triggered automatic payout (optional, for backend automation)
    function serverPayout(address _to, uint256 _amount) external onlyServer nonReentrant {
        require(_amount > 0, "Invalid amount");
        require(claimableBalance[_to] >= _amount, "Insufficient claimable balance");

        claimableBalance[_to] -= _amount;
        require(usdtToken.transfer(_to, _amount), "Transfer failed");
    }

    // Emergency withdrawal by owner
    function emergencyWithdraw(address _to, uint256 _amount) external onlyOwner {
        require(usdtToken.transfer(_to, _amount), "Transfer failed");
    }
}
