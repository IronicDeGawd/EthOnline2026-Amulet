// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {MockERC20} from "../src/MockERC20.sol";

contract MockERC20Test is Test {
    MockERC20 usd;
    address sim = makeAddr("sim");
    address user = makeAddr("user");
    address stranger = makeAddr("stranger");

    function setUp() public {
        usd = new MockERC20("Sim USD", "sUSDC", 6);
        usd.setAuthorized(sim, true);
    }

    function test_onlyAuthorizedMintBurn() public {
        vm.prank(stranger);
        vm.expectRevert(MockERC20.NotAuthorized.selector);
        usd.mint(user, 1e6);

        vm.prank(sim);
        usd.mint(user, 5e6);
        assertEq(usd.balanceOf(user), 5e6);
        assertEq(usd.totalSupply(), 5e6);

        vm.prank(stranger);
        vm.expectRevert(MockERC20.NotAuthorized.selector);
        usd.burn(user, 1e6);
    }

    function test_burnIgnoresAllowance() public {
        vm.prank(sim);
        usd.mint(user, 5e6);
        assertEq(usd.allowance(user, sim), 0);
        vm.prank(sim);
        usd.burn(user, 2e6);
        assertEq(usd.balanceOf(user), 3e6);
        vm.prank(sim);
        vm.expectRevert(MockERC20.InsufficientBalance.selector);
        usd.burn(user, 4e6);
    }

    function test_ownerMintsAndOnlyOwnerAuthorizes() public {
        usd.mint(user, 1e6);
        assertEq(usd.balanceOf(user), 1e6);
        vm.prank(stranger);
        vm.expectRevert(MockERC20.NotOwner.selector);
        usd.setAuthorized(stranger, true);
    }

    function test_transferAndTransferFrom() public {
        usd.mint(user, 10e6);
        vm.prank(user);
        usd.transfer(stranger, 3e6);
        assertEq(usd.balanceOf(stranger), 3e6);

        vm.prank(user);
        usd.approve(stranger, 2e6);
        vm.prank(stranger);
        vm.expectRevert(MockERC20.InsufficientAllowance.selector);
        usd.transferFrom(user, stranger, 3e6);
        vm.prank(stranger);
        usd.transferFrom(user, stranger, 2e6);
        assertEq(usd.balanceOf(user), 5e6);
        assertEq(usd.allowance(user, stranger), 0);
    }
}
