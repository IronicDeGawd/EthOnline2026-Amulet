svg = open("assembly.svg.part").read()

html = '''<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Amulet — the only courier to your Ledger</title>
<meta name="description" content="A wearable pendant that carries an AI agent's transactions to your hardware wallet, and nothing else.">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap">
<style>
  :root {
    --ground: #e9ecee;
    --paper:  #e2e4e2;
    --ink:    #14181c;
    --ink-2:  #4a545c;
    --rule:   #c5cbd0;
    --gold:   #b8901f;
    --screen: #0d1114;
  }
  * { box-sizing: border-box; }
  html { -webkit-text-size-adjust: 100%; }
  body {
    margin: 0; background: var(--ground); color: var(--ink);
    font-family: Archivo, system-ui, -apple-system, sans-serif;
    font-size: 17px; line-height: 1.55; -webkit-font-smoothing: antialiased;
  }
  .data { font-family: 'IBM Plex Mono', ui-monospace, Menlo, monospace; font-variant-numeric: tabular-nums; }
  a { color: var(--ink); text-decoration: none; }
  a:focus-visible, .btn:focus-visible { outline: 2px solid var(--gold); outline-offset: 3px; }
  .shell { max-width: 1360px; margin: 0 auto; padding: 0 40px; }

  header.top { border-bottom: 1px solid var(--rule); }
  .top .shell { display: flex; align-items: baseline; justify-content: space-between; gap: 32px; padding: 22px 40px 18px; }
  .wordmark { display: flex; align-items: center; gap: 11px; font-size: 19px; font-weight: 700; letter-spacing: -0.015em; }
  .top nav { display: flex; gap: 30px; font-size: 15px; color: var(--ink-2); }
  .top nav a:hover { color: var(--ink); }

  /* ---------- section 1 ---------- */
  .hero .shell {
    display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.02fr);
    gap: 72px; align-items: center; padding-top: 88px; padding-bottom: 96px;
  }
  h1 { margin: 0 0 26px; font-size: clamp(40px, 5.4vw, 72px); line-height: 1.02; font-weight: 700; letter-spacing: -0.035em; }
  h1 span { display: block; }
  .lede { margin: 0 0 18px; max-width: 62ch; font-size: 19px; color: var(--ink-2); }
  .lede strong { color: var(--ink); font-weight: 600; }
  .btns { display: flex; align-items: center; gap: 12px; margin-top: 32px; }
  .btn { display: inline-block; padding: 13px 22px; font-size: 16px; font-weight: 600; border: 1px solid var(--ink); border-radius: 2px;
         transition: background-color .18s ease, color .18s ease, border-color .18s ease; }
  .btn.primary { background: var(--ink); color: var(--ground); }
  .btn.primary:hover { background: var(--gold); border-color: var(--gold); color: var(--ink); }
  .btn.quiet { border-color: var(--rule); color: var(--ink-2); }
  .btn.quiet:hover { border-color: var(--ink); color: var(--ink); }

  figure.device { margin: 0; }
  figure.device svg { display: block; width: 100%; height: auto; }
  figcaption { margin-top: 20px; padding-top: 14px; border-top: 1px solid var(--rule);
               display: flex; flex-wrap: wrap; gap: 8px 28px; font-size: 14px; color: var(--ink-2); }
  figcaption b { color: var(--ink); font-weight: 500; }

  /* ---------- section 2 ---------- */
  .object { background: var(--paper); border-top: 1px solid var(--rule); }
  .object .frame { position: relative; max-width: 1760px; margin: 0 auto; padding: 0 24px 72px; }
  .object .titling, .object .corner { pointer-events: none; }
  .object .titling { pointer-events: auto; }
  .object .titling { position: absolute; top: 56px; left: 64px; max-width: 34ch; z-index: 1; }
  .object h2 { margin: 0 0 14px; font-size: clamp(30px, 3.1vw, 44px); line-height: 1.06; font-weight: 700; letter-spacing: -0.03em; }
  .object p { margin: 0; font-size: 17px; color: var(--ink-2); }
  svg.assembly { display: block; width: 100%; height: auto; }
  svg.assembly .lbl { font-family: 'IBM Plex Mono', ui-monospace, Menlo, monospace; font-size: 19px; fill: var(--ink-2); }
  .object .corner {
    position: absolute; right: 4%; bottom: 7%; width: 33%; max-width: 520px;
    border-top: 1px solid var(--rule); padding-top: 14px;
  }
  .object .scale { display: flex; align-items: baseline; gap: 14px; font-size: 13px; color: var(--ink-2); }
  .object .corner p {
    margin: 12px 0 0; font-size: clamp(11px, 0.94vw, 14px); line-height: 1.6; color: var(--ink-2);
  }
  .partlist { display: none; }
  /* ---------- section 3 ---------- */
  .compare { border-top: 1px solid var(--rule); }
  .compare .shell { padding-top: 88px; padding-bottom: 96px; }
  .compare h2 { margin: 0 0 16px; font-size: clamp(30px, 3.1vw, 44px); line-height: 1.06; font-weight: 700; letter-spacing: -0.03em; }
  .compare .lede { max-width: 68ch; }
  .paths { margin: 52px 0 8px; }
  .paths svg { display: block; width: 100%; height: auto; }
  .paths .plabel { font-family: 'IBM Plex Mono', ui-monospace, Menlo, monospace; font-size: 15px; fill: var(--ink); }
  .paths .pnote  { font-family: 'IBM Plex Mono', ui-monospace, Menlo, monospace; font-size: 14px; fill: var(--ink-2); }
  .paths .prow   { font-size: 17px; font-weight: 600; fill: var(--ink); }

  .modes { margin: 56px 0 0; }
  .modes .row { display: grid; grid-template-columns: 30% 1fr 1fr; gap: 0 40px; padding: 26px 0; border-top: 1px solid var(--rule); }
  .modes .row:last-child { border-bottom: 1px solid var(--rule); }
  .modes h3 { margin: 0; font-size: 20px; font-weight: 600; letter-spacing: -0.015em; }
  .modes p { margin: 0; font-size: 16px; color: var(--ink-2); }
  .modes p b { display: block; margin-bottom: 5px; font-family: 'IBM Plex Mono', ui-monospace, Menlo, monospace;
               font-size: 13px; font-weight: 500; color: var(--ink); }
  .modes .then b { color: var(--gold); }
  @media (max-width: 1000px) {
    .compare .shell { padding-top: 56px; padding-bottom: 64px; }
    .paths { overflow-x: auto; } .paths svg { min-width: 720px; }
    .modes .row { grid-template-columns: 1fr; gap: 18px; }
  }

  @media (max-width: 1240px) {
    .object .titling { position: static; max-width: none; padding: 56px 40px 28px; }
    .object .corner  { position: static; right: auto; bottom: auto; width: auto; max-width: none; margin: 24px 40px 0; }
    .object .corner p { font-size: 14px; }
  }


  @media (max-width: 1000px) {
    .shell { padding: 0 24px; }
    .top .shell { padding-left: 24px; padding-right: 24px; }
    .hero .shell { grid-template-columns: 1fr; gap: 48px; padding-top: 56px; padding-bottom: 64px; }
    figure.device { order: -1; max-width: 460px; }
    .top nav { gap: 20px; font-size: 14px; }
    .top nav a[data-secondary] { display: none; }
    .object .frame { padding: 0 24px 32px; }
    svg.assembly .callouts { display: none; }
    .object .figwrap { overflow-x: auto; overscroll-behavior-x: contain; -webkit-overflow-scrolling: touch; }
    svg.assembly { min-width: 620px; }
    .partlist {
      display: grid; grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 0 32px; margin: 8px 0 0; padding: 0; list-style: none;
    }
    .partlist li { display: flex; gap: 12px; padding: 12px 0; border-top: 1px solid var(--rule); font-size: 15px; }
    .partlist b { color: var(--ink-2); font-weight: 500; }
  }
  @media (max-width: 560px) {
    body { font-size: 16px; }
    .lede { font-size: 17px; }
    .btns { flex-direction: column; align-items: stretch; }
    .btn { text-align: center; }
    .top nav a[data-tertiary] { display: none; }
    .partlist { grid-template-columns: 1fr; }
  }
</style>
</head>
<body>

<header class="top">
  <div class="shell">
    <a class="wordmark" href="./" aria-label="Amulet, home">
      <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true" fill="none">
        <circle cx="12" cy="12" r="10" stroke="#14181c" stroke-width="1.6"/>
        <circle cx="12" cy="12" r="5.4" stroke="#b8901f" stroke-width="1.6"/>
        <circle cx="12" cy="12" r="1.7" fill="#14181c"/>
      </svg>
      Amulet
    </a>
    <nav>
      <a href="#object">The object</a>
      <a href="#compare">Where it breaks</a>
      <a href="#proof" data-secondary>Proof</a>
      <a href="https://github.com/IronicDeGawd/EthOnline2026-Amulet">GitHub</a>
    </nav>
  </div>
</header>

<section class="hero">
  <div class="shell">
    <div>
      <h1><span>Agents propose.</span><span>Your pendant filters.</span><span>Your Ledger signs.</span></h1>
      <p class="lede">An autonomous agent watches your lending positions and drafts the transaction that saves them. It runs on a server you have no reason to trust, and it holds <strong>no key</strong>.</p>
      <p class="lede">Every proposal reaches one place: a pendant on your chest. It checks the proposal against rules you wrote, shows it in words, and carries it to your Ledger only when you swipe.</p>
      <div class="btns">
        <a class="btn primary" href="#object">Take it apart</a>
        <a class="btn quiet" href="#proof">See it on Sepolia</a>
      </div>
    </div>

    <figure class="device">
      <svg viewBox="0 0 620 560" role="img" aria-labelledby="devtitle devdesc">
        <title id="devtitle">The Amulet pendant, seen from the front</title>
        <desc id="devdesc">A 39 millimetre round display showing a proposal to repay 120 sUSDC on Aave, with a swipe-to-approve prompt, drawn with a dimension line marking its diameter.</desc>
        <g stroke="#4a545c" stroke-width="1" fill="none">
          <line x1="120" y1="66" x2="500" y2="66"/>
          <line x1="120" y1="58" x2="120" y2="74"/><line x1="500" y1="58" x2="500" y2="74"/>
          <line x1="120" y1="82" x2="120" y2="128"/><line x1="500" y1="82" x2="500" y2="128"/>
        </g>
        <rect x="283" y="54" width="54" height="24" fill="#e9ecee"/>
        <text class="data" x="310" y="71" text-anchor="middle" font-size="13" fill="#4a545c">39 mm</text>
        <g stroke="#4a545c" stroke-width="1.4" fill="none">
          <path d="M296 128 C 296 108 300 96 310 92"/><path d="M324 128 C 324 108 320 96 310 92"/>
        </g>
        <circle cx="310" cy="88" r="7" fill="none" stroke="#4a545c" stroke-width="1.4"/>
        <circle cx="310" cy="320" r="192" fill="#d5dade" stroke="#14181c" stroke-width="1.6"/>
        <circle cx="310" cy="320" r="181" fill="none" stroke="#c5cbd0" stroke-width="1"/>
        <circle cx="310" cy="320" r="170" fill="#0d1114"/>
        <circle cx="310" cy="320" r="152" fill="none" stroke="#b8901f" stroke-width="4"
                stroke-linecap="round" stroke-dasharray="796 159" transform="rotate(120 310 320)"/>
        <text class="data" x="310" y="252" text-anchor="middle" font-size="14" fill="#7e8a92" letter-spacing="1.4">TIER 2 &#183; AAVE V3</text>
        <text x="310" y="308" text-anchor="middle" font-size="32" font-weight="600" fill="#f2f5f6">Repay</text>
        <text x="310" y="348" text-anchor="middle" font-size="32" font-weight="600" fill="#f2f5f6">120 sUSDC</text>
        <text class="data" x="310" y="382" text-anchor="middle" font-size="15" fill="#9aa5ad">health 1.18 &#8594; 1.41</text>
        <g stroke="#b8901f" stroke-width="2" fill="none" stroke-linecap="round">
          <line x1="266" y1="424" x2="338" y2="424"/><path d="M330 416 L 340 424 L 330 432"/>
        </g>
        <text class="data" x="310" y="456" text-anchor="middle" font-size="14" fill="#7e8a92">swipe to approve</text>
        <rect x="486" y="352" width="16" height="34" rx="3" fill="#d5dade" stroke="#14181c" stroke-width="1.4"/>
      </svg>
      <figcaption>
        <span><b>240 &#215; 240</b> round display</span>
        <span><b>ESP32-S3</b> &#183; Wi-Fi + Bluetooth</span>
        <span><b>Haptic</b> &#183; three tiers</span>
        <span><b>No key</b> stored on board</span>
      </figcaption>
    </figure>
  </div>
</section>

<section class="object" id="object">
  <div class="frame">
    <div class="titling">
      <h2>Seven parts, one job</h2>
      <p>Every piece drawn to scale from the hardware on the bench. Nothing here can sign; the Ledger is a separate device the pendant only talks to.</p>
    </div>
    <div class="figwrap">__ASSEMBLY__</div>
    <div class="corner">
      <div class="scale">
        <svg width="150" height="16" fill="none" stroke="#4a545c" stroke-width="1" aria-hidden="true">
          <line x1="1" y1="10" x2="141" y2="10"/><line x1="1" y1="4" x2="1" y2="16"/>
          <line x1="71" y1="6" x2="71" y2="14"/><line x1="141" y1="4" x2="141" y2="16"/>
        </svg>
        <span class="data">0 &#8212; 20 &#8212; 40 mm</span>
      </div>
      <p class="data">Every pin is spoken for. D0 reads the battery, D1 selects the display, D2 drives the motor, D3 carries display commands, D4 and D5 are the touch and clock bus, D6 the backlight, D7 the touch interrupt, and D8 through D10 the display bus. The memory-card slot is never switched on, so its pin runs the motor instead.</p>
    </div>
    <ol class="partlist data">
      <li><b>1</b>cover glass &#183; capacitive touch</li>
      <li><b>2</b>round display &#183; 240 &#215; 240</li>
      <li><b>3</b>carrier board &#183; clock &#183; charger</li>
      <li><b>4</b>ESP32-S3 &#183; Wi-Fi and Bluetooth</li>
      <li><b>5</b>antenna &#183; 2.4 GHz</li>
      <li><b>6</b>haptic motor &#183; driver &#183; resistor</li>
      <li><b>7</b>battery &#183; 500 mAh</li>
    </ol>
  </div>
</section>


<section class="compare" id="compare">
  <div class="shell">
    <h2>Where the usual setup breaks</h2>
    <p class="lede">An agent that can act needs a key, and a key on a server is a key anyone who reaches that server now holds. The common answer is to ask you first, on a phone that runs a hundred other things. Amulet moves both the key and the asking onto hardware that does one job.</p>

    <div class="paths">
      <svg viewBox="0 0 1320 430" fill="none" role="img" aria-label="Two signal paths. The usual one runs from an agent that holds the key straight to the chain with nothing in between. Amulet's runs from an agent with no key through your rules, the pendant and the Ledger before it reaches the chain.">
        <defs>
          <marker id="ar" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
            <path d="M0 1 L9 5 L0 9" fill="none" stroke="#4a545c" stroke-width="1.4"/>
          </marker>
          <g id="key">
            <circle cx="7" cy="7" r="5.4" stroke-width="1.5"/>
            <path d="M11 11 L22 22 M18 18 l4 -4 M22 22 l4 -4" stroke-width="1.5"/>
          </g>
        </defs>

        <!-- row 1 -->
        <text class="prow" x="0" y="34">The usual way</text>
        <g stroke="#14181c" stroke-width="1.3">
          <rect x="0" y="60" width="300" height="86"/>
          <rect x="1080" y="60" width="240" height="86"/>
        </g>
        <g stroke="#b8901f" stroke-width="1.5" fill="none" transform="translate(252 76)"><use href="#key"/></g>
        <text class="plabel" x="20" y="94">agent on a server</text>
        <text class="pnote"  x="20" y="120">holds the key</text>
        <text class="plabel" x="1100" y="94">the chain</text>
        <text class="pnote"  x="1100" y="120">funds move</text>
        <line x1="300" y1="103" x2="1070" y2="103" stroke="#4a545c" stroke-width="1.3" marker-end="url(#ar)"/>
        <g stroke="#b5631e" stroke-width="1.4">
          <path d="M685 89 L699 103 L685 117 L671 103 Z"/>
        </g>
        <text class="pnote" x="685" y="145" text-anchor="middle" fill="#b5631e">nothing in between</text>

        <!-- row 2 -->
        <text class="prow" x="0" y="268">With Amulet</text>
        <g stroke="#14181c" stroke-width="1.3">
          <rect x="0" y="294" width="228" height="86"/>
          <rect x="288" y="294" width="200" height="86"/>
          <rect x="548" y="294" width="200" height="86"/>
          <rect x="808" y="294" width="212" height="86"/>
          <rect x="1080" y="294" width="240" height="86"/>
        </g>
        <text class="plabel" x="20" y="328">agent</text>
        <text class="pnote"  x="20" y="354">no key</text>
        <text class="plabel" x="308" y="328">your rules</text>
        <text class="pnote"  x="308" y="354">kept on chain</text>
        <text class="plabel" x="568" y="328">the pendant</text>
        <text class="pnote"  x="568" y="354">reads and shows</text>
        <text class="plabel" x="828" y="328">the Ledger</text>
        <text class="pnote"  x="828" y="354">holds the key</text>
        <text class="plabel" x="1100" y="328">the chain</text>
        <text class="pnote"  x="1100" y="354">funds move</text>
        <g stroke="#b8901f" stroke-width="1.5" fill="none" transform="translate(972 310)"><use href="#key"/></g>
        <g stroke="#4a545c" stroke-width="1.3" marker-end="url(#ar)">
          <line x1="228" y1="337" x2="278" y2="337"/>
          <line x1="488" y1="337" x2="538" y2="337"/>
          <line x1="748" y1="337" x2="798" y2="337"/>
          <line x1="1020" y1="337" x2="1070" y2="337"/>
        </g>
        <g stroke="#b8901f" stroke-width="1.6">
          <path d="M513 322 v30 M523 322 v30"/>
          <path d="M773 322 v30 M783 322 v30"/>
        </g>
        <text class="pnote" x="518" y="400" text-anchor="middle" fill="#b8901f">refuses what breaks the rules</text>
        <text class="pnote" x="778" y="400" text-anchor="middle" fill="#b8901f">waits for your hands</text>
      </svg>
    </div>

    <div class="modes">
      <div class="row">
        <h3>The server is compromised.</h3>
        <p><b>Normally</b>The key goes with it. Whatever the agent could spend, whoever took the server can spend, at once and without limit.</p>
        <p class="then"><b>With Amulet</b>They can write a proposal. Moving anything still needs your hands on two devices you are holding.</p>
      </div>
      <div class="row">
        <h3>The agent is fed bad data.</h3>
        <p><b>Normally</b>It signs on a false premise. Nothing between the reasoning and the signature compares the result to a limit.</p>
        <p class="then"><b>With Amulet</b>The pendant checks the transaction against limits you wrote and refuses anything outside them before the Ledger wakes.</p>
      </div>
      <div class="row">
        <h3>You approve on a phone.</h3>
        <p><b>Normally</b>The screen showing you the transaction belongs to a computer running everything else you installed. It can show one thing and send another.</p>
        <p class="then"><b>With Amulet</b>The Ledger decodes the transaction itself and shows it on a screen wired to the chip that holds the key. Two screens have to agree.</p>
      </div>
      <div class="row">
        <h3>The limits need changing.</h3>
        <p><b>Normally</b>They sit in the agent's own configuration, so the agent, or anyone who reaches it, can raise them.</p>
        <p class="then"><b>With Amulet</b>They sit on your name, and only a Ledger signature can edit them. The agent may write its own status and nothing more.</p>
      </div>
    </div>

  </div>
</section>

<script>
  /* On narrow screens the edge callouts are hidden, so crop the drawing to the
     object itself instead of scrolling across the empty margin they leave. */
  (function () {
    var svg = document.querySelector('svg.assembly');
    if (!svg) return;
    var wide = '0 0 2100 1000', tight = '600 90 730 710';
    var mq = window.matchMedia('(max-width: 1000px)');
    var apply = function () { svg.setAttribute('viewBox', mq.matches ? tight : wide); };
    apply();
    mq.addEventListener ? mq.addEventListener('change', apply) : mq.addListener(apply);
  })();
</script>
</body>
</html>
'''
open("index.html","w").write(html.replace("__ASSEMBLY__", svg))
print("index.html written")
