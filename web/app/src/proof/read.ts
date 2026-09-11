import chain from '../generated/chain.json'
import type { Action } from './useSubgraph'

/* What the chain does not know.
   The log stores a 4-byte selector, a target address and a value in wei. There is no human
   sentence on chain and AmuletLog is deployed, so a row reads verb · amount · market and an
   unknown selector shows as its own hex rather than as a guess. */
const VERBS = chain.verbs as Record<string, string>
const VENUES = chain.venues as Record<string, string>

const WORD: Record<string, string> = {
  repay: 'Repay', supply: 'Supply', borrow: 'Borrow', withdraw: 'Withdraw',
  exactInputSingle: 'Swap', execute: 'Execute', record: 'Record', setPrice: 'Set price',
}

export function verb(selector: string): string {
  const name = VERBS[selector.toLowerCase()]
  return name ? (WORD[name] ?? name) : selector
}

export function venue(target: string): string {
  return VENUES[target.toLowerCase()] ?? short(target)
}

export function short(addr: string): string {
  return addr.slice(0, 6) + '…' + addr.slice(-4)
}

/* wei as ETH, trimmed: 0.006, not 0.006000000000000000 */
export function eth(wei: string | bigint, places = 3): string {
  const v = BigInt(wei || 0)
  const whole = v / 10n ** 18n
  const frac = (v % 10n ** 18n).toString().padStart(18, '0').slice(0, places).replace(/0+$/, '')
  return `${whole}${frac ? '.' + frac : ''} ETH`
}

export function sentence(a: Action): string {
  return `${verb(a.selector)} · ${eth(a.value)} · ${venue(a.target)}`
}

/* The outcomes the log records, in the words the wrist uses. */
export function said(a: Action): { text: string; tone: 'yes' | 'policy' | 'you' } {
  switch (a.outcome) {
    case 'approved': return { text: 'approved', tone: 'yes' }
    case 'policy_reject': return { text: 'refused by policy', tone: 'policy' }
    case 'rejected': return { text: 'dismissed on the wrist', tone: 'you' }
    case 'expired': return { text: 'expired unanswered', tone: 'you' }
    default: return { text: a.outcome.replace(/_/g, ' '), tone: 'you' }
  }
}

export function clock(ts: string): string {
  return new Date(Number(ts) * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

export function ago(ts: number): string {
  const s = Math.max(0, Math.floor(Date.now() / 1000 - ts))
  if (s < 90) return `${s} s ago`
  if (s < 5400) return `${Math.round(s / 60)} min ago`
  if (s < 172800) return `${Math.round(s / 3600)} h ago`
  return `${Math.round(s / 86400)} days ago`
}

export const txUrl = (hash: string) => `${chain.explorer}/tx/${hash}`
