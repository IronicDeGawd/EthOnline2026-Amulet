// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {AmuletAccount} from "../src/AmuletAccount.sol";
import {PositionSim} from "../src/PositionSim.sol";
import {MockERC20} from "../src/MockERC20.sol";

contract AmuletAccountTest is Test {
    AmuletAccount account;
    PositionSim sim;
    MockERC20 usdc;
    uint256 ownerPk = 0xA11CE;
    address owner;
    address relayer = address(0xBEEF);

    function setUp() public {
        owner = vm.addr(ownerPk);
        usdc = new MockERC20("Sim USDC", "sUSDC", 6);
        sim = new PositionSim("Sim-A", usdc, 1600e8, 8000, 200, 400);
        usdc.setAuthorized(address(sim), true);
        account = new AmuletAccount(owner);
        vm.deal(address(account), 1 ether);
        vm.deal(relayer, 1 ether);
    }

    function sign(string memory summary, string memory action, address market, uint256 amount, uint256 nonce_, uint256 deadline)
        internal
        view
        returns (bytes memory)
    {
        bytes32 h = account.digest(summary, action, market, amount, nonce_, deadline);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(ownerPk, h);
        return abi.encodePacked(r, s, v);
    }

    function test_relayerExecutesWhatTheOwnerSigned() public {
        string memory summary = "Supply 0.05 ETH on Sim-A";
        bytes memory sig = sign(summary, "Supply", address(sim), 0.05 ether, 0, block.timestamp + 600);
        vm.prank(relayer);
        account.execute(summary, "Supply", address(sim), 0.05 ether, block.timestamp + 600, sig);
        assertEq(sim.collateral(address(account)), 0.05 ether);
        assertEq(account.nonce(), 1);
    }

    function test_repayLowersDebt() public {
        bytes memory s1 = sign("Supply 0.05 ETH on Sim-A", "Supply", address(sim), 0.05 ether, 0, block.timestamp + 600);
        account.execute("Supply 0.05 ETH on Sim-A", "Supply", address(sim), 0.05 ether, block.timestamp + 600, s1);
        bytes memory s2 = sign("Borrow 30 sUSDC on Sim-A", "Borrow", address(sim), 30e6, 1, block.timestamp + 600);
        account.execute("Borrow 30 sUSDC on Sim-A", "Borrow", address(sim), 30e6, block.timestamp + 600, s2);
        assertEq(sim.debt(address(account)), 30e6);
        bytes memory s3 = sign("Repay 0.005 ETH on Sim-A", "Repay", address(sim), 0.005 ether, 2, block.timestamp + 600);
        account.execute("Repay 0.005 ETH on Sim-A", "Repay", address(sim), 0.005 ether, block.timestamp + 600, s3);
        assertLt(sim.debt(address(account)), 30e6);
    }

    function test_theSummaryIsPartOfWhatWasSigned() public {
        bytes memory sig = sign("Supply 0.01 ETH on Sim-A", "Supply", address(sim), 0.01 ether, 0, block.timestamp + 600);
        vm.expectRevert(AmuletAccount.BadSignature.selector);
        account.execute("Supply 5 ETH on Sim-A", "Supply", address(sim), 0.01 ether, block.timestamp + 600, sig);
    }

    function test_amountMarketAndActionAreAllBound() public {
        uint256 d = block.timestamp + 600;
        bytes memory sig = sign("Supply 0.01 ETH on Sim-A", "Supply", address(sim), 0.01 ether, 0, d);
        vm.expectRevert(AmuletAccount.BadSignature.selector);
        account.execute("Supply 0.01 ETH on Sim-A", "Supply", address(sim), 0.02 ether, d, sig);
        vm.expectRevert(AmuletAccount.BadSignature.selector);
        account.execute("Supply 0.01 ETH on Sim-A", "Withdraw", address(sim), 0.01 ether, d, sig);
        vm.expectRevert(AmuletAccount.BadSignature.selector);
        account.execute("Supply 0.01 ETH on Sim-A", "Supply", address(0xdead), 0.01 ether, d, sig);
    }

    function test_replayIsRefused() public {
        uint256 d = block.timestamp + 600;
        bytes memory sig = sign("Supply 0.01 ETH on Sim-A", "Supply", address(sim), 0.01 ether, 0, d);
        account.execute("Supply 0.01 ETH on Sim-A", "Supply", address(sim), 0.01 ether, d, sig);
        vm.expectRevert(AmuletAccount.BadSignature.selector); // nonce moved on, so the digest differs
        account.execute("Supply 0.01 ETH on Sim-A", "Supply", address(sim), 0.01 ether, d, sig);
    }

    function test_expiredIntent() public {
        uint256 d = block.timestamp + 10;
        bytes memory sig = sign("Supply 0.01 ETH on Sim-A", "Supply", address(sim), 0.01 ether, 0, d);
        vm.warp(d + 1);
        vm.expectRevert(AmuletAccount.Expired.selector);
        account.execute("Supply 0.01 ETH on Sim-A", "Supply", address(sim), 0.01 ether, d, sig);
    }

    function test_someoneElsesSignatureIsWorthless() public {
        uint256 d = block.timestamp + 600;
        bytes32 h = account.digest("Supply 0.01 ETH on Sim-A", "Supply", address(sim), 0.01 ether, 0, d);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(0xB0B, h);
        vm.expectRevert(AmuletAccount.BadSignature.selector);
        account.execute("Supply 0.01 ETH on Sim-A", "Supply", address(sim), 0.01 ether, d, abi.encodePacked(r, s, v));
    }

    function test_unknownAction() public {
        uint256 d = block.timestamp + 600;
        bytes memory sig = sign("Dance", "Dance", address(sim), 0, 0, d);
        vm.expectRevert(AmuletAccount.UnknownAction.selector);
        account.execute("Dance", "Dance", address(sim), 0, d, sig);
    }

    function test_onlyTheOwnerSweeps() public {
        vm.prank(relayer);
        vm.expectRevert(AmuletAccount.NotOwner.selector);
        account.sweep(payable(relayer));
        uint256 before = owner.balance;
        vm.prank(owner);
        account.sweep(payable(owner));
        assertEq(owner.balance, before + 1 ether);
    }

    function test_domainMatchesTheTypedDataTheDeviceIsSent() public view {
        bytes32 expected = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256(bytes("Amulet")),
                keccak256(bytes("1")),
                block.chainid,
                address(account)
            )
        );
        assertEq(account.domainSeparator(), expected);
    }
}
