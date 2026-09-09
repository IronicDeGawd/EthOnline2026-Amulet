import sys
FONT = '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Manrope:wght@500;600;700;800&family=IBM+Plex+Mono:wght@500&display=swap">'
T, M, BLUE, LITE, GREEN, RED, ORANGE, PURPLE = "#f4f7fb", "#9aa7b8", "#4f8ef7", "#cfe3fb", "#22c55e", "#ef4444", "#f97316", "#8b5cf6"
MONO = "'IBM Plex Mono',ui-monospace,Menlo,monospace"

def t(top, size, weight, colour, text, *, lh=None, ls=0, left=0, width=240, family=None):
    lh = lh or round(size*1.15); fam = f"font-family:{family};" if family else ""
    return (f'<div style="position:absolute;top:{top}px;left:{left}px;width:{width}px;text-align:center;font-size:{size}px;'
            f'line-height:{lh}px;font-weight:{weight};letter-spacing:{ls}px;color:{colour};{fam}">{text}</div>')
def img(name): return f'<img src="{name}.jpg" style="position:absolute;top:0;left:0;width:240px;height:240px;">'
def svg(top, left, size, body, colour=T, sw=2):
    return (f'<svg style="position:absolute;top:{top}px;left:{left}px" width="{size}" height="{size}" viewBox="0 0 24 24" fill="none" '
            f'stroke="{colour}" stroke-width="{sw}" stroke-linecap="round" stroke-linejoin="round">{body}</svg>')
def circle(top, left, d, fill, extra=""):
    return f'<div style="position:absolute;top:{top}px;left:{left}px;width:{d}px;height:{d}px;border-radius:50%;background:{fill};{extra}"></div>'
def pill(top, text, width=124):
    return (f'<div style="position:absolute;top:{top}px;left:{(240-width)//2}px;width:{width}px;height:24px;border-radius:12px;'
            f'background:rgba(255,255,255,0.13);display:flex;align-items:center;justify-content:center;font-size:12.5px;font-weight:600;color:{T};">{text}</div>')
def segment(chord, fill, extra=""):
    import math; half = math.sqrt(120**2-(chord-120)**2)
    return (f'<svg style="position:absolute;top:0;left:0" width="240" height="240" viewBox="0 0 240 240">'
            f'<path d="M {120-half:.1f} {chord} A 120 120 0 0 0 {120+half:.1f} {chord} Z" fill="{fill}" {extra}></path></svg>')
def arc(pct, colour, sw=8, r=112):
    import math; c = 2*math.pi*r
    return (f'<svg style="position:absolute;top:0;left:0" width="240" height="240" viewBox="0 0 240 240">'
            f'<circle cx="120" cy="120" r="{r}" fill="none" stroke="rgba(255,255,255,0.08)" stroke-width="{sw}"></circle>'
            f'<circle cx="120" cy="120" r="{r}" fill="none" stroke="{colour}" stroke-width="{sw}" stroke-linecap="round" '
            f'stroke-dasharray="{c*pct:.1f} {c:.1f}" transform="rotate(-90 120 120)"></circle></svg>')

I_PLANE = '<path d="M22 2 11 13"></path><path d="M22 2 15 22 11 13 2 9z"></path>'
I_LOCK  = '<rect x="4" y="11" width="16" height="10" rx="2"></rect><path d="M8 11V7a4 4 0 0 1 8 0v4"></path>'
I_INFO  = '<circle cx="12" cy="12" r="10"></circle><path d="M12 16v-4M12 8h.01"></path>'
I_CHECK = '<path d="M5 12.5 10 17.5 19 7"></path>'
I_X     = '<path d="M6 6 18 18M18 6 6 18"></path>'
I_UP    = '<path d="M12 19V5M5 12l7-7 7 7"></path>'
I_DOWN  = '<path d="M12 5v14M5 12l7 7 7-7"></path>'
I_RIGHT = '<path d="M5 12h14M12 5l7 7-7 7"></path>'
I_LEDGER= '<rect x="3" y="3" width="8" height="8" rx="1.5"></rect><rect x="13" y="3" width="8" height="8" rx="1.5"></rect><rect x="3" y="13" width="8" height="8" rx="1.5"></rect><rect x="13" y="13" width="8" height="8" rx="1.5"></rect>'
I_DOC   = '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"></path><path d="M14 3v5h5M9 13h6M9 17h6"></path>'

