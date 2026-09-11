import chain from '../generated/chain.json'
import Face from './Face'
import { eth } from './read'
import type { Agent } from './useSubgraph'

/* One card per agent. The counts come from the subgraph; the cap and the name come from ENS,
   read at build time, because a text record is not an entity the subgraph can index. */
const KNOWN = chain.agents as { label: string; name: string; title: string; capWei: string | null }[]

export default function AgentCards({ agents }: { agents: Agent[] }) {
  const by = new Map(agents.map((a) => [a.label, a]))
  return (
    <div className="cards">
      {KNOWN.map((k) => {
        const a = by.get(k.label)
        const stats: [string, number][] = [
          ['asked', a?.requests ?? 0],
          ['approved', a?.approved ?? 0],
          ['refused', a?.refusedByPolicy ?? 0],
          ['dismissed', a?.rejected ?? 0],
        ]
        return (
          <div className="card" key={k.label}>
            <div className="who">
              <Face agent={k.label} />
              <div className="names">
                <span className="label">{k.label}</span>
                <span className="ens">{k.name}</span>
              </div>
              <span className="cap">cap {k.capWei ? eth(k.capWei) : '—'}</span>
            </div>
            <div className="stats">
              {stats.map(([l, v]) => (
                <div key={l}><span className="n">{v}</span><span className={'l' + (l === 'refused' ? ' gold' : '')}>{l}</span></div>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}
