// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {MockERC20} from "./MockERC20.sol";

interface IPriceSource {
    function price() external view returns (uint256);
}

/// @notice Mock swap router with the exact Uniswap v3 `exactInputSingle` signature, so calldata
/// built for this contract is byte-identical in shape to calldata for the real router. Swaps
/// ETH <-> the mock stablecoin at the sim price minus a 0.3% fee.
contract SwapSim {
    struct ExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24 fee;
        address recipient;
        uint256 deadline;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96;
    }

    uint256 public constant FEE_BPS = 30;

    /// @dev Sepolia WETH9 address, used only as the "ETH side" marker in `tokenIn`/`tokenOut`.
    address public constant WETH9 = 0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14;

    MockERC20 public immutable stable;
    IPriceSource public immutable priceSource;
    address public owner;

    event Swap(address indexed sender, address tokenIn, address tokenOut, uint256 amountIn, uint256 amountOut);

    error NotOwner();
    error BadPair();
    error Expired();
    error WrongValue();
    error TooLittleReceived(uint256 amountOut);
    error ReserveShort();
    error TransferFailed();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(MockERC20 stable_, IPriceSource priceSource_) {
        stable = stable_;
        priceSource = priceSource_;
        owner = msg.sender;
    }

    receive() external payable {}

    function exactInputSingle(ExactInputSingleParams calldata p) external payable returns (uint256 amountOut) {
        if (block.timestamp > p.deadline) revert Expired();
        uint256 price = priceSource.price();

        if (p.tokenIn == WETH9 && p.tokenOut == address(stable)) {
            if (msg.value != p.amountIn) revert WrongValue();
            amountOut = p.amountIn * price / 1e20 * (10_000 - FEE_BPS) / 10_000;
            if (amountOut < p.amountOutMinimum) revert TooLittleReceived(amountOut);
            stable.mint(p.recipient, amountOut);
        } else if (p.tokenIn == address(stable) && p.tokenOut == WETH9) {
            if (msg.value != 0) revert WrongValue();
            amountOut = p.amountIn * 1e20 / price * (10_000 - FEE_BPS) / 10_000;
            if (amountOut < p.amountOutMinimum) revert TooLittleReceived(amountOut);
            if (address(this).balance < amountOut) revert ReserveShort();
            stable.burn(msg.sender, p.amountIn);
            (bool ok,) = p.recipient.call{value: amountOut}("");
            if (!ok) revert TransferFailed();
        } else {
            revert BadPair();
        }
        emit Swap(msg.sender, p.tokenIn, p.tokenOut, p.amountIn, amountOut);
    }

    function withdrawReserve() external onlyOwner {
        (bool ok,) = owner.call{value: address(this).balance}("");
        if (!ok) revert TransferFailed();
    }
}