def proposal_top(verb="Repay", amount="120", unit="USDC", reason="Health factor 1.08"):
    return [svg(18, 106, 28, I_PLANE, BLUE, 2.2), t(46, 19, 600, T, verb), t(64, 52, 800, T, amount, lh=56, ls=-1.8),
            t(122, 16, 700, T, unit, ls=0.4), pill(146, reason)]

S = {
 "Home": [img("aurora"),
          circle(40, 96, 48, "radial-gradient(circle at 40% 35%,#ffffff 0%,#bfe6ff 30%,#4fa8ff 70%,rgba(79,168,255,0) 100%)", "box-shadow:0 0 28px 6px rgba(90,170,255,0.55)"),
          t(98, 20, 700, T, "Watching", ls=-0.2), t(122, 12, 500, M, "Ready for proposals"),
          t(150, 13, 600, M, "Tue 16"), t(166, 36, 800, T, "10:24", lh=40, ls=-1.2)],
 "Main": [img("base"),
          '<svg style="position:absolute;top:0;left:0" width="240" height="240" viewBox="0 0 240 240"><defs><linearGradient id="lit" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4f8ef7" stop-opacity="0.34"></stop><stop offset="1" stop-color="#4f8ef7" stop-opacity="0.12"></stop></linearGradient></defs>'
          '<path d="M 21.1 184 A 120 120 0 0 0 218.9 184 Z" fill="url(#lit)"></path>'
          '<line x1="21.1" y1="184" x2="218.9" y2="184" stroke="rgba(150,192,255,0.65)" stroke-width="1.5"></line></svg>',
          *proposal_top(),
          circle(194, 64, 26, BLUE), svg(199, 69, 16, I_RIGHT, T, 2.4),
          '<div style="position:absolute;top:198px;left:96px;width:90px;text-align:left;font-size:15px;line-height:18px;font-weight:700;color:#f4f7fb;">Hold to sign</div>'],
 "ProposalHolding": [img("base"), arc(0.62, BLUE), *proposal_top(), t(194, 14, 600, M, "Signing...")],
 "ProposalBlocked": [img("base"), segment(180, "#0b101b", 'stroke="rgba(255,255,255,0.08)" stroke-width="1"'), *proposal_top("Repay","120","USDC"),
          svg(184, 112, 16, I_LOCK, T, 2),
          t(201, 12.5, 700, T, "Unlock your Ledger", lh=15), t(216, 10.5, 500, M, "Open ETH app", lh=13)],
 "ProposalAdvisory": [img("base"), circle(28, 102, 36, BLUE), svg(34, 108, 24, I_INFO, T, 2.2),
          t(72, 17, 600, T, "Gas cost"), t(92, 44, 800, T, "0.0021", lh=50, ls=-1.5), t(144, 16, 700, T, "ETH", ls=0.5), t(168, 15, 500, M, "&#8776; $6.35")],
 "LedgerWait": [img("base"), svg(28, 106, 28, I_LEDGER, T, 2.2), t(64, 22, 700, T, "Approve on", lh=26, ls=-0.3), t(88, 22, 700, T, "your Nano X", lh=26, ls=-0.3),
          '<svg style="position:absolute;top:122px;left:104px" width="32" height="32" viewBox="0 0 32 32"><circle cx="16" cy="16" r="13" fill="none" stroke="rgba(255,255,255,0.12)" stroke-width="3.5"></circle><circle cx="16" cy="16" r="13" fill="none" stroke="#4f8ef7" stroke-width="3.5" stroke-linecap="round" stroke-dasharray="58 82" transform="rotate(-90 16 16)"></circle></svg>',
          t(164, 12.5, 500, M, "Check the amount and", lh=16), t(180, 12.5, 500, M, "recipient on your device.", lh=16)],
 "Sent": [img("green"), circle(48, 92, 56, GREEN, "box-shadow:0 0 24px rgba(34,197,94,0.45)"), svg(60, 104, 32, I_CHECK, "#062b14", 3),
          t(120, 26, 700, T, "Sent", ls=-0.3), t(158, 15, 500, M, "0x93c5...f0e3", family=MONO)],
 "NotSent": [img("red"), circle(48, 92, 56, RED, "box-shadow:0 0 24px rgba(239,68,68,0.45)"), svg(60, 104, 32, I_X, "#2b0606", 3),
          t(120, 26, 700, T, "Not sent", ls=-0.3), t(158, 15, 500, M, "Insufficient funds")],
 "Blocked": [img("orange"), circle(40, 92, 56, "rgba(249,115,22,0.16)", "border:1px solid rgba(249,115,22,0.45)"), svg(52, 104, 32, I_LOCK, ORANGE, 2), t(100, 22, 700, T, "Unlock your", lh=26, ls=-0.3), t(124, 22, 700, T, "Ledger", lh=26, ls=-0.3),
          t(164, 12.5, 500, M, "Then open the", lh=16), t(180, 12.5, 500, M, "ETH app", lh=16)],
 "Receive": [img("base"), circle(40, 92, 56, "#101a2c", "border:1px solid rgba(255,255,255,0.1)"), svg(52, 104, 32, I_DOWN, T, 2.4),
          t(112, 22, 700, T, "Receive", ls=-0.3), t(148, 14, 500, M, "Show address on", lh=18), t(166, 14, 500, M, "your Ledger", lh=18)],
 "QuickActions": [img("base"),
          circle(62, 46, 52, "rgba(34,197,94,0.18)", "border:1px solid rgba(34,197,94,0.5)"), svg(76, 60, 24, I_UP, "#7ee2a3", 2.4), t(118, 12.5, 600, T, "Pay", left=46, width=52),
          circle(62, 142, 52, "rgba(79,142,247,0.18)", "border:1px solid rgba(79,142,247,0.5)"), svg(76, 156, 24, I_DOWN, "#9cc2ff", 2.4), t(118, 12.5, 600, T, "Receive", left=142, width=52),
          circle(134, 94, 52, "rgba(139,92,246,0.18)", "border:1px solid rgba(139,92,246,0.5)"), svg(148, 108, 24, I_DOC, "#c4b0ff", 2.2), t(190, 12.5, 600, T, "Recent", left=94, width=52)],
 "WallpaperAurora": [img("aurora")], "WallpaperHorizon": [img("horizon")], "WallpaperNebula": [img("nebula")],
}

