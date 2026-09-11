import { RefObject, useEffect } from 'react'
import geo from '../generated/assembly.json'

/* Seat the stacked object exactly where the hero pendant sits: measured, not guessed, so it
   holds at any viewport width. Only the start of the motion needs numbers; the end is the
   drawing at rest. Ported from the script in web/page.py. */
export function useSeat(refs: {
  stage: RefObject<HTMLDivElement>
  lean: RefObject<HTMLDivElement>
  view: RefObject<HTMLDivElement>
  fig: RefObject<HTMLElement>
  col: RefObject<HTMLDivElement>
}) {
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1001px) and (prefers-reduced-motion: no-preference)')
    const ok = !!(window.CSS && CSS.supports && CSS.supports('animation-timeline: view()'))

    function fit() {
      const stage = refs.stage.current, lean = refs.lean.current
      const view = refs.view.current, fig = refs.fig.current, col = refs.col.current
      if (!stage || !lean || !view || !fig || !col) return
      if (!ok || !mq.matches) return
      const rig = lean.querySelector('.rig') as SVGGElement | null
      if (!rig) return

      const s = stage.getBoundingClientRect(), f = fig.getBoundingClientRect()
      const v = view.getBoundingClientRect()
      const cx = (v.left - s.left) + lean.offsetLeft + geo.cx * lean.offsetWidth   /* at rest, pinned */
      const cy = lean.offsetTop + geo.cy * lean.offsetHeight
      const c = col.getBoundingClientRect()                                        /* the words on the left */
      const fx = (f.left - s.left) + f.width * 0.5
      const fy = (c.top - s.top) + c.height * 0.5 - 40
      const k = (f.width * 192 / 620) / (geo.r * lean.offsetWidth)
      const u = 2100 / lean.offsetWidth                                            /* screen px -> drawing units */
      const seat = (lean.parentNode as HTMLElement).getBoundingClientRect()

      rig.style.setProperty('--x0', ((fx - cx) * u).toFixed(1) + 'px')
      rig.style.setProperty('--y0', ((fy - cy) * u).toFixed(1) + 'px')
      rig.style.setProperty('--k0', k.toFixed(4))
      rig.style.setProperty('--x1', (((v.left - s.left) + seat.width * 0.5 - cx) * u).toFixed(1) + 'px')
      rig.style.setProperty('--y1', ((seat.height * 0.5 - cy) * u).toFixed(1) + 'px')
    }

    fit()
    window.addEventListener('resize', fit)
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(fit)
    return () => window.removeEventListener('resize', fit)
  }, [refs])
}

/* On narrow screens the edge callouts are hidden, so crop the drawing to the
   object itself instead of scrolling across the empty margin they leave. */
export function useCrop(lean: RefObject<HTMLDivElement>) {
  useEffect(() => {
    const svg = lean.current?.querySelector('svg.assembly')
    if (!svg) return
    const wide = '0 0 2100 1000', tight = '600 90 730 710'
    const mq = window.matchMedia('(max-width: 1000px)')
    const apply = () => svg.setAttribute('viewBox', mq.matches ? tight : wide)
    apply()
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [lean])
}
