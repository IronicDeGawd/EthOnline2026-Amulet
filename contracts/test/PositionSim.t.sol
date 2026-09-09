// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {MockERC20} from "../src/MockERC20.sol";
import {PositionSim} from "../src/PositionSim.sol";

contract PositionSimTest is Test {
    MockERC20 usd;
    PositionSim sim;
    address user = makeAddr("ledger");
    address stranger = makeAddr("stranger");

    function setUp() public {
        usd = new MockERC20("Sim USD", "sUSDC", 6);
        sim = new PositionSim("Sim-A", usd, 2000e8, 8000, 320, 610);
        usd.setAuthorized(address(sim), true);
        vm.deal(user, 1 ether);
    }

    function _seed() internal {
        vm.startPrank(user);
        sim.supply{value: 0.05 ether}();
        sim.borrow(60e6);
        vm.stopPrank();
    }

    function test_demoNumbers() public {
        _seed();
        // 0.05 ETH * $2000 * 0.8 / $60 = 1.333
        assertApproxEqRel(sim.healthFactor(user), 1.3333e18, 1e15);
        assertEq(usd.balanceOf(user), 60e6);

        sim.setPrice(1600e8);
        assertApproxEqRel(sim.healthFactor(user), 1.0667e18, 1e15);
        assertLt(sim.healthFactor(user), 1.25e18);

        vm.prank(user);
        sim.repay{value: 0.01 ether}(); // $16 -> debt 44
        assertEq(sim.debt(user), 44e6);
        assertApproxEqRel(sim.healthFactor(user), 1.4545e18, 1e15);
        assertGe(sim.healthFactor(user), 1.40e18);
    }

    function test_noDebtIsMaxHealth() public {
        vm.prank(user);
        sim.supply{value: 0.01 ether}();
        assertEq(sim.healthFactor(user), type(uint256).max);
    }

    function test_borrowRevertsBelowOne() public {
        vm.startPrank(user);
        sim.supply{value: 0.05 ether}(); // $100, LT 80% -> max $80
        vm.expectRevert();
        sim.borrow(81e6);
        sim.borrow(80e6); // exactly HF 1.0 passes
        assertEq(sim.healthFactor(user), 1e18);
        vm.stopPrank();
    }

    function test_withdrawRevertsBelowOne() public {
        _seed();
        vm.prank(user);
        vm.expectRevert();
        sim.withdraw(0.02 ether); // $60 collateral * 0.8 = 48 < 60 debt
        vm.prank(user);
        sim.withdraw(0.001 ether);
        assertEq(sim.collateral(user), 0.049 ether);
        assertEq(user.balance, 0.951 ether);
    }

    function test_repayRefundsExcess() public {
        _seed();
        uint256 before = user.balance;
        vm.prank(user);
        sim.repay{value: 0.1 ether}(); // $200 > $60 owed
        assertEq(sim.debt(user), 0);
        assertEq(before - user.balance, 0.03 ether); // 60e6 units * 1e20 / 2000e8
    }

    function test_onlyOwnerLevers() public {
        vm.prank(stranger);
        vm.expectRevert(PositionSim.NotOwner.selector);
        sim.setPrice(1e8);
        vm.prank(stranger);
        vm.expectRevert(PositionSim.NotOwner.selector);
        sim.seedPosition(user, 0, 1e6);
    }

    function test_seedPositionMatchesRealPath() public {
        sim.seedPosition{value: 0.05 ether}(user, 0.05 ether, 60e6);
        assertApproxEqRel(sim.healthFactor(user), 1.3333e18, 1e15);
        assertEq(usd.balanceOf(user), 60e6);
        assertEq(sim.totalCollateral(), 0.05 ether);
        assertEq(sim.totalDebt(), 60e6);
    }

    function test_zeroAmountsRevert() public {
        vm.startPrank(user);
        vm.expectRevert(PositionSim.ZeroAmount.selector);
        sim.supply{value: 0}();
        vm.expectRevert(PositionSim.ZeroAmount.selector);
        sim.borrow(0);
        vm.expectRevert(PositionSim.ZeroAmount.selector);
        sim.repay{value: 0}();
        vm.stopPrank();
    }
}
