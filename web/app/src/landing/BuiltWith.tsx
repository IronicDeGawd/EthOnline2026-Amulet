/* Three sponsor tracks and three tools. Every link points at the thing itself, not a homepage. */
const REPO = 'https://github.com/IronicDeGawd/EthOnline2026-Amulet'
const SCAN = 'https://sepolia.etherscan.io'

type Link = { href: string; label: string }
type Tile = { name: string; kind: string; text: string; href: string; label: string; more?: Link[] }

const TILES: Tile[] = [
  { name: 'Ledger', kind: 'track',
    text: "Signs every transaction. The pendant speaks the Nano X's Bluetooth transport itself, ported to the ESP32, and sends EIP-712 typed data so the device clear-signs the same words the wrist saw. The account on chain verifies that signature; the agent only carries it and pays the gas. Measuring the device turned up a documentation gap, now filed upstream.",
    href: `${REPO}/blob/main/firmware/main/ledger/ble_transport.c`, label: 'firmware/main/ledger/ble_transport.c · the Nano X transport on an ESP32',
    more: [
      { href: `${REPO}/blob/main/firmware/main/ledger/eip712.c`, label: 'firmware/main/ledger/eip712.c · typed data the device shows in words' },
      { href: `${REPO}/blob/main/firmware/main/ledger/apdu_eth.c`, label: 'firmware/main/ledger/apdu_eth.c · the Ethereum app commands' },
      { href: `${REPO}/blob/main/contracts/src/AmuletAccount.sol`, label: 'contracts/src/AmuletAccount.sol · verifies the signature, holds no key' },
      { href: `${REPO}/blob/main/brain/src/chain/account712.ts`, label: 'brain/src/chain/account712.ts · the agent relays, cannot alter a word' },
      { href: 'https://github.com/LedgerHQ/app-ethereum/pull/1109', label: 'LedgerHQ/app-ethereum#1109 · upstream contribution' },
    ] },
  { name: 'The Graph', kind: 'track',
    text: 'Remembers every decision. Our own subgraph indexes AmuletLog; the dashboard reads it, and so does each agent before it proposes, learning from its own refusals. The market data the agent reasons over comes from the Aave, Compound and Spark subgraphs.',
    href: `${REPO}/tree/main/subgraph`, label: 'subgraph/ · the mapping and schema',
    more: [
      { href: `${REPO}/blob/main/brain/src/data/graph/history.ts`, label: 'brain/src/data/graph/history.ts · the agent reads its own past' },
      { href: `${REPO}/blob/main/brain/src/data/graph/lending.ts`, label: 'brain/src/data/graph/lending.ts · Aave, Compound, Spark' },
      { href: `${REPO}/blob/main/web/app/src/proof/useSubgraph.ts`, label: 'web/app/src/proof/useSubgraph.ts · the dashboard' },
    ] },
  { name: 'ENS', kind: 'track',
    text: 'Names the agents and holds the rules. repay, yield and swap each live under amuletguard.eth with a cap and an allow-list only a Ledger signature can edit. The pendant reads those records itself, straight off the resolver, and keeps the last copy so it enforces them even when it boots offline.',
    href: `${REPO}/blob/main/firmware/main/ens/ens.c`, label: 'firmware/main/ens/ens.c · the pendant reads the policy',
    more: [
      { href: `${REPO}/blob/main/brain/src/ens/setup.ts`, label: 'brain/src/ens/setup.ts · names, resolver, roles' },
      { href: `${REPO}/blob/main/brain/src/ens/status.ts`, label: 'brain/src/ens/status.ts · the only records the agent may write' },
      { href: 'https://sepolia.app.ens.domains/guardian.amuletguard.eth', label: 'guardian.amuletguard.eth · the policy name' },
      { href: 'https://sepolia.app.ens.domains/repay.amuletguard.eth', label: 'repay.amuletguard.eth · cap 0.05 ETH' },
      { href: 'https://sepolia.app.ens.domains/yield.amuletguard.eth', label: 'yield.amuletguard.eth · cap 0.01 ETH' },
      { href: 'https://sepolia.app.ens.domains/swap.amuletguard.eth', label: 'swap.amuletguard.eth · cap 0.02 ETH' },
    ] },
  { name: 'Chainlink', kind: 'tool',
    text: 'Prices the account. The ETH/USD feed on Sepolia is the number the portfolio screen and the swap arithmetic use.',
    href: `${SCAN}/address/0x694AA1769357215DE4FAC081bf1f309aDC325306`, label: 'ETH/USD feed on Sepolia' },
  { name: 'LI.FI', kind: 'tool',
    text: 'Finds the route. Swap requests from the wrist are quoted against mainnet routes before the agent proposes one on the test venue.',
    href: `${REPO}/blob/main/brain/src/tx/swap.ts`, label: 'brain/src/tx/swap.ts' },
  { name: 'Amazon Nova Lite', kind: 'tool',
    text: 'Decides. The model reads the position, the policy and its own history and chooses the action; the pendant, not the model, has the last word.',
    href: `${REPO}/blob/main/brain/src/engine/decide.ts`, label: 'brain/src/engine/decide.ts' },
]

export default function BuiltWith() {
  return (
    <section className="sec" id="built">
      <div className="shell">
        <h2>Built with</h2>
        <p className="lede">Three sponsor tracks carry the argument; three more tools make the agent worth listening to. Every one is wired in, not mentioned.</p>
        <div className="tiles">
          {TILES.map((t) => (
            <div className="tile" key={t.name}>
              <div className="name">
                <h3>{t.name}</h3>
                <span className={'chip ' + t.kind}>{t.kind}</span>
              </div>
              <p>{t.text}</p>
              <a href={t.href} target="_blank" rel="noreferrer">{t.label} &#8599;</a>
              {t.more?.map((m) => (
                <a key={m.href} href={m.href} target="_blank" rel="noreferrer">{m.label} &#8599;</a>
              ))}
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
