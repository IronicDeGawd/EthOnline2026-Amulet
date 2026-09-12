# The Graph developer-experience feedback — Amulet (ETHOnline 2026)

Findings from reading the Messari lending subgraphs for Aave V3, Compound V3 and Spark, and
from building and testing our own subgraph on Subgraph Studio. Shorter than the Ledger log
because less went wrong; each item cost real time.

## Reading the standard lending subgraphs

- **Fields come back `null` that the schema does not mark nullable.** Spark's markets return
  `name: null`. The first version of our ranker crashed on it. Either the standardized schema
  should mark which fields a protocol may leave empty, or the indexers should fill a fallback.
  We now tolerate it (`market: m.name ?? `${protocol} ${symbol}``), which is a guess.
- **There is no way to identify Compound V3's base market.** The question "which market is the
  WETH one" has no field; we match on the name starting with `Compound V3 WETH`. A boolean or an
  enum on the market entity would remove a heuristic that breaks the day someone renames it.
- **Freshness has to be built by the consumer.** `_meta.block.number` is there, but nothing
  tells you what "fresh enough" means for a given deployment, and a stale deployment answers
  happily. We compare every answer's block to the chain head ourselves and drop it past a lag.
  A per-deployment "healthy lag" hint, or a warning in the response when the indexer is behind,
  would stop every consumer re-inventing the same check.
- **Deployment ids are the trust anchor and are hard to find.** We pin the deployment id, not
  the subgraph name, so a redeploy cannot silently change the data under the agent. Finding the
  id for a given version takes a trip through the Explorer UI; a stable URL that returns it
  would make pinning the default rather than the exception.

## Building our own subgraph

- **`graph test` does not run under pnpm out of the box.** matchstick fails with
  `No such file or directory: node_modules/assemblyscript/bin/asc` until `assemblyscript` is
  added as an explicit dev dependency, because pnpm does not hoist `graph-cli`'s copy. One line
  in the testing docs would save an hour.
- **matchstick's binary download is the slow part of every first run** and there is no message
  saying it is happening; the command just hangs. A progress line would stop people killing it.
- **A subgraph can only index what the contract emitted.** Ours stores a selector, a target and
  a value in wei, so the dashboard shows *Supply · 0.005 ETH · Sim-A* rebuilt from tables, not
  the sentence the wearer actually read. Not The Graph's fault, but worth a line in any guide
  for agent builders: emit the words you will want to display, because you cannot add them later.

## What worked without friction

- One query shape ran unchanged against three deployments. The standardized schema is the
  reason the yield ranker is forty lines.
- Studio's deploy-and-query loop was fast enough to iterate the mapping against real Sepolia
  events in minutes.
- The agent reading its own history from the subgraph before it proposes turned out to be the
  most useful thing in the project. It is one query.
