# Amulet

**A wearable pendant that is the only device allowed to carry transactions to your Ledger.**

> Agents propose. Your pendant filters. Your Ledger signs.

Built for [ETHOnline 2026](https://ethglobal.com/events/ethonline2026) · From-Scratch track · Sponsors: **Ledger · The Graph · ENS**

---

## What it is

Amulet is an autonomous DeFi guardian agent whose *brain* runs on an untrusted server and whose *hands* are a pendant on your chest.

- The **brain** watches your on-chain lending positions using live data from The Graph, decides when something needs doing (top up collateral, repay debt, rebalance), and drafts a transaction.
- The **pendant** (ESP32-S3, round touch display, haptic motor) receives the proposal, checks it against a policy stored in your ENS name, shows it on screen, buzzes, and when you swipe, streams it over Bluetooth directly to your **Ledger Nano X**.
- You tap the Ledger. The pendant broadcasts the signed transaction.

No laptop, no phone, no browser extension is in the signing path. The agent can think as much as it wants; it cannot move a single wei without your body being present and your finger on hardware.

## Why

Autonomous agents are useful because they act without you. That is also what makes them dangerous: if an agent has a key, whoever compromises the agent has the key.

Amulet makes the human-in-the-loop a **physical object with one job**. Roughly 1,500 lines of firmware, no app store, no browser, one radio link to one hardware wallet. The brain can be hacked, the WiFi can be hostile, the RPC can lie. None of it matters, because the only thing that turns a proposal into money movement is you, wearing the pendant, tapping the Ledger.

## Architecture

```
┌──────────────────────────┐   WSS   ┌──────────────────────────┐   BLE   ┌──────────────┐
│ BRAIN (untrusted host)   │────────▶│ PENDANT (ESP32-S3)       │────────▶│ LEDGER       │
│ Node/TS                  │         │ round display + touch    │         │ Nano X       │
│                          │◀────────│ haptic · WiFi · NimBLE   │◀────────│ Ethereum app │
│ • Substreams tick        │ status  │                          │ v,r,s   │              │
│ • Graph queries          │         │ • proposal ⊆ ENS policy? │         │ shows tx     │
│   + freshness gate       │         │ • show, buzz, swipe      │         │ you tap      │
│ • rule engine            │         │ • APDU stream to Ledger  │         └──────────────┘
│ • LLM writes rationale   │         │ • assemble signed tx     │
│ • Key Ring secrets       │         │ • eth_sendRawTransaction ─┼──────▶ Sepolia
└──────────────────────────┘         └──────────────────────────┘
            ▲                                    ▲
            │ reads policy                       │ reads policy
            └──────── ENSv2 (Sepolia): guardian.<you>.eth text records ──────┘
```

**Trusted:** the Ledger (holds the key, displays the tx) and the pendant firmware (verifies policy, only channel to the Ledger).
**Untrusted:** the brain host, the network, the RPC, the Graph gateway. Any of them lying or being compromised can cause a *bad proposal*, never a *bad signature*.
**Policy authority:** the Ledger account, via ENS.

## Sponsor integrations

| Sponsor | Role | Where |
|---|---|---|
| **Ledger** | Pendant implements the Ledger BLE APDU transport natively on ESP32-S3 and drives the Ethereum app (`GET PUBLIC KEY`, `SIGN TX`, and the EIP-712 typed-data commands so the device reads the action in words instead of blind-signing bytes). Brain secrets are encrypted under the Ledger Key Ring (`wallet-cli ring`) and decrypted at boot on a host with no USB. The Ledger account is the only one that can edit the agent's policy. | `firmware/main/ledger/`, `contracts/src/AmuletAccount.sol`, `docs/LEDGER_FEEDBACK.md` |
| **The Graph** | Messari standardized lending subgraphs supply live market conditions; one query shape runs against three pinned deployments (Aave v3, Compound v3, Spark) to rank an asset's supply rate across protocols; Substreams is the agent's clock (one tick per block); a custom subgraph on Subgraph Studio indexes the agent's own actions. Every query pins a deployment ID and rejects stale blocks. Stale data puts the pendant in STALE mode and the agent stands down. | `brain/src/data/graph/`, `subgraph/` |
| **ENS** | The agent lives at `guardian.<you>.eth` on ENSv2 Sepolia. Its policy (allowed contracts, max value, thresholds) is text records on a permissioned resolver. Enhanced Access Control gives the Ledger the policy-admin role and the brain a status-only role. The brain cannot raise its own limits. Revoking the subname is the kill switch. | `firmware/main/ens/`, `brain/src/ens/` |

## The policy on ENS

Amulet targets the **ENSv2 Sepolia beta** that the ENS docs pin (`ensdomains/contracts-v2` @ `97a5729`). The name is `guardian.amuletguard.eth`, issued as a real subname with a 30-day expiry under `amuletguard.eth`, with its own Permissioned Resolver and subregistry deployed through the Verifiable Factory. Addresses: `contracts/deployments/ens-11155111.json`.

| Who | Holds | Can |
|---|---|---|
| Ledger account (`0x2118…7736`) | name-wide text-record admin on the resolver, `ROLE_RENEW` on the subname | edit every `amulet.*` policy record, renew or let the name lapse (kill switch) |
| Brain hot key (`0x635D…53CA`) | `authorizeTextRoles` for exactly `amulet.status` and `amulet.last-action` | report what it is doing; nothing else (`setText("amulet.max_value_wei")` reverts with `EACUnauthorizedAccountRoles`) |
| Deployer (`0xfc7e…7aD2`) | root roles from setup | stands in for the Ledger's role when a policy edit is needed without the Nano X in reach |

Records (`amulet.version chain allowed max_value_wei max_token_usd tier1_hf tier2_hf drift_bps presence_timeout_s yield_delta_bps brain endpoint status last-action`) are read by the brain through the Universal Resolver at boot and every ten ticks, and by the pendant straight from the resolver at boot and hourly, cached in NVS. Both sides run the same check (`brain/src/engine/policy.ts`, `firmware/main/policy/policy.c`) against the same test vectors (`brain/test/vectors/policy.json`).

```
pnpm amulet ens show                      # records as any wallet reads them, plus who may edit what
pnpm amulet ens set max_value_wei 2e16    # lower the cap (Ledger role); brain and pendant follow
pnpm amulet attack --value 5              # compromised brain: pendant answers policy_reject
pnpm amulet attack --raise-limit          # hot key tries to edit the policy: reverts
```

## What the Ledger actually reads

A hardware wallet can only describe a contract call if someone published a descriptor for that
contract, and only Ledger can sign one — for mainnet addresses. A hackathon contract on Sepolia
will never have one, so a raw call is signed blind: the device shows bytes and asks you to trust
the screen that sent them.

Typed data is the door Ledger leaves open. The device lays out an EIP-712 message from the
message itself, with nothing registered anywhere. So Amulet holds its position in a small
account contract (`AmuletAccount`) and the pendant sends the Nano X an intent instead of a
transaction:

```
Amulet · chain 11155111 · verifyingContract 0x23cf…8253
summary   Supply 0.01 ETH on Sim-A
action    Supply
market    0x9A6c…467c
amount    10000000000000000
nonce     0
deadline  1757501234
```

The wearer reads that on the device and presses the button. The **summary is inside the signed
message**, so the sentence on the screen is the sentence that executes — nothing downstream can
swap "Repay 0.006" for "Repay 5" after it was approved. The agent then relays the signature and
pays the gas. It can refuse to send it; it cannot alter a word of it, and the account's nonce
kills the signature after one use. The owner can always sweep the balance back out.

The Nano X needs **Verbose EIP712** on in the Ethereum app; otherwise it shows the domain and a
hash. The raw-transaction path still works and is what runs without `--clear`.

```
pnpm amulet run --clear                 # the loop, signing intents
pnpm amulet intent Supply 0.01          # one hand-made intent
```

## Yield opportunities

One Messari lending query runs against three pinned deployments (Aave v3, Compound v3, Spark), each through the same freshness gate, and the asset's supply rates are ranked. When another venue beats the one the position sits in by more than the ENS record `amulet.yield_delta_bps`, and holds that lead for 20 mainnet blocks with ten times the position in deposits, the pendant gets an **options card**: up to three venues, best first, with a footer that says the data is mainnet and the execution is a Sepolia sim.

Nothing is built until a row is tapped. A tap sends the choice back, the brain turns that row into an ordinary tier-2 proposal ("Supply 0.01 ETH on Sim-B"), and it goes through the same policy check, the same hold, the same Ledger tap. A swipe dismisses the card and the idea stays quiet for an hour. A venue whose sim is not in `amulet.allowed` is never listed, so the Ledger decides which venues the agent may ever move into.

```
pnpm amulet yield [--asset WETH]        # the ranked table, with deployment ids and blocks
pnpm amulet run --simulate yield        # a card on the wrist right now
```

## What the LLM does and does not decide

The LLM writes the one-line human summary and the rationale. It **never** chooses the action, the target, or the amount. Those come from deterministic rules over Graph data, bounded by the ENS policy, and re-checked by the pendant before anything reaches the Ledger.

## Repository layout

```
firmware/    ESP-IDF (C) pendant firmware — XIAO ESP32-S3 + Seeed 1.28" round touch display
brain/       Node/TypeScript agent — Graph data, rules, proposal builder, WSS server
contracts/   Foundry — AmuletLog.sol (+ optional PositionSim.sol), Sepolia
subgraph/    Subgraph Studio manifest indexing the Sepolia contracts
docs/        Ledger developer-experience feedback and design notes
```

## Hardware

- Seeed XIAO ESP32-S3
- Seeed Studio 1.28" Round Touch Display for XIAO (GC9A01 + CST816S)
- ERM vibration motor driven through a 2N2222A on D2
- 1S LiPo on the display board's JST connector

## Status

Hackathon in progress (Sep 4 – 13, 2026). This README will grow run instructions, a threat model, and per-sponsor file/line pointers as the components land.

## Future work

- Session keys or a spending-cap contract for truly autonomous tier-1 actions
- LTE module so the pendant works without WiFi
- BLE tethering to a phone as the uplink
- Secure boot v2 + flash encryption on the pendant

## License

MIT