def disc(parts): return ('<div style="position:relative;width:240px;height:240px;border-radius:50%;overflow:hidden;background:#000;'
                         'font-family:Manrope,system-ui,sans-serif;">' + "\n    ".join(parts) + '</div>')
SHELL = ('<!doctype html>\n<html>\n<head>\n  <meta charset="utf-8">\n  <script src="./support.js"></script>\n</head>\n<body>\n<x-dc>\n<helmet>\n  '
         + FONT + '\n  <style>\n    body { margin: 0; background: #0d1013; }\n    a { color: #4f8ef7; }\n    a:hover { color: #9cc2ff; }\n  </style>\n</helmet>\n{disc}\n</x-dc>\n</body>\n</html>\n')
for name, parts in S.items():
    open(f"{name}.dc.html","w").write(SHELL.replace("{disc}", disc(parts)))
cells = "".join(f'<div>{disc([p.replace('src="', 'src="art/') for p in parts])}'
                f'<p style="color:#777;font:12px system-ui;text-align:center;margin:8px 0 0">{name}</p></div>' for name, parts in S.items())
open("preview.html","w").write(f'<!doctype html><html><head><meta charset="utf-8">{FONT}</head><body style="margin:0;background:#0d1013;padding:36px"><div style="display:grid;grid-template-columns:repeat(4,240px);gap:44px 48px">{cells}</div></body></html>')
print(len(S), "artboards + preview")
