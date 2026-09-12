# Ledger — how Amulet uses it

The Nano X is the only thing in this project that can sign. Everything else — the agent on
its server, the pendant on your chest — carries words and signatures around it.

## The claim, in one sentence

A proposal reaches the Ledger only after a pendant with no key has checked it against rules on
your ENS name, and the Ledger shows you the same sentence the pendant did before it signs.

## What was built

| piece | where | what it does |
|---|---|---|
| The Nano X's own Bluetooth transport, on an ESP32-S3 | [`firmware/main/ledger/ble_transport.c`](../firmware/main/ledger/ble_transport.c) | Frames on the write and notify characteristics, tags `0x00` GET VERSION, `0x01` INIT, `0x05` APDU, `0x08` GET MTU. Ported from the JS transport's source, in C, on NimBLE. |
| The Ethereum app's commands | [`firmware/main/ledger/apdu_eth.c`](../firmware/main/ledger/apdu_eth.c) | GET PUBLIC KEY, SIGN ETH TRANSACTION, SIGN ETH EIP712. |
| Typed data the device shows in words | [`firmware/main/ledger/eip712.c`](../firmware/main/ledger/eip712.c) | The pendant builds an EIP-712 `Action` and the Nano X clear-signs it, so the device displays *Repay 0.006 ETH on Aave (sim)* rather than calldata. Needs "Verbose EIP712" on in the Ethereum app. |
| The account on chain | [`contracts/src/AmuletAccount.sol`](../contracts/src/AmuletAccount.sol) | Holds the position. `execute()` recovers the signer from the typed data, checks it is the Ledger's key, checks the nonce and deadline, then acts. It holds no key of its own. |
| The relayer | [`brain/src/chain/account712.ts`](../brain/src/chain/account712.ts) | The agent carries the signature to the chain and pays the gas. It cannot alter a word of the intent without breaking the signature. |
| The connection itself | [`firmware/main/app_main.c`](../firmware/main/app_main.c) | On demand: the pendant connects when a proposal arrives and drops the link sixty seconds after the last use, so a Ledger in a pocket is not held awake. |

## What the wearer sees

1. The pendant buzzes and shows the proposal: verb, amount, market, and the rule that fired.
2. You hold your thumb on it. The arc fills.
3. The Ledger wakes over Bluetooth and shows the same sentence on its own screen.
4. You press. The signature goes back through the pendant to the agent, which relays it.
5. Mined. The decision, approved or refused, is written to AmuletLog.

Two screens have to agree. A phone can show you one thing and send another; the Ledger
decodes the intent itself, on a screen wired to the chip that holds the key.

## Clear signing: typed data, and the ERC-7730 descriptors

Two ways to make a Nano X show words instead of bytes, and Amulet uses both.

**Typed data is the path the demo takes.** The pendant builds an EIP-712 `Action` — summary,
action, market, amount, nonce, deadline — and the Ethereum app renders each field on its own
screen with no descriptor at all, because the structure is in the message. This is why the
Ledger shows *Repay 0.006 ETH on Aave (sim)* the moment the pendant does, and why the account
contract verifies the signature over exactly those fields. The trade is that the account must
exist: the Ledger signs an intent, not a transaction, and a relayer carries it.

**ERC-7730 descriptors cover the other path.** `amulet run --raw` blind-signs the calldata
directly; a wallet that has the descriptor shows it in words instead. They also describe the
account's own `execute()` for anyone reading it in a wallet later. Both files pass Ledger's own
`erc7730 lint`, and every selector is cross-checked against the deployment:

| descriptor | covers |
|---|---|
| [`contracts/erc7730/calldata-AmuletAccount.json`](../contracts/erc7730/calldata-AmuletAccount.json) | `execute(summary, action, market, amount, deadline, signature)` and `sweep(to)` |
| [`contracts/erc7730/calldata-PositionSim.json`](../contracts/erc7730/calldata-PositionSim.json) | `supply()`, `repay()`, `withdraw(amount)`, `borrow(amount)` on both sims |

The labels are within the device's limits — 30 characters for an intent, 20 for a label —
because the linter says anything longer is truncated on screen, and a truncated label is the
blind signing the format exists to prevent.

## What Amulet deliberately does not do

- **No x402 or agent-paid flows.** The brief lists agents paying for what they use. Amulet's
  agent holds no funds and no key that can move them; a hot key holding money on an untrusted
  host is the exact failure the project is built to remove. Payments would have to route
  through the same pendant-then-Ledger path as everything else.
- **No Key Ring on the deployed host.** The agent on EC2 reads a plaintext secrets file,
  because the ring cannot enrol a machine a Ledger is never plugged into. Why, and what would
  fix it, is in [`LEDGER_FEEDBACK.md`](./LEDGER_FEEDBACK.md#4-wallet-cli--key-ring).

## What was found along the way

Porting the transport to a microcontroller with no C reference exposed gaps in the developer
documentation. They are logged as they happened in
[`LEDGER_FEEDBACK.md`](./LEDGER_FEEDBACK.md), and one became an upstream contribution:
[LedgerHQ/app-ethereum#1109](https://github.com/LedgerHQ/app-ethereum/pull/1109) documents the
`v` byte `SIGN ETH TRANSACTION` returns, found by measuring it here.

## Status words worth knowing

- `0x9000` — signed.
- `0x6985` — the wearer pressed reject on the device.
- `0x6a80` / `0x6501` — the Ethereum app needs "Verbose EIP712" turned on.
- `0x0000` — the device never answered at all: Bluetooth dropped or the app closed. Not a refusal.
