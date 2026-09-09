// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {MockERC20} from "../src/MockERC20.sol";
import {PositionSim} from "../src/PositionSim.sol";
import {SwapSim, IPriceSource} from "../src/SwapSim.sol";

/// @dev Canonical Uniswap v3 router interface, used to prove the ABI shape matches.
interface ISwapRouter {
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

    function exactInputSingle(ExactInputSingleParams calldata params) external payable returns (uint256 amountOut);
}

contract SwapSimTest is Test {
    MockERC20 usd;
    PositionSim sim;
    SwapSim router;
    address user = makeAddr("ledger");
    address weth;

    function setUp() public {
        usd = new MockERC20("Sim USD", "sUSDC", 6);
        sim = new PositionSim("Sim-A", usd, 2000e8, 8000, 320, 610);
        router = new SwapSim(usd, IPriceSource(address(sim)));
        weth = router.WETH9();
        usd.setAuthorized(address(sim), true);
        usd.setAuthorized(address(router), true);
        vm.deal(address(router), 0.02 ether);
        vm.deal(user, 1 ether);
    }

    function _params(address tokenIn, address tokenOut, uint256 amountIn, uint256 minOut)
        internal
        view
        returns (SwapSim.ExactInputSingleParams memory)
    {
        return SwapSim.ExactInputSingleParams({
            tokenIn: tokenIn,
            tokenOut: tokenOut,
            fee: 3000,
            recipient: user,
            deadline: block.timestamp + 600,
            amountIn: amountIn,
            amountOutMinimum: minOut,
            sqrtPriceLimitX96: 0
        });
    }

    function test_ethToStable() public {
        SwapSim.ExactInputSingleParams memory p = _params(weth, address(usd), 0.01 ether, 0);
        vm.prank(user);
        uint256 out = router.exactInputSingle{value: 0.01 ether}(p);
        assertEq(out, 19_940_000); // $20 minus 0.3%
        assertEq(usd.balanceOf(user), out);
    }

    function test_stableToEth() public {
        usd.mint(user, 100e6);
        SwapSim.ExactInputSingleParams memory p = _params(address(usd), weth, 20e6, 0);
        vm.prank(user);
        uint256 out = router.exactInputSingle(p);
        assertEq(out, 0.00997 ether);
        assertEq(usd.balanceOf(user), 80e6);
        assertEq(user.balance, 1 ether + out);
    }

    function test_minOutAndDeadline() public {
        SwapSim.ExactInputSingleParams memory p = _params(weth, address(usd), 0.01 ether, 20e6);
        vm.prank(user);
        vm.expectRevert(abi.encodeWithSelector(SwapSim.TooLittleReceived.selector, 19_940_000));
        router.exactInputSingle{value: 0.01 ether}(p);

        p.amountOutMinimum = 0;
        p.deadline = block.timestamp - 1;
        vm.prank(user);
        vm.expectRevert(SwapSim.Expired.selector);
        router.exactInputSingle{value: 0.01 ether}(p);
    }

    function test_wrongValueAndPair() public {
        SwapSim.ExactInputSingleParams memory p = _params(weth, address(usd), 0.01 ether, 0);
        vm.prank(user);
        vm.expectRevert(SwapSim.WrongValue.selector);
        router.exactInputSingle{value: 0.02 ether}(p);

        p = _params(address(usd), address(usd), 1e6, 0);
        vm.prank(user);
        vm.expectRevert(SwapSim.BadPair.selector);
        router.exactInputSingle(p);
    }

    function test_reserveShort() public {
        usd.mint(user, 1_000_000e6);
        SwapSim.ExactInputSingleParams memory p = _params(address(usd), weth, 100_000e6, 0);
        vm.prank(user);
        vm.expectRevert(SwapSim.ReserveShort.selector);
        router.exactInputSingle(p);
    }

    function test_calldataMatchesUniswap() public view {
        ISwapRouter.ExactInputSingleParams memory uni = ISwapRouter.ExactInputSingleParams({
            tokenIn: weth,
            tokenOut: address(usd),
            fee: 3000,
            recipient: user,
            deadline: 1_800_000_000,
            amountIn: 0.01 ether,
            amountOutMinimum: 0,
            sqrtPriceLimitX96: 0
        });
        bytes memory a = abi.encodeCall(ISwapRouter.exactInputSingle, (uni));
        SwapSim.ExactInputSingleParams memory p = _params(weth, address(usd), 0.01 ether, 0);
        p.deadline = 1_800_000_000;
        bytes memory b = abi.encodeCall(SwapSim.exactInputSingle, (p));
        assertEq(keccak256(a), keccak256(b));
        // Uniswap v3 SwapRouter (the deadline-carrying struct) selector.
        assertEq(SwapSim.exactInputSingle.selector, bytes4(0x414bf389));
    }
}
