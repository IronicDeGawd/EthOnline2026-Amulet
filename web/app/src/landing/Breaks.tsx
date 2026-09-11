import { Fragment } from 'react'
import { Icon } from './icons'

/* Four things that go wrong in practice. Each one shows where the usual path fails
   and which gate on the Amulet path catches it. */
type Scen = { title: string; gate: number; usual: string; amulet: string; actor: string }

const SCEN: Scen[] = [
  { title: 'The server is compromised.', gate: 0, actor: 'agent',
    usual: 'The key goes with it. Whoever took the server can spend whatever the agent could, at once and without limit.',
    amulet: 'They can write a proposal. Moving anything still needs your hands on two devices you are holding.' },
  { title: 'The agent is fed bad data.', gate: 1, actor: 'agent',
    usual: 'It signs on a false premise. Nothing between the reasoning and the signature compares the result to a limit.',
    amulet: 'The pendant checks the transaction against limits you wrote and refuses anything outside them before the Ledger wakes.' },
  { title: 'You approve on a phone.', gate: 2, actor: 'phone',
    usual: 'The screen showing you the transaction belongs to a computer running everything else you installed. It can show one thing and send another.',
    amulet: 'The Ledger decodes the transaction itself and shows it on a screen wired to the chip that holds the key. Two screens have to agree.' },
  { title: 'The limits need changing.', gate: 1, actor: 'agent',
    usual: "They sit in the agent's own configuration, so the agent, or anyone who reaches it, can raise them.",
    amulet: 'They sit on your name, and only a Ledger signature can edit them. The agent may write its own status and nothing more.' },
]

function Node({ kind, label, hasKey, dark }: { kind: string; label: string; hasKey?: boolean; dark?: boolean }) {
  return (
    <div className={'node' + (dark ? ' dark' : '')}>
      <div className="box">
        <Icon name={kind} size={40} />
        {hasKey && <span className="keyflag"><Icon name="key" size={12} /></span>}
      </div>
      <span>{label}</span>
    </div>
  )
}

function Hop({ mark }: { mark?: 'break' | 'gate' }) {
  return (
    <div className="hop">
      <span className="head" />
      {mark === 'break' && <span className="brk" />}
      {mark === 'gate' && <span className="gate" />}
    </div>
  )
}

const HOPS = [
  { kind: 'agent', label: 'agent' },
  { kind: 'rules', label: 'your rules · ENS' },
  { kind: 'pendant', label: 'the pendant' },
  { kind: 'ledger', label: 'the Ledger', hasKey: true, dark: true },
  { kind: 'chain', label: 'the chain' },
]

export default function Breaks() {
  return (
    <section className="sec compare" id="compare">
      <div className="shell">
        <h2>Where the usual setup breaks</h2>
        <p className="lede">An agent that can act needs a key, and a key on a server is a key anyone who reaches that server now holds. Four things go wrong in practice. Each one shows where the usual path fails and which gate on the Amulet path catches it.</p>

        <div className="legend">
          <span className="item"><i className="brk" />where the usual path fails</span>
          <span className="item"><i className="gate" />the gate that catches it</span>
          <span className="item"><i className="keyf"><Icon name="key" size={10} /></i>who holds the key</span>
        </div>

        <div className="scens">
          {SCEN.map((s) => (
            <div className="scen" key={s.title}>
              <h3>{s.title}</h3>
              <div className="two">
                <div className="side usual">
                  <div className="path">
                    <Node kind={s.actor} label={s.actor === 'phone' ? 'phone' : 'agent · server'} hasKey />
                    <Hop mark="break" />
                    <Node kind="chain" label="the chain" />
                  </div>
                  <p><b>Normally</b>{s.usual}</p>
                </div>
                <div className="side with">
                  <div className="path">
                    {HOPS.map((h, i) => (
                      <Fragment key={h.kind}>
                        <Node {...h} />
                        {i < 4 && <Hop mark={i === s.gate ? 'gate' : undefined} />}
                      </Fragment>
                    ))}
                  </div>
                  <p><b>With Amulet</b>{s.amulet}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
