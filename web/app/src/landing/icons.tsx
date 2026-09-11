import { ReactNode } from 'react'

/* Six line icons on a 48-px grid, stroke 1.5, drawn in currentColor so the dark
   Ledger tile inverts without a second copy. Transcribed from the locked artboards. */
const BODY: Record<string, ReactNode> = {
  // a server with a small mind: rack lines and a dotted thought above
  agent: <>
    <rect x="10" y="18" width="28" height="22" rx="1" />
    <path d="M14 24h20M14 30h20M14 36h8" />
    <circle cx="32" cy="36" r="1" fill="currentColor" />
    <path d="M18 12a6 6 0 0 1 12 0" />
    <circle cx="24" cy="6" r="1.2" />
  </>,
  // a name tag: the ENS record
  rules: <>
    <path d="M10 14h22l6 10-6 10H10z" />
    <path d="M15 20h10M15 26h14" />
    <circle cx="31" cy="24" r="1.4" />
  </>,
  // the pendant: loop, case, screen
  pendant: <>
    <circle cx="24" cy="27" r="15" />
    <circle cx="24" cy="27" r="11" strokeDasharray="1 3" />
    <circle cx="24" cy="27" r="11" />
    <path d="M21 12c0-3 1.5-5 3-6.5C25.5 7 27 9 27 12" />
    <circle cx="24" cy="4.5" r="1.8" />
    <path d="M39 24v6" />
  </>,
  // the Nano X: a slim body, its screen, the button
  ledger: <>
    <rect x="6" y="18" width="36" height="12" rx="4" />
    <rect x="14" y="21.5" width="16" height="5" rx="0.5" />
    <circle cx="36" cy="24" r="2" />
    <path d="M6 24H3" />
  </>,
  // the chain: two links
  chain: <>
    <rect x="8" y="19" width="18" height="10" rx="5" />
    <rect x="22" y="19" width="18" height="10" rx="5" />
  </>,
  phone: <>
    <rect x="16" y="6" width="16" height="36" rx="3" />
    <path d="M22 38h4" />
  </>,
  key: <>
    <circle cx="18" cy="24" r="6" />
    <path d="M24 24h16M34 24v5M38 24v4" />
  </>,
}

export type IconName = keyof typeof BODY

export function Icon({ name, size = 48 }: { name: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" stroke="currentColor"
         strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {BODY[name]}
    </svg>
  )
}
