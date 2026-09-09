## Description

`doc/apdu.md` documents the `SIGN ETH TRANSACTION` (`E0 04`) response as:

| Description | Length |
|-------------|--------|
| v           | 1      |
| r           | 32     |
| s           | 32     |

There is no description of what that `v` byte contains. It is in fact three different
encodings depending on the type of the transaction that was signed, and only one of them
can be used as is.

From `src/features/sign_tx/ui_common_sign_tx.c`:

- Type 1 (EIP-2930), Type 2 (EIP-1559) and Type 4 (EIP-7702) → the byte is the bare
  signature parity, `0` or `1`.
- Legacy with a chain ID in the RLP payload → `chainId * 2 + 35`, plus the parity, plus
  `2` when `CX_ECCINFO_xGTn` is set, truncated to one byte.
- Legacy with no chain ID in the payload → `ETHEREUM_SIGNATURE_V_BASE` (27) plus the same
  offsets.

The same document already documents the convention correctly for
`SIGN EIP 7702 AUTHORIZATION`, whose output row reads
*"Signature parity (0 even, 1 odd) - use as is in EIP 7702"*. This PR brings
`SIGN ETH TRANSACTION` in line with that, and adds the recovery formula for the truncated
legacy case.

### Why this is worth documenting

The failure is silent and points away from its cause. Applying the legacy recovery to a
typed transaction produces a valid signature over a *different* recovered sender, so the
node accepts the transaction as well-formed and rejects it with
`insufficient funds for gas * price + value: balance 0`. That reads as an unfunded account,
not a signature problem. We spent time looking at the wrong thing.

The information is currently only recoverable by reading the app's C source or
`@ledgerhq/hw-app-eth`. Integrators not using the JS libraries — we hit this writing a
transport in C for an embedded target — have no documented path to it.

### What is in the patch

- Names the `v` row and links it to a new subsection.
- Adds **Interpreting the returned `v`**: a three-row table mapping transaction type to
  encoding and to what the client should do with it.
- Adds **Recovering the full `v` for a legacy EIP-155 transaction** with the formula, and
  states explicitly that no recovery is applicable to a typed transaction.
- Notes that `recovery_offset` carries the `xGTn` `+2` case in addition to the parity.

Documentation only. No behavior change.

### Verification

The recovery formula was checked against a faithful reproduction of the byte arithmetic in
`ui_common_sign_tx.c` across 17 chain IDs (including 1, 5, 137, 8453, 42161, 11155111, and
the boundary values 109/110/111, 255, 256, `2^31`, `2^32 - 1`) and all four combinations of
parity and `xGTn` — 68 cases, no mismatches.

The typed-transaction rule was confirmed on hardware: a Nano X running the Ethereum app
signed an EIP-1559 transaction whose `v` byte was `0` and which was accepted on Sepolia
with `yParity = 0x0`
([`0xb7cb3e4a…c074`](https://sepolia.etherscan.io/tx/0xb7cb3e4a3d534a1fb1703578a1a8c7785c59fc5ffc76e82bc98c40b04119c074)).
Deriving the parity the legacy way for that same signature gives `1`, and the resulting
transaction is rejected.

The one limitation left undocumented on purpose: for a chain ID wider than four bytes the
device reads only its four most significant bytes, so the byte cannot be mapped back to a
full `v` at all. The patch says the formula holds for four-byte chain IDs, which covers
every chain in use, rather than describing a case that cannot currently arise. Happy to
expand or drop that sentence.

## Changes include

- [ ] Bugfix (non-breaking change that solves an issue)
- [ ] New feature (non-breaking change that adds functionality)
- [ ] Breaking change (change that is not backwards-compatible and/or changes current functionality)
- [ ] Tests
- [x] Documentation
- [ ] Other (for changes that might not fit in any category)

## Additional comments

Found while building **Amulet** for ETHOnline 2026: an ESP32-S3 pendant that talks to a
Nano X over BLE and is the only path by which an AI agent's proposed transactions can reach
the device for on-device confirmation. The transport and the transaction encoders are in C,
which is how we ended up needing the `v` byte's exact semantics rather than inheriting them
from `hw-app-eth`. Source: https://github.com/IronicDeGawd/EthOnline2026-Amulet

Happy to adjust wording, table shape, or heading level to match the maintainers'
preference.
