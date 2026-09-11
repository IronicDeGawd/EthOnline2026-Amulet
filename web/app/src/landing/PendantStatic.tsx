import { forwardRef } from 'react'

/* The hero pendant, face-on. On a wide screen it is hidden and the assembly drawing
   stands in its place, seated on these exact coordinates; on a narrow screen it is
   the only pendant the page shows. */
const PendantStatic = forwardRef<HTMLElement>(function PendantStatic(_props, ref) {
  return (
        <figure className="device" ref={ref as React.Ref<HTMLElement>}>
          <svg className="static" viewBox="0 0 620 560" role="img" aria-labelledby="devtitle devdesc">
            <title id="devtitle">The Amulet pendant, seen from the front</title>
            <desc id="devdesc">A 39 millimetre round display showing a proposal to repay 120 sUSDC on Aave, with a swipe-to-approve prompt, drawn with a dimension line marking its diameter.</desc>
            <g stroke="#4a545c" strokeWidth="1" fill="none">
              <line x1="120" y1="66" x2="500" y2="66"/>
              <line x1="120" y1="58" x2="120" y2="74"/><line x1="500" y1="58" x2="500" y2="74"/>
              <line x1="120" y1="82" x2="120" y2="128"/><line x1="500" y1="82" x2="500" y2="128"/>
            </g>
            <rect x="283" y="54" width="54" height="24" fill="#e9ecee"/>
            <text className="data" x="310" y="71" textAnchor="middle" fontSize="13" fill="#4a545c">39 mm</text>
            <g stroke="#4a545c" strokeWidth="1.4" fill="none">
              <path d="M296 128 C 296 108 300 96 310 92"/><path d="M324 128 C 324 108 320 96 310 92"/>
            </g>
            <circle cx="310" cy="88" r="7" fill="none" stroke="#4a545c" strokeWidth="1.4"/>
            <circle cx="310" cy="320" r="192" fill="#d5dade" stroke="#14181c" strokeWidth="1.6"/>
            <circle cx="310" cy="320" r="181" fill="none" stroke="#c5cbd0" strokeWidth="1"/>
            <circle cx="310" cy="320" r="170" fill="#0d1114"/>
            <circle cx="310" cy="320" r="152" fill="none" stroke="#b8901f" strokeWidth="4"
                    strokeLinecap="round" strokeDasharray="796 159" transform="rotate(120 310 320)"/>
            <text className="data" x="310" y="252" textAnchor="middle" fontSize="14" fill="#7e8a92" letterSpacing="1.4">TIER 2 &#183; AAVE V3</text>
            <text x="310" y="308" textAnchor="middle" fontSize="32" fontWeight="600" fill="#f2f5f6">Repay</text>
            <text x="310" y="348" textAnchor="middle" fontSize="32" fontWeight="600" fill="#f2f5f6">120 sUSDC</text>
            <text className="data" x="310" y="382" textAnchor="middle" fontSize="15" fill="#9aa5ad">health 1.18 &#8594; 1.41</text>
            <g stroke="#b8901f" strokeWidth="2" fill="none" strokeLinecap="round">
              <line x1="266" y1="424" x2="338" y2="424"/><path d="M330 416 L 340 424 L 330 432"/>
            </g>
            <text className="data" x="310" y="456" textAnchor="middle" fontSize="14" fill="#7e8a92">swipe to approve</text>
            <rect x="486" y="352" width="16" height="34" rx="3" fill="#d5dade" stroke="#14181c" strokeWidth="1.4"/>
          </svg>
          <figcaption>
            <span><b>240 &#215; 240</b> round display</span>
            <span><b>ESP32-S3</b> &#183; Wi-Fi + Bluetooth</span>
            <span><b>Haptic</b> &#183; three tiers</span>
            <span><b>No key</b> stored on board</span>
          </figcaption>
        </figure>
  )
})
export default PendantStatic
