import { useEffect, useState } from 'react'
import Landing from './routes/Landing'
import Proof from './routes/Proof'

/* Two routes do not need a router: the hash is the route. */
function route() {
  return window.location.hash.replace(/^#\/?/, '').split('?')[0]
}

export default function App() {
  const [path, setPath] = useState(route)
  useEffect(() => {
    const onHash = () => { setPath(route()); window.scrollTo(0, 0) }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])
  return path === 'proof' ? <Proof /> : <Landing />
}
