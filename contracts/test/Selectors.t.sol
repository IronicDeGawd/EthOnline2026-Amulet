// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {PositionSim} from "../src/PositionSim.sol";
import {SwapSim} from "../src/SwapSim.sol";
import {AmuletLog} from "../src/AmuletLog.sol";

/// @dev These constants are what the brain (`config.ts`), the firmware policy check, and the ENS
/// `amulet.allowed` record pin. If a signature changes, this test fails before anything else does.
contract SelectorsTest is Test {
    function test_pinnedSelectors() public pure {
        assertEq(PositionSim.supply.selector, bytes4(0x047fc9aa), "supply()");
        assertEq(PositionSim.withdraw.selector, bytes4(0x2e1a7d4d), "withdraw(uint256)");
        assertEq(PositionSim.borrow.selector, bytes4(0xc5ebeaec), "borrow(uint256)");
        assertEq(PositionSim.repay.selector, bytes4(0x402d8883), "repay()");
        assertEq(PositionSim.setPrice.selector, bytes4(0x91b7f5ed), "setPrice(uint256)");
        assertEq(SwapSim.exactInputSingle.selector, bytes4(0x414bf389), "exactInputSingle(...)");
        assertEq(AmuletLog.record.selector, bytes4(0x4b2f0fd6), "record(...)");
    }
}
