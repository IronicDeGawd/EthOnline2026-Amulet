import { useEffect, useState } from 'react'
import chain from '../generated/chain.json'

/* One query, one endpoint, no key and no library. The dashboard reads the same subgraph a
   judge can open in the playground, so nothing here comes from a server we run. */
export interface Agent {
  id: string; label: string
  requests: number; approved: number; rejected: number; refusedByPolicy: number; expired: number
  valueApproved: string; valueRequested: string; lastSeen: string
}
export interface Action {
  proposalId: string; agentLabel: string; target: string; selector: string; value: string
  tier: number; outcome: string; approved: boolean; blockNumber: string; timestamp: string; txHash: string
}
export interface Day { day: number; requests: number; approved: number; refused: number; valueApproved: string }

export interface Indexed { agents: Agent[]; actions: Action[]; dailyStats: Day[] }

const QUERY = `{
  agents(orderBy: requests, orderDirection: desc) {
    id label requests approved rejected refusedByPolicy expired
    valueApproved valueRequested lastSeen }
  actions(first: 50, orderBy: timestamp, orderDirection: desc) {
    proposalId agentLabel target selector value tier outcome approved
    blockNumber timestamp txHash }
  dailyStats(first: 14, orderBy: day, orderDirection: desc) {
    day requests approved refused valueApproved } }`

type State = { data: Indexed | null; error: string | null; loading: boolean }

export function useSubgraph(refreshMs = 30_000): State {
  const [state, setState] = useState<State>({ data: null, error: null, loading: true })

  useEffect(() => {
    let live = true
    async function load() {
      try {
        const res = await fetch(chain.subgraph, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ query: QUERY }),
        })
        if (!res.ok) throw new Error(`the subgraph answered ${res.status}`)
        const body = await res.json()
        if (body.errors?.length) throw new Error(body.errors[0].message as string)
        if (live) setState({ data: body.data as Indexed, error: null, loading: false })
      } catch (e) {
        if (live) setState((s) => ({ data: s.data, error: (e as Error).message, loading: false }))
      }
    }
    load()
    const t = setInterval(load, refreshMs)
    return () => { live = false; clearInterval(t) }
  }, [refreshMs])

  return state
}
