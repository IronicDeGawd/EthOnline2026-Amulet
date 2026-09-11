import chain from '../generated/chain.json'
import Face from './Face'
import { clock, eth, said, sentence, short, txUrl } from './read'
import type { Action } from './useSubgraph'

export default function DecisionTable({ actions, loading, error }:
  { actions: Action[]; loading: boolean; error: string | null }) {
  return (
    <div className="table">
      <div className="row head">
        <span>time</span><span>agent</span><span>what it wanted</span>
        <span>value</span><span>what the wrist said</span><span>transaction</span>
      </div>

      {actions.map((a) => {
        const s = said(a)
        return (
          <div className="row" key={a.proposalId}>
            <span className="t">{clock(a.timestamp)}</span>
            <span className="ag"><Face agent={a.agentLabel} px={2} />{a.agentLabel}</span>
            <span className="what">{sentence(a)}</span>
            <span className="val">{eth(a.value)}</span>
            <span className={'said ' + s.tone}>{s.text}</span>
            <a className="tx" href={txUrl(a.txHash)} target="_blank" rel="noreferrer">{short(a.txHash)} &#8599;</a>
          </div>
        )
      })}

      {actions.length === 0 && (
        <div className="empty">
          {loading ? <p>Reading the subgraph…</p>
            : error ? <p>The subgraph did not answer: {error}</p>
            : <>
                <p>No decisions indexed yet. Every proposal the pendant answers is written to
                   AmuletLog and appears here within a block or two.</p>
                <p><a href={chain.subgraph} target="_blank" rel="noreferrer">Run the query yourself &#8599;</a></p>
              </>}
        </div>
      )}

      {actions.length > 0 && (
        <div className="foot">showing {actions.length} · newest first · indexed from {' '}
          <a href={`${chain.explorer}/address/${chain.amuletLog}`} target="_blank" rel="noreferrer">AmuletLog</a>
        </div>
      )}
    </div>
  )
}
