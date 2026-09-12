# ENS developer-experience feedback — Amulet (ETHOnline 2026)

Findings from putting an agent's policy on ENS: three agents as subnames under
`amuletguard.eth` on the ENSv2 Sepolia beta, their limits as text records on a permissioned
resolver, the Ledger holding the policy role and the agent's key holding a status-only role.
The pendant reads the records straight off the resolver; the agent reads them through the
Universal Resolver.

## Access control

- **The role bitmaps are exactly the feature that makes ENS right for agent policy, and they
  are undocumented for this use.** "The Ledger may write these records, the agent may write
  those two and nothing else" is the whole security story. Getting it right meant reading
  `contracts-v2` source and constructing the admin masks by hand (`adm(r) = r | (r << 128)`).
  A worked example — one owner, one delegate, two record sets — would make this the obvious
  pattern instead of a discovery.
- **A resolver revert is correct but opaque.** When the agent tries to raise its own cap the
  permissioned resolver reverts, which is the demo's best moment, and the revert carries no
  reason. A reason string (`NotAuthorised(key, caller)`) would make that refusal readable in a
  wallet or an explorer, which is where a human would look.
- **Per-record permission is per-key-string, so a typo is a silent grant of nothing.** Granting
  `amulet.status` and writing `amulet.Status` fails at write time, not at grant time. Nothing
  can catch this on chain; the tooling could at least warn on a grant for a key that has never
  been set.

## Writing records

- **Everything assumes you rewrite the whole set.** Editing one agent's cap meant a multicall
  of all seven of its records until we wrote a targeted single-`setText` path. With a nearly
  empty deployer that difference decided whether the second write landed at all. A CLI or SDK
  helper for "set one text record on one name" would be used more than any other call.
- **Nothing tells a reader that a record changed.** The pendant polls the resolver on a timer,
  and the agent sends the wrist a "re-read now" message after it writes, so the device is not
  an hour behind. An event on `setText` is there but a low-power device cannot watch logs; a
  cheap "records version" per name, readable in one call, would let it refresh only when
  something moved.
- **The v2 beta's registration flow has many steps and the order matters.** Register, deploy
  a resolver, deploy a subregistry, issue the child with an expiry, grant roles, then write —
  and a step done out of order fails late. Our `ensSetup` records each step in a state file so
  a rerun resumes. A checklist in the beta docs, in that order, would have saved a session.

## Reading records

- **The Universal Resolver is the right way to read from a server and the wrong way from a
  microcontroller.** It needs the wildcard-resolution dance; on the pendant we call the
  resolver directly with `eth_call text(node, key)` because we already know the resolver
  address from the setup. Fine for us, but a device that only knows a name has no light path.
- **`avatar` as a standard record was a gift.** The same 16×16 face the pendant draws is the
  agent's avatar in any wallet. More records like it — a `description` a wallet renders, a
  `status` it shows — would let an agent's ENS name be its whole public profile.

## What worked without friction

- Subnames as agent identities. Three agents, three leashes, one parent; the Ledger can loosen
  one without loosening another, and revoking the subname is the kill switch.
- Text records as policy. A cap that only a hardware wallet can change, readable by anything
  that speaks ENS, is a better place for a limit than any config file.
