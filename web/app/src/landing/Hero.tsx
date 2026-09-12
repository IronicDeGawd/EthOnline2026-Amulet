import { RefObject } from 'react'
import PendantStatic from './PendantStatic'

import { goToObject } from '../opening/goToObject'

export default function Hero({ colRef, figRef }: {
  colRef: RefObject<HTMLDivElement>
  figRef: RefObject<HTMLElement>
}) {
  return (
    <section className="hero">
      <div className="shell">
        <div ref={colRef}>
          <h1><span>Agents propose.</span><span>Your pendant filters.</span><span>Your Ledger signs.</span></h1>
          <p className="lede">An autonomous agent watches your lending positions and drafts the transaction that saves them. It runs on a server you have no reason to trust, and it holds <strong>no key</strong>.</p>
          <p className="lede">Every proposal reaches one place: a pendant on your chest. It checks the proposal against rules you wrote, shows it in words, and carries it to your Ledger only when you swipe.</p>
          <div className="btns">
            <a className="btn primary" href="#object" onClick={goToObject}>Take it apart</a>
            <a className="btn quiet" href="#/proof">See it on Sepolia</a>
          </div>
        </div>
        <PendantStatic ref={figRef} />
      </div>
    </section>
  )
}
