export default function Header() {
  return (
    <header className="top">
      <div className="shell">
        <a className="wordmark" href="./" aria-label="Amulet, home">
          <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true" fill="none">
            <circle cx="12" cy="12" r="10" stroke="#14181c" strokeWidth="1.6" />
            <circle cx="12" cy="12" r="5.4" stroke="#b8901f" strokeWidth="1.6" />
            <circle cx="12" cy="12" r="1.7" fill="#14181c" />
          </svg>
          Amulet
        </a>
        <nav>
          <a href="#object">The object</a>
          <a href="#compare">Where it breaks</a>
          <a href="#/proof" data-secondary="">Proof</a>
          <a href="https://github.com/IronicDeGawd/EthOnline2026-Amulet">GitHub</a>
        </nav>
      </div>
    </header>
  )
}
