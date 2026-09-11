import { eth } from './read'
import type { Agent, Day } from './useSubgraph'

/* Asked for against approved, summed across agents. The gap is the argument: the pendant
   refused the difference. Beside it, the last fourteen days of decisions. */
export default function Totals({ agents, days }: { agents: Agent[]; days: Day[] }) {
  const asked = agents.reduce((s, a) => s + BigInt(a.valueRequested || 0), 0n)
  const ok = agents.reduce((s, a) => s + BigInt(a.valueApproved || 0), 0n)

  const strip = [...days].sort((a, b) => a.day - b.day).slice(-14)
  const top = Math.max(1, ...strip.map((d) => d.requests))

  return (
    <div className="totals">
      <div className="fig">
        <span className="k">asked for</span>
        <span className="v">{eth(asked)}</span>
      </div>
      <div className="fig">
        <span className="k">approved</span>
        <span className="v">{eth(ok)}</span>
        {asked > ok && <span className="point">the gap is the point</span>}
      </div>
      <div className="fig wide">
        <span className="k">decisions per day · last 14</span>
        <div className="strip">
          {strip.length === 0 && <span className="none">no days recorded yet</span>}
          {strip.map((d) => (
            <div className="bar" key={d.day} title={`${d.requests} decisions`}>
              <div style={{ height: 8 + Math.round((d.requests / top) * 64) }} className={d.requests ? 'on' : ''} />
              <span>{dayLabel(d.day)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

/* the subgraph counts days since the epoch; show the date, not the number */
function dayLabel(day: number): string {
  return new Date(day * 86400_000).toLocaleDateString([], { day: '2-digit' })
}
