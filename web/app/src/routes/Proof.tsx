import chain from '../generated/chain.json'
import '../proof/proof.css'
import AgentCards from '../proof/AgentCards'
import Totals from '../proof/Totals'
import DecisionTable from '../proof/DecisionTable'
import { ago } from '../proof/read'
import { useSubgraph } from '../proof/useSubgraph'

export default function Proof() {
  const { data, error, loading } = useSubgraph()
  const agents = data?.agents ?? []
  const actions = data?.actions ?? []
  const last = actions[0]

  return (
    <div className="proof">
      <header className="top">
        <div className="shell">
          <div className="brand"><b>Amulet</b><span>/ proof</span></div>
          <nav>
            <a href="#/">Landing</a>
            <a href={chain.subgraph} target="_blank" rel="noreferrer">Subgraph playground</a>
            <a href="https://github.com/IronicDeGawd/EthOnline2026-Amulet">GitHub</a>
          </nav>
        </div>
      </header>

      <main>
        <div className="intro">
          <div>
            <h1>What the agents asked, and what the wrist said</h1>
            <p className="lede">Every row is a transaction on Sepolia, indexed by our subgraph. Nothing here comes from a server we run; open any link and check it against Etherscan.</p>
          </div>
          <div className="state">
            <span>
              <span className={'dot' + (chain.status === 'watching' || chain.status === 'proposing' ? '' : ' cold')} />
              {chain.status ? `${chain.status} · from ENS status` : 'status not set on ENS'}
            </span>
            <span>
              {last
                ? `last decision recorded ${ago(Number(last.timestamp))} · block ${Number(last.blockNumber).toLocaleString()}`
                : `caps read from ${chain.policyName} at block ${chain.block.toLocaleString()}`}
            </span>
          </div>
        </div>

        <AgentCards agents={agents} />
        <Totals agents={agents} days={data?.dailyStats ?? []} />
        <DecisionTable actions={actions} loading={loading} error={error} />
      </main>
    </div>
  )
}
