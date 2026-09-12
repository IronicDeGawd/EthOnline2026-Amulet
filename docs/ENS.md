# ENS — how Amulet uses it

The rules live on a name, not in the agent's configuration. That is the whole difference: an
agent can edit its own config, and so can anyone who reaches its server. It cannot edit a text
record that only a Ledger signature may write.

## The names

On the ENSv2 Sepolia beta, under `amuletguard.eth`:

| name | role | cap |
|---|---|---|
| `guardian.amuletguard.eth` | the policy: thresholds, allow-list, status | — |
| `repay.amuletguard.eth` | the repay bot | 0.05 ETH |
| `yield.amuletguard.eth` | the yield scout | 0.01 ETH |
| `swap.amuletguard.eth` | the swap desk | 0.02 ETH |

Each agent is a subname with its own `amulet.*` records: its cap, its allowed contracts and
functions, its face. Three agents, three leashes, and the Ledger can loosen one without
loosening another.

## Who may write what

| record | who signs |
|---|---|
| `amulet.max_value_wei`, `amulet.allowed`, `amulet.tier*_hf` and the rest of the policy | the Ledger account only |
| `amulet.status`, `amulet.last-action` | the agent's hot key — and nothing else |

A Permissioned Resolver enforces this on chain. When the agent tries to raise its own cap (`8`
in the demo), the resolver reverts. That refusal is the ENS track's best demonstration.

## Where it is read

**By the pendant itself.** [`firmware/main/ens/ens.c`](../firmware/main/ens/ens.c) reads the
records straight off the resolver with `eth_call` — no agent in the way — and keeps the last
good copy in flash. A pendant that boots without the network enforces the policy it last saw.
This is why the agent cannot lie to the wrist about its own limits.

**By the agent.** [`brain/src/ens/resolver.ts`](../brain/src/ens/resolver.ts) reads the same
records through the Universal Resolver, the way any wallet would, and refuses to run at all if
the policy is incomplete. A name with no policy is not "anything goes".

## Where it is written

| piece | where |
|---|---|
| Registration, resolver, subregistry, roles, issuing each agent | [`brain/src/ens/setup.ts`](../brain/src/ens/setup.ts) |
| The two records the agent may write | [`brain/src/ens/status.ts`](../brain/src/ens/status.ts) |
| The agent's face, as a standard `avatar` record | [`brain/src/agents/face.ts`](../brain/src/agents/face.ts) — the same 16×16 the pendant draws, so a wallet shows the agent the way the wrist does |

Every record is readable in the ENS app: [guardian.amuletguard.eth](https://sepolia.app.ens.domains/guardian.amuletguard.eth).

Friction found along the way is logged in [`ENS_FEEDBACK.md`](./ENS_FEEDBACK.md).
