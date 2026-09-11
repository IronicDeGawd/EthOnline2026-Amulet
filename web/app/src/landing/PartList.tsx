const PARTS = [
  'cover glass · capacitive touch',
  'round display · 240 × 240',
  'carrier board · clock · charger',
  'ESP32-S3 · Wi-Fi and Bluetooth',
  'antenna · 2.4 GHz',
  'haptic motor · driver · resistor',
  'battery · 500 mAh',
]

/* Only shown below 1000px, where the callouts on the drawing are hidden. */
export default function PartList() {
  return (
    <section className="object-tail">
      <div className="shell">
        <ol className="partlist data">
          {PARTS.map((p, i) => <li key={i}><b>{i + 1}</b>{p}</li>)}
        </ol>
      </div>
    </section>
  )
}
