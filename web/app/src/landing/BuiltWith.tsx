/* Three sponsor tracks and three tools. Every link points at the thing itself, not a homepage. */
const REPO = 'https://github.com/IronicDeGawd/EthOnline2026-Amulet'
const SCAN = 'https://sepolia.etherscan.io'

const TILES = [
  { name: 'Ledger', kind: 'track',
    text: "Signs every transaction. The pendant speaks the Nano X's Bluetooth transport itself, ported from Ledger's tooling to the ESP32, and sends EIP-712 typed data so the device clear-signs the same words the wrist saw.",
    href: `${REPO}/tree/main/firmware/main/ledger`, label: 'firmware/main/ledger' },
  { name: 'The Graph', kind: 'track',
    text: 'Remembers every decision. Our own subgraph indexes AmuletLog; the dashboard reads it, and so does each agent before it proposes, learning from its own refusals.',
    href: 'https://api.studio.thegraph.com/query/1758963/amulet-decisions/v0.1.0', label: 'amulet-decisions subgraph' },
  { name: 'ENS', kind: 'track',
    text: 'Names the agents and holds the rules. repay, yield and swap each live under amuletguard.eth with a cap and an allow-list only a Ledger signature can edit.',
    href: 'https://sepolia.app.ens.domains/guardian.amuletguard.eth', label: 'guardian.amuletguard.eth' },
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
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
