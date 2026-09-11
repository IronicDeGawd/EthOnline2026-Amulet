import { useEffect, useState } from 'react'
import Landing from './routes/Landing'
import Proof from './routes/Proof'

/* Two pages do not need a router: the hash is the page. Anything that is not #/proof is the
   landing page, so an in-page anchor like #object stays on it and keeps its jump. */
function page(): 'landing' | 'proof' {
  return window.location.hash.replace(/^#\/?/, '').split('?')[0] === 'proof' ? 'proof' : 'landing'
}

export default function App() {
  const [which, setWhich] = useState(page)

  useEffect(() => {
    const onHash = () => setWhich((was) => {
      const now = page()
      if (now !== was) window.scrollTo(0, 0)   /* a real page change, not an anchor */
      return now
    })
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  return which === 'proof' ? <Proof /> : <Landing />
}
