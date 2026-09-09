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
        address agent = makeAddr("brain-hot-key");
        bytes32 id = keccak256("proposal-1");
        address target = makeAddr("sim");
        vm.roll(123);
        vm.expectEmit(true, true, true, true);
        emit AmuletLog.Action(agent, id, target, 0.01 ether, bytes4(0x402d8883), 2, 0, 123);
        vm.prank(agent);
        alog.record(id, target, 0.01 ether, bytes4(0x402d8883), 2, 0);
    }
}
