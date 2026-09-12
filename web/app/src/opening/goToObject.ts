/* "The object" is not the top of the stage; it is the finished drawing, which the scroll
   reaches at 78% of the way through. A plain anchor lands the reader mid-explosion, so the
   links scroll to the lock instead. On a phone there is no stage and the anchor is right. */
export function goToObject(e: React.MouseEvent) {
  const stage = document.querySelector<HTMLElement>('.stage')
  const wide = window.matchMedia('(min-width: 1001px) and (prefers-reduced-motion: no-preference)').matches
  if (!stage || !wide) return                          /* let the browser follow #object */
  e.preventDefault()
  const top = stage.getBoundingClientRect().top + window.scrollY
  const travel = stage.offsetHeight - window.innerHeight
  window.scrollTo({ top: top + travel * 0.80, behavior: 'smooth' })
  history.replaceState(null, '', '#object')
}
