# The Graph — how Amulet uses it

Two directions. The agent reads the market from subgraphs before it thinks, and it writes every
decision to a subgraph of its own so that it — and anyone else — can read them back.

## Our subgraph: `amulet-decisions`

Indexes `AmuletLog` on Sepolia. Every proposal the pendant answered becomes a row: who asked,
what for, how much, and what the wrist said.

| piece | where |
|---|---|
| Schema and mapping | [`subgraph/`](../subgraph/) — `Action`, `Agent`, `Target`, `DailyStat` |
| Tests | [`subgraph/tests/action.test.ts`](../subgraph/tests/action.test.ts) — every outcome bucket, the buckets summing to `requests`, the day boundary, two events in one transaction |
| The log it indexes | [`contracts/src/AmuletLog.sol`](../contracts/src/AmuletLog.sol) |
| Endpoint | `https://api.studio.thegraph.com/query/1758963/amulet-decisions/v0.1.0` |

Refusals are indexed too. A dashboard that only showed approvals would be hiding the point.

## Who reads it

**The agent, before it decides.** [`brain/src/data/graph/history.ts`](../brain/src/data/graph/history.ts)
fetches the agent's own past requests and puts a line in the model's prompt: *1 past request,
0 approved, 1 refused*. An agent that cannot see what it already asked for asks again, and being
refused twice for the same reason is the most annoying thing a wearable can do. The counters in
the mapping are therefore load-bearing — a miscount silently changes behaviour — which is why they
are tested.

**The dashboard.** [`web/app/src/proof/useSubgraph.ts`](../web/app/src/proof/useSubgraph.ts)
runs one query in the browser, no key, no server of ours in the way. Every row links to its
transaction on Etherscan.

## The market data

[`brain/src/data/graph/lending.ts`](../brain/src/data/graph/lending.ts) reads the Messari
lending subgraphs for Aave V3, Compound V3 and Spark on mainnet: utilisation, supply and borrow
rates, liquidation thresholds. [`yield.ts`](../brain/src/data/graph/yield.ts) ranks the three
per asset so the yield agent can see when another venue beats the current one by more than the
threshold on its ENS name.

[`freshness.ts`](../brain/src/data/graph/freshness.ts) checks every answer's indexed block
against the chain head. A stale subgraph is dropped, not trusted: a decision made on old data is
worse than no decision. The deployment id and block are carried as evidence on every proposal.
