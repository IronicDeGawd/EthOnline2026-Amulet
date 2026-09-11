// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice The agent's on-chain memory. Anyone may record; the custom subgraph indexes the events.
/// The Ledger never signs this — the brain's status hot key writes it after every decision, so
/// refusals are visible too. `agent` is the ENS label the request claimed (empty when it claimed
/// none); it is what makes the history readable per agent rather than per hot key.
contract AmuletLog {
    /// @dev outcome: 0 approved, 1 rejected, 2 policy_reject, 3 expired.
    event Action(
        address indexed sender,
        bytes32 indexed proposalId,
        address indexed target,
        string agent,
        uint256 value,
        bytes4 selector,
        uint8 tier,
        uint8 outcome,
        uint256 blockNumber
    );

    function record(
        bytes32 proposalId,
        string calldata agent,
        address target,
        uint256 value,
        bytes4 selector,
        uint8 tier,
        uint8 outcome
    ) external {
        emit Action(msg.sender, proposalId, target, agent, value, selector, tier, outcome, block.number);
    }
}
