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
| **Ledger** | Pendant implements the Ledger BLE APDU transport natively on ESP32-S3 and drives the Ethereum app (`GET PUBLIC KEY`, `SIGN TX`). Brain secrets are encrypted under the Ledger Key Ring (`wallet-cli ring`) and decrypted at boot on a host with no USB. The Ledger account is the only one that can edit the agent's policy. | `firmware/main/ledger/`, `brain/src/secrets/`, `docs/LEDGER_FEEDBACK.md` |
| **The Graph** | Messari standardized lending subgraphs supply live market conditions; Substreams is the agent's clock (one tick per block); a custom subgraph on Subgraph Studio indexes the agent's own actions. Every query pins a deployment ID and rejects stale blocks. Stale data puts the pendant in STALE mode and the agent stands down. | `brain/src/data/graph/`, `subgraph/` |
| **ENS** | The agent lives at `guardian.<you>.eth` on ENSv2 Sepolia. Its policy (allowed contracts, max value, thresholds) is text records on a permissioned resolver. Enhanced Access Control gives the Ledger the policy-admin role and the brain a status-only role. The brain cannot raise its own limits. Revoking the subname is the kill switch. | `firmware/main/ens/`, `brain/src/ens/` |

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
