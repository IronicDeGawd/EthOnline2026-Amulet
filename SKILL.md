# Amulet — what an agent can do here, and what stops it

A short operator's guide: the data the agent reads, the decisions it may make, the limits it is
held to, and how to run each part. Full design is in `README.md`.

## The loop

1. **Read.** The Graph, through the gateway with a Studio key: Messari standardized lending
   subgraphs for Aave v3, Compound v3 and Spark, pinned by deployment ID.
2. **Gate.** Every answer carries its deployment ID and block. A block older than the freshness
   threshold, or an answer from a deployment that is not the pinned one, is refused — the agent
   stands down and the pendant shows STALE rather than acting on old numbers.
3. **Decide.** Nova Lite is given the position, the market, the ranked venues, that provenance,
   and the agent's own policy including its cap. It answers with an action and an amount, or it
   stands down.
4. **Check.** The answer is validated against the policy, and the displayed figures are
   recomputed from the chain's own arithmetic.
5. **Ask.** The proposal goes to the pendant, which checks it again against the policy it read
   from ENS itself, shows the agent's face and the request, and waits for a hold.
6. **Sign.** The Ledger shows the action as an EIP-712 sentence and signs it. The brain only
   relays and pays gas.
7. **Record.** Every outcome — approved, rejected, refused by the device, expired — is written to
   `AmuletLog` and indexed by this project's own subgraph.

## Data sources

| Source | What it gives | Pinned |
|---|---|---|
| Messari lending subgraphs (Aave v3, Compound v3, Spark) | supply/borrow rates, utilization, liquidity | deployment ID per protocol in `brain/src/config.ts` |
| `amulet-decisions` (this project's subgraph) | every decision the wearer made, per agent | `subgraph/` |
| ENSv2 Sepolia text records | each agent's policy, face and status | `brain/src/ens/` |
| Sepolia sims | the guarded position | `contracts/src/PositionSim.sol` |

## What an agent may decide

`REPAY_DEBT`, `ADD_COLLATERAL`, `MOVE_SUPPLY`, `ADVISORY`, or nothing. Anything else is dropped.

## What holds it

Its ENS name carries the limits: which contracts it may touch, which functions it may call, the
most it may spend in one action, the health-factor thresholds it acts on, and how much better a
rate must be before moving is worth an interruption. The agent's own key cannot edit those
records — only the Ledger account can. Revoking the name removes the agent.

## Commands

```
pnpm amulet decide [--agent repay|yield]   # what the model would propose now, and the verdict
pnpm amulet run [--agent <name>] [--rules] # the full loop; --rules takes the model out of it
pnpm amulet yield [--asset WETH]           # the ranked venues, with deployment IDs and lag
pnpm amulet status                         # one round of reads, no pendant
pnpm amulet demo                           # one key per scenario, pendant connected throughout
pnpm amulet ens show|set|issue|revoke      # the policy and the agents on ENS
pnpm amulet attack [--value|--target|--as] # play a compromised brain
```

## Failure modes worth knowing

- Stale or wrong-deployment data → the agent stands down; it does not guess.
- The model unreadable or slow → the deterministic rules answer instead.
- The model over its cap or naming a market it may not touch → dropped in the brain, and
  refused again on the pendant if it ever got that far.
- The pendant away → nothing is proposed; the brain does not act alone.
- Known gap: a proposal is not signed by the agent's own key, so a compromised brain could put
  another agent's name on its request.
