// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {PositionSim} from "./PositionSim.sol";

interface IPriceSource {
    function price() external view returns (uint256);
}

interface IERC20 {
    function approve(address spender, uint256 amount) external returns (bool);
}

interface ISwapSim {
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

    function exactInputSingle(ExactInputSingleParams calldata p) external payable returns (uint256);
    function priceSource() external view returns (address);
    function stable() external view returns (address);
    function WETH9() external view returns (address);
    function FEE_BPS() external view returns (uint256);
}

/// @notice A position held on the Ledger's behalf, moved only by what the Ledger signed.
///
/// The Nano X cannot read our calldata: decoding a contract call needs a descriptor that only
/// Ledger can sign and only for mainnet contracts. It can, however, read typed data — it lays
/// out an EIP-712 message field by field from the message itself, with nothing registered
/// anywhere. So the pendant builds the intent as typed data, the Ledger shows the sentence and
/// the figures, and this account executes exactly that.
///
/// Gas is paid by whoever relays the signed intent. A relayer can choose not to send it, and
/// can send nothing else: the signature covers the action, the market, the amount, the nonce
/// and the deadline, and the owner is fixed at construction.
contract AmuletAccount {
    /// @dev keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)")
    bytes32 private constant DOMAIN_TYPEHASH = 0x8b73c3c69bb8fe3d512ecc4cf759cc79239f7b179b0ffacaa9a75d522b39400f;
    /// @dev keccak256("Action(string summary,string action,address market,uint256 amount,uint256 nonce,uint256 deadline)")
    bytes32 public constant ACTION_TYPEHASH = keccak256(
        "Action(string summary,string action,address market,uint256 amount,uint256 nonce,uint256 deadline)"
    );

    address public immutable owner; // the Ledger account
    uint256 public nonce;

    event Executed(address indexed market, string action, uint256 amount, uint256 nonce);
    event Funded(address indexed from, uint256 amount);

    error BadSignature();
    error WrongNonce(uint256 expected, uint256 got);
    error Expired();
    error UnknownAction();
    error NotOwner();
    error TransferFailed();

    constructor(address owner_) {
        owner = owner_;
    }

    receive() external payable {
        emit Funded(msg.sender, msg.value);
    }

    function domainSeparator() public view returns (bytes32) {
        return keccak256(
            abi.encode(DOMAIN_TYPEHASH, keccak256(bytes("Amulet")), keccak256(bytes("1")), block.chainid, address(this))
        );
    }

    /// @notice The digest the Ledger signs. The summary is part of it, so the sentence shown on
    /// the device and on the pendant cannot be swapped for a different one after the fact.
    function digest(
        string calldata summary,
        string calldata action,
        address market,
        uint256 amount,
        uint256 nonce_,
        uint256 deadline
    ) public view returns (bytes32) {
        bytes32 structHash = keccak256(
            abi.encode(
                ACTION_TYPEHASH,
                keccak256(bytes(summary)),
                keccak256(bytes(action)),
                market,
                amount,
                nonce_,
                deadline
            )
        );
        return keccak256(abi.encodePacked("\x19\x01", domainSeparator(), structHash));
    }

    /// @notice Execute one signed intent. Anyone may relay it; only the owner's signature counts.
    function execute(
        string calldata summary,
        string calldata action,
        address market,
        uint256 amount,
        uint256 deadline,
        bytes calldata signature
    ) external {
        if (block.timestamp > deadline) revert Expired();
        bytes32 h = digest(summary, action, market, amount, nonce, deadline);
        if (_recover(h, signature) != owner) revert BadSignature();
        uint256 used = nonce;
        unchecked {
            nonce = used + 1;
        }

        bytes32 kind = keccak256(bytes(action));
        if (kind == keccak256("Supply")) {
            PositionSim(market).supply{value: amount}();
        } else if (kind == keccak256("Repay")) {
            PositionSim(market).repay{value: amount}();
        } else if (kind == keccak256("Withdraw")) {
            PositionSim(market).withdraw(amount);
        } else if (kind == keccak256("Borrow")) {
            PositionSim(market).borrow(amount);
        } else if (kind == keccak256("Swap")) {
            _swap(market, amount, deadline, true);
        } else if (kind == keccak256("Sell")) {
            _swap(market, amount, deadline, false);
        } else {
            revert UnknownAction();
        }
        emit Executed(market, action, amount, used);
    }

    /// @dev The floor is computed here, at execution, from the router's own price source and
    /// the same fee the router charges — one percent under what it should return. Nothing about
    /// that number comes from whoever relayed the intent, so a relayer cannot let the swap go
    /// through at any price it likes. `ethIn` true sells ETH for the stable, false the reverse.
    function _swap(address router, uint256 amount, uint256 deadline, bool ethIn) private {
        ISwapSim r = ISwapSim(router);
        uint256 price = IPriceSource(r.priceSource()).price();
        uint256 expected = ethIn ? (amount * price) / 1e20 : (amount * 1e20) / price;
        expected = (expected * (10_000 - r.FEE_BPS())) / 10_000;
        uint256 minOut = (expected * 99) / 100;
        address stable = r.stable();
        address weth = r.WETH9();
        if (!ethIn) IERC20(stable).approve(router, amount);
        r.exactInputSingle{value: ethIn ? amount : 0}(
            ISwapSim.ExactInputSingleParams({
                tokenIn: ethIn ? weth : stable,
                tokenOut: ethIn ? stable : weth,
                fee: 3000,
                recipient: address(this),
                deadline: deadline,
                amountIn: amount,
                amountOutMinimum: minOut,
                sqrtPriceLimitX96: 0
            })
        );
    }

    /// @notice The owner can always take the account's ETH back out, signed on the device as a
    /// plain transfer. Nothing here is a one-way door.
    function sweep(address payable to) external {
        if (msg.sender != owner) revert NotOwner();
        (bool ok,) = to.call{value: address(this).balance}("");
        if (!ok) revert TransferFailed();
    }

    function _recover(bytes32 h, bytes calldata sig) private pure returns (address) {
        if (sig.length != 65) revert BadSignature();
        bytes32 r = bytes32(sig[0:32]);
        bytes32 s = bytes32(sig[32:64]);
        uint8 v = uint8(sig[64]);
        if (v < 27) v += 27;
        // Reject the malleable upper half of the curve order.
        if (uint256(s) > 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0) revert BadSignature();
        address a = ecrecover(h, v, r, s);
        if (a == address(0)) revert BadSignature();
        return a;
    }
}
