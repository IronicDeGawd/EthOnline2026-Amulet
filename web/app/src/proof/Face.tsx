import chain from '../generated/chain.json'

/* The same 16x16 face the pendant draws, from the record on the agent's ENS name. */
const FACES = chain.faces as Record<string, { colour: string; rows: string[] }>

export default function Face({ agent, px = 4 }: { agent: string; px?: number }) {
  const f = FACES[agent]
  if (!f) return <span style={{ display: 'inline-block', width: 16 * px, height: 16 * px }} />
  const cells: React.ReactNode[] = []
  f.rows.forEach((row, r) => row.split('').forEach((ch, c) => {
    if (ch !== '.') cells.push(<rect key={`${r}-${c}`} x={c * px} y={r * px} width={px} height={px} />)
  }))
  return (
    <svg width={16 * px} height={16 * px} viewBox={`0 0 ${16 * px} ${16 * px}`} fill={'#' + f.colour} aria-hidden="true">
      {cells}
    </svg>
  )
}
