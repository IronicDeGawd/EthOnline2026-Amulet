import { useRef } from 'react'
import '../landing/landing.css'
import '../landing/sections.css'
import Header from '../landing/Header'
import Hero from '../landing/Hero'
import PartList from '../landing/PartList'
import Breaks from '../landing/Breaks'
import Talks from '../landing/Talks'
import BuiltWith from '../landing/BuiltWith'
import Footer from '../landing/Footer'
import Opening from '../opening/Opening'

export default function Landing() {
  const colRef = useRef<HTMLDivElement>(null)
  const figRef = useRef<HTMLElement>(null)

  return (
    <>
      <Header />
      <Opening colRef={colRef} figRef={figRef} hero={<Hero colRef={colRef} figRef={figRef} />} />
      <PartList />
      <Breaks />
      <Talks />
      <BuiltWith />
      <Footer />
    </>
  )
}
