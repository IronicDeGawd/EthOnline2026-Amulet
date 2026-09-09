// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {MockERC20} from "../src/MockERC20.sol";
import {PositionSim} from "../src/PositionSim.sol";
import {SwapSim, IPriceSource} from "../src/SwapSim.sol";
import {AmuletLog} from "../src/AmuletLog.sol";

/// @notice Deploys the whole sim set and writes `deployments/<chainId>.json`, which the brain,
/// the firmware policy vectors, and the ENS `amulet.allowed` record are all built from.
///
///   forge script script/Deploy.s.sol --rpc-url $SEPOLIA_RPC --broadcast \
///     --private-key $(cat ../.secrets/sepolia-deployer)
contract Deploy is Script {
    uint256 constant INITIAL_PRICE = 2000e8; // $2000, 8 decimals
    uint16 constant LT_BPS = 8000;
    uint256 constant SWAP_RESERVE = 0.02 ether;

    function run() external {
        vm.startBroadcast();

        MockERC20 usd = new MockERC20("Sim USD", "sUSDC", 6);
        PositionSim simA = new PositionSim("Sim-A", usd, INITIAL_PRICE, LT_BPS, 320, 610);
        PositionSim simB = new PositionSim("Sim-B", usd, INITIAL_PRICE, LT_BPS, 510, 720);
        SwapSim swap = new SwapSim(usd, IPriceSource(address(simA)));
        AmuletLog alog = new AmuletLog();

        usd.setAuthorized(address(simA), true);
        usd.setAuthorized(address(simB), true);
        usd.setAuthorized(address(swap), true);
        (bool ok,) = address(swap).call{value: SWAP_RESERVE}("");
        require(ok, "reserve");

        vm.stopBroadcast();

        string memory root = "deploy";
        vm.serializeUint(root, "chainId", block.chainid);
        vm.serializeUint(root, "block", block.number);
        vm.serializeAddress(root, "deployer", msg.sender);
        vm.serializeAddress(root, "sUSDC", address(usd));
        vm.serializeAddress(root, "simA", address(simA));
        vm.serializeAddress(root, "simB", address(simB));
        vm.serializeAddress(root, "swapSim", address(swap));
        vm.serializeAddress(root, "amuletLog", address(alog));
        vm.serializeAddress(root, "weth9Sentinel", swap.WETH9());
        vm.serializeUint(root, "initialPrice", INITIAL_PRICE);
        vm.serializeUint(root, "liquidationThresholdBps", LT_BPS);

        string memory sel = "selectors";
        vm.serializeString(sel, "supply", vm.toString(abi.encodePacked(PositionSim.supply.selector)));
        vm.serializeString(sel, "withdraw", vm.toString(abi.encodePacked(PositionSim.withdraw.selector)));
        vm.serializeString(sel, "borrow", vm.toString(abi.encodePacked(PositionSim.borrow.selector)));
        vm.serializeString(sel, "repay", vm.toString(abi.encodePacked(PositionSim.repay.selector)));
        vm.serializeString(sel, "setPrice", vm.toString(abi.encodePacked(PositionSim.setPrice.selector)));
        vm.serializeString(sel, "exactInputSingle", vm.toString(abi.encodePacked(SwapSim.exactInputSingle.selector)));
        string memory selJson = vm.serializeString(sel, "record", vm.toString(abi.encodePacked(AmuletLog.record.selector)));

        string memory json = vm.serializeString(root, "selectors", selJson);
        string memory path = string.concat("deployments/", vm.toString(block.chainid), ".json");
        vm.writeJson(json, path);
        console.log("wrote", path);
    }
}
