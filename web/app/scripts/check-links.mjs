// Every link in "Built with" must resolve. A 404 on a partner's tile is worse than no tile.
import { readFileSync } from 'node:fs'
const src = readFileSync(new URL('../src/landing/BuiltWith.tsx', import.meta.url), 'utf8')
const REPO = 'https://github.com/IronicDeGawd/EthOnline2026-Amulet', SCAN = 'https://sepolia.etherscan.io'
const links = [...src.matchAll(/href: (`[^`]*`|'[^']*')/g)].map(m => m[1].slice(1, -1).replace('${REPO}', REPO).replace('${SCAN}', SCAN))
let bad = 0
for (const url of links) {
  const r = await fetch(url, { method: 'GET', redirect: 'follow', headers: { 'user-agent': 'amulet-link-check' } })
  // A 404 is a dead link. A 403 is a site refusing a bot: Etherscan answers 200 to a browser
  // and 403 to Vercel's build servers, and the page behind it is real either way.
  const ok = r.status < 400 || r.status === 403
  console.log(`${ok ? 'ok ' : 'BAD'} ${r.status} ${url}`)
  if (!ok) bad++
}
if (bad) { console.error(`${bad} broken link(s)`); process.exit(1) }
