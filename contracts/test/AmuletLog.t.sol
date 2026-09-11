// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {AmuletLog} from "../src/AmuletLog.sol";

contract AmuletLogTest is Test {
    AmuletLog alog;

    function setUp() public {
        alog = new AmuletLog();
    }

    function test_anyoneRecordsWithAllFields() public {
        address sender = makeAddr("brain-hot-key");
        bytes32 id = keccak256("proposal-1");
        address target = makeAddr("sim");
        vm.roll(123);
        vm.expectEmit(true, true, true, true);
        emit AmuletLog.Action(sender, id, target, "repay", 0.01 ether, bytes4(0x402d8883), 2, 0, 123);
        vm.prank(sender);
        alog.record(id, "repay", target, 0.01 ether, bytes4(0x402d8883), 2, 0);
    }

    /// A request that named no agent still records; the history shows the blank rather than hiding it.
    function test_unnamedAgentRecords() public {
        bytes32 id = keccak256("proposal-2");
        address target = makeAddr("sim");
        vm.expectEmit(true, true, true, true);
        emit AmuletLog.Action(address(this), id, target, "", 0, bytes4(0x047fc9aa), 2, 2, block.number);
        alog.record(id, "", target, 0, bytes4(0x047fc9aa), 2, 2);
    }
}
