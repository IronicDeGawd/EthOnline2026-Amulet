import { ReactNode, useRef } from 'react'
import assembly from '../generated/assembly.svg?raw'
import '../generated/geo.css'
import './opening.css'
import { useSeat, useCrop } from './useSeat'

/* The DOM order is not incidental: the pinned stage wraps the hero, and the hero
   carries margin-top: -100vh. The drawing is generated, static and never re-rendered. */
export default function Opening({ hero, colRef, figRef }: {
  hero: ReactNode
  colRef: React.RefObject<HTMLDivElement>
  figRef: React.RefObject<HTMLElement>
}) {
  const stage = useRef<HTMLDivElement>(null)
  const lean = useRef<HTMLDivElement>(null)
  const view = useRef<HTMLDivElement>(null)

  useSeat({ stage, lean, view, fig: figRef, col: colRef })
  useCrop(lean)

  return (
    <div className="stage" ref={stage}>
      <div className="pin">
        <div className="view" ref={view}>
          <div className="titling">
            <h2>Seven parts, one job</h2>
            <p>Every piece drawn to scale from the hardware on the bench. Nothing here can sign; the Ledger is a separate device the pendant only talks to.</p>
          </div>
          <div className="seat">
            <div className="lean figwrap" ref={lean} dangerouslySetInnerHTML={{ __html: assembly }} />
          </div>
          <div className="corner">
            <div className="scale">
              <svg width="150" height="16" fill="none" stroke="#4a545c" strokeWidth="1" aria-hidden="true">
                <line x1="1" y1="10" x2="141" y2="10" /><line x1="1" y1="4" x2="1" y2="16" />
                <line x1="71" y1="6" x2="71" y2="14" /><line x1="141" y1="4" x2="141" y2="16" />
              </svg>
              <span className="data">0 &#8212; 20 &#8212; 40 mm</span>
            </div>
            <p className="data">Every pin is spoken for. D0 reads the battery, D1 selects the display, D2 drives the motor, D3 carries display commands, D4 and D5 are the touch and clock bus, D6 the backlight, D7 the touch interrupt, and D8 through D10 the display bus. The memory-card slot is never switched on, so its pin runs the motor instead.</p>
          </div>
        </div>
      </div>

      {hero}

      <section className="object" id="object">
        <div className="opening-space" />
      </section>
    </div>
  )
}
