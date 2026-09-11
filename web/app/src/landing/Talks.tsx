import { Icon } from './icons'

/* Eight messages, five parties, one key that never moves. The lanes are positioned from the
   same arithmetic the artboard used: lane(i) = i * STEP + COL_W/2, message i at 24 + i*72. */
const ACTORS = [
  { kind: 'agent', name: 'the agent', detail: 'EC2 · Nova Lite · no key' },
  { kind: 'pendant', name: 'the pendant', detail: 'ESP32-S3 · Wi-Fi + BLE · no key' },
  { kind: 'ledger', name: 'the Ledger', detail: 'Nano X · holds the key' },
  { kind: 'chain', name: 'Sepolia', detail: 'AmuletAccount · AmuletLog' },
  { kind: 'rules', name: 'The Graph', detail: 'amulet-decisions subgraph' },
]

const MSGS: [number, number, string, string][] = [
  [0, 1, 'proposal', 'wss over a Cloudflare tunnel, a per-pendant token. Words, amount, market, deadline.'],
  [1, 1, 'policy check', "The pendant reads the agent's cap and allowed calls from ENS. Outside them it refuses here."],
  [1, 2, 'typed data', "Bluetooth, Ledger's own transport. EIP-712 with the summary inside the digest."],
  [2, 1, 'signature', 'The Nano X shows the same words on its own screen. You press. The key never leaves.'],
  [1, 0, 'signed intent', 'Back over the same socket. The agent cannot change a byte without breaking the signature.'],
  [0, 3, 'execute()', 'A relayer pays gas. The account verifies your signature and the deadline, then acts.'],
  [0, 3, 'record()', "Every outcome, approved or refused, is written to AmuletLog by the agent's recorder key."],
  [3, 4, 'indexed', 'The subgraph indexes the log. The agent reads its own history from here before it decides.'],
]

/* Sized so the whole diagram, notes included, fits the 1280 px content column:
   5 lanes + the note column = 1170 px. Below 1260 px the lanes are dropped for the list. */
const COL_W = 150, GAP = 30, STEP = COL_W + GAP
const lane = (i: number) => i * STEP + COL_W / 2
const NOTE_W = 260
const NOTE_X = 5 * STEP - GAP + 40
const DIAGRAM_W = NOTE_X + NOTE_W
const HEIGHT = 24 + MSGS.length * 72

export default function Talks() {
  return (
    <section className="sec talks" id="talks">
      <div className="shell">
        <h2>How it talks</h2>
        <p className="lede">Eight messages, five parties, one key that never moves. The agent and the pendant carry words and signatures; only the Ledger can produce one.</p>

        <div className="lanes-head" style={{ width: DIAGRAM_W, gap: GAP }}>
          {ACTORS.map((a) => (
            <div className={'lane-card' + (a.kind === 'ledger' ? ' dark' : '')} key={a.kind} style={{ width: COL_W }}>
              <Icon name={a.kind} size={30} />
              <div className="who"><b>{a.name}</b><em>{a.detail}</em></div>
            </div>
          ))}
        </div>

        <div className="seq" style={{ height: HEIGHT, width: DIAGRAM_W }} aria-hidden="true">
          {ACTORS.map((_, i) => <div className="lane" key={i} style={{ left: lane(i) }} />)}
          {MSGS.map(([a, b, name, desc], i) => {
            const y = 24 + i * 72
            const x1 = lane(a), x2 = lane(b)
            const L = Math.min(x1, x2), R = Math.max(x1, x2)
            const self = a === b
            return (
              <div key={name}>
                {self
                  ? <div className="self" style={{ left: x1 - 40, top: y }} />
                  : <div className="msg" style={{ left: L, top: y, width: R - L }}>
                      <i className={x2 > x1 ? 'r' : 'l'} />
                    </div>}
                <span className="tag" style={{ left: self ? x1 + 52 : L + 12, top: y + 6 }}>{i + 1} · {name}</span>
                <div className="note" style={{ left: NOTE_X, top: y - 8, width: NOTE_W }}><b>{i + 1}</b>&nbsp; {desc}</div>
              </div>
            )
          })}
        </div>

        <ol className="seq-list">
          {MSGS.map(([a, b, name, desc], i) => (
            <li key={name}>
              <span className="n">{i + 1}</span>
              <div>
                <span className="what">{name}</span>
                <div className="who">{ACTORS[a].name}{a === b ? ' · to itself' : ` → ${ACTORS[b].name}`}</div>
                <p className="desc">{desc}</p>
              </div>
            </li>
          ))}
        </ol>

        <div className="neverlist">
          <span><b>never crosses</b> &nbsp;the private key</span>
          <span><b>never trusted</b> &nbsp;the server, the socket, the phone</span>
          <span><b>always written</b> &nbsp;the decision, approved or refused</span>
        </div>
      </div>
    </section>
  )
}
