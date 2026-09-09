// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {MockERC20} from "./MockERC20.sol";

/// @notice Mock lending market the Amulet agent guards. Collateral is native ETH, debt is a mock
/// 6-decimal stablecoin. The owner can move the price so the health factor can be pushed down
/// on camera. Every user-facing call is either payable ETH or a single uint, so a hardware wallet
/// shows a meaningful amount even while blind-signing.
contract PositionSim {
    uint256 public constant HF_ONE = 1e18;

    MockERC20 public immutable debtToken;
    string public name;
    address public owner;

    /// @dev ETH price in USD, 8 decimals (Chainlink-style).
    uint256 public price;
    uint16 public immutable liquidationThresholdBps;
    uint16 public immutable supplyRateBps;
    uint16 public immutable borrowRateBps;

    mapping(address => uint256) public collateral; // wei
    mapping(address => uint256) public debt; // debt-token units (6 dec)
    uint256 public totalCollateral;
    uint256 public totalDebt;

    event Supply(address indexed user, uint256 amount);
    event Withdraw(address indexed user, uint256 amount);
    event Borrow(address indexed user, uint256 amount);
    event Repay(address indexed user, uint256 debtUnits, uint256 ethIn);
    event PriceSet(uint256 price);

    error NotOwner();
    error ZeroAmount();
    error Unhealthy(uint256 healthFactor);
    error InsufficientCollateral();
    error TransferFailed();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(
        string memory name_,
        MockERC20 debtToken_,
        uint256 initialPrice,
        uint16 liquidationThresholdBps_,
        uint16 supplyRateBps_,
        uint16 borrowRateBps_
    ) {
        name = name_;
        debtToken = debtToken_;
        owner = msg.sender;
        price = initialPrice;
        liquidationThresholdBps = liquidationThresholdBps_;
        supplyRateBps = supplyRateBps_;
        borrowRateBps = borrowRateBps_;
        emit PriceSet(initialPrice);
    }

    // ---- user actions (what the Ledger signs) ----

    function supply() external payable {
        if (msg.value == 0) revert ZeroAmount();
        collateral[msg.sender] += msg.value;
        totalCollateral += msg.value;
        emit Supply(msg.sender, msg.value);
    }

    function withdraw(uint256 amount) external {
        if (amount == 0) revert ZeroAmount();
        if (collateral[msg.sender] < amount) revert InsufficientCollateral();
        collateral[msg.sender] -= amount;
        totalCollateral -= amount;
        _requireHealthy(msg.sender);
        (bool ok,) = msg.sender.call{value: amount}("");
        if (!ok) revert TransferFailed();
        emit Withdraw(msg.sender, amount);
    }

    function borrow(uint256 amount) external {
        if (amount == 0) revert ZeroAmount();
        debt[msg.sender] += amount;
        totalDebt += amount;
        _requireHealthy(msg.sender);
        debtToken.mint(msg.sender, amount);
        emit Borrow(msg.sender, amount);
    }

    /// @notice Repay debt with ETH valued at the current price. Excess ETH is refunded.
    function repay() external payable {
        if (msg.value == 0) revert ZeroAmount();
        uint256 units = ethToDebtUnits(msg.value);
        uint256 owed = debt[msg.sender];
        uint256 paid = units > owed ? owed : units;
        uint256 ethUsed = paid == units ? msg.value : debtUnitsToEth(paid);
        debt[msg.sender] = owed - paid;
        totalDebt -= paid;
        emit Repay(msg.sender, paid, ethUsed);
        uint256 refund = msg.value - ethUsed;
        if (refund > 0) {
            (bool ok,) = msg.sender.call{value: refund}("");
            if (!ok) revert TransferFailed();
        }
    }

    // ---- owner / demo levers (dev key, never the Ledger) ----

    function setPrice(uint256 newPrice) external onlyOwner {
        if (newPrice == 0) revert ZeroAmount();
        price = newPrice;
        emit PriceSet(newPrice);
    }

    /// @notice Demo recovery only: set a position directly. Mints the debt token so balances
    /// stay consistent with a real supply+borrow.
    function seedPosition(address user, uint256 collateralWei, uint256 debtUnits) external payable onlyOwner {
        if (msg.value != collateralWei) revert InsufficientCollateral();
        collateral[user] += collateralWei;
        totalCollateral += collateralWei;
        debt[user] += debtUnits;
        totalDebt += debtUnits;
        if (debtUnits > 0) debtToken.mint(user, debtUnits);
        emit Supply(user, collateralWei);
        if (debtUnits > 0) emit Borrow(user, debtUnits);
    }

    // ---- views ----

    /// @return hf 1e18-scaled; type(uint256).max when there is no debt.
    function healthFactor(address user) public view returns (uint256 hf) {
        uint256 d = debt[user];
        if (d == 0) return type(uint256).max;
        // collateral(wei) * price(1e8) * LT(bps) / (debt(1e6) * 1e6) -> 1e18
        return collateral[user] * price * liquidationThresholdBps / (d * 1e6);
    }

    function ethToDebtUnits(uint256 weiAmount) public view returns (uint256) {
        return weiAmount * price / 1e20;
    }

    function debtUnitsToEth(uint256 units) public view returns (uint256) {
        return units * 1e20 / price;
    }

    function _requireHealthy(address user) internal view {
        uint256 hf = healthFactor(user);
        if (hf < HF_ONE) revert Unhealthy(hf);
    }
}
