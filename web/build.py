import math

INK, INK2, RULE, GOLD = "#14181c", "#4a545c", "#c5cbd0", "#b8901f"
PAPER = "#e2e4e2"
A = math.radians(45)
D  = (math.cos(A), math.sin(A))            # explode axis
P  = (-math.sin(A), math.cos(A))           # in-face width direction
K  = 0.34                                  # foreshortening of the in-face depth axis
O  = (760.0, 230.0)                        # axis origin
S  = 7.0                                   # px per mm

# The object is solid before the reader opens it. Only the front face of each part carries a
# colour; the page fades it out as the parts separate, so the same drawing arrives as line work.
# The object is solid before the reader opens it. The silhouettes that already occlude the parts
# behind carry that colour; the page fades them back to paper as the parts separate, so the same
# drawing becomes line work without a second drawing existing anywhere.
SOLIDS = {
    0:   "#2b3138",   # cover glass, dark and slightly reflective
    100: "#161a1e",   # the display itself, nearly black
    215: "#2f5d50",   # carrier board, board green
    320: "#242a30",   # the module under its shield can
    395: "#b8901f",   # antenna, copper
    470: "#2f5d50",   # haptic circuit, the same board green
    560: "#9aa2a8",   # battery, brushed silver
}

def at(s):  return (O[0] + s*D[0], O[1] + s*D[1])
def f2s(C, u, v):  return (C[0] + u*P[0] + v*K*D[0], C[1] + u*P[1] + v*K*D[1])
def off(C, t):     return (C[0] + t*D[0], C[1] + t*D[1])
def fmt(p):        return f"{p[0]:.1f} {p[1]:.1f}"

def ell(C, R, t0=0.0, t1=360.0, n=96, close=True, ry=None):
    rv = R if ry is None else ry
    pts = []
    for i in range(n+1):
        a = math.radians(t0 + (t1-t0)*i/n)
        pts.append(f2s(C, R*math.cos(a), rv*math.sin(a)))
    d = "M" + " L".join(fmt(p) for p in pts)
    return d + (" Z" if close and abs(t1-t0) >= 359 else "")

def cyl(C, R, th, stroke=INK, w=1.3, ry=None):
    """front face + visible back arc + two side walls"""
    B = off(C, th)
    rv = R if ry is None else ry
    a = f2s(C, R, 0); b = f2s(C, -R, 0)
    a2 = f2s(B, R, 0); b2 = f2s(B, -R, 0)
    return (f'<path d="{ell(C,R,ry=rv)}" stroke="{stroke}" stroke-width="{w}"/>'
            f'<path d="{ell(B,R,0,180,48,False,ry=rv)}" stroke="{stroke}" stroke-width="{w}"/>'
            f'<path d="M{fmt(a)} L{fmt(a2)}" stroke="{stroke}" stroke-width="{w}"/>'
            f'<path d="M{fmt(b)} L{fmt(b2)}" stroke="{stroke}" stroke-width="{w}"/>')

def slab(C, w_, h_, th, stroke=INK, w=1.3):
    """box whose front face is perpendicular to the axis"""
    B = off(C, th)
    c = [f2s(C,-w_/2,-h_/2), f2s(C,w_/2,-h_/2), f2s(C,w_/2,h_/2), f2s(C,-w_/2,h_/2)]
    b = [f2s(B,-w_/2,-h_/2), f2s(B,w_/2,-h_/2), f2s(B,w_/2,h_/2), f2s(B,-w_/2,h_/2)]
    s  = f'<path d="M{fmt(c[0])} L{fmt(c[1])} L{fmt(c[2])} L{fmt(c[3])} Z" stroke="{stroke}" stroke-width="{w}"/>'
    s += f'<path d="M{fmt(b[1])} L{fmt(b[2])} L{fmt(b[3])}" stroke="{stroke}" stroke-width="{w}"/>'
    for i in (1,2,3):
        s += f'<path d="M{fmt(c[i])} L{fmt(b[i])}" stroke="{stroke}" stroke-width="{w}"/>'
    return s

def frect(C, u, v, w_, h_, stroke=INK2, wd=1.0):
    q = [f2s(C,u-w_/2,v-h_/2), f2s(C,u+w_/2,v-h_/2), f2s(C,u+w_/2,v+h_/2), f2s(C,u-w_/2,v+h_/2)]
    return f'<path d="M{fmt(q[0])} L{fmt(q[1])} L{fmt(q[2])} L{fmt(q[3])} Z" stroke="{stroke}" stroke-width="{wd}"/>'

def fcirc(C, u, v, r, stroke=INK2, wd=1.0):
    return f'<path d="{ell((C[0]+u*P[0]+v*K*D[0], C[1]+u*P[1]+v*K*D[1]), r)}" stroke="{stroke}" stroke-width="{wd}"/>'

def fline(C, u1, v1, u2, v2, stroke=INK2, wd=1.0):
    return f'<path d="M{fmt(f2s(C,u1,v1))} L{fmt(f2s(C,u2,v2))}" stroke="{stroke}" stroke-width="{wd}"/>'

PART = 0   # which part is being drawn; its colour is the one the silhouettes carry

def cyl_fill(C, R, th, ry=None, tint=None):
    """opaque silhouette of an oblique cylinder, so nearer parts occlude farther ones"""
    B = off(C, th); rv = R if ry is None else ry
    a, b   = f2s(C, R, 0), f2s(C, -R, 0)
    a2, b2 = f2s(B, R, 0), f2s(B, -R, 0)
    t = tint or SOLIDS.get(PART)
    k = f'class="solid" style="--tint:{t}"' if t else ""
    return (f'<path d="{ell(C,R,ry=rv)}" fill="{PAPER}" stroke="none" {k}/>'
            f'<path d="{ell(B,R,ry=rv)}" fill="{PAPER}" stroke="none" {k}/>'
            f'<path d="M{fmt(a)} L{fmt(a2)} L{fmt(b2)} L{fmt(b)} Z" fill="{PAPER}" stroke="none" {k}/>')

def slab_fill(C, w_, h_, th, tint=None):
    B = off(C, th)
    c = [f2s(C,-w_/2,-h_/2), f2s(C,w_/2,-h_/2), f2s(C,w_/2,h_/2), f2s(C,-w_/2,h_/2)]
    b = [f2s(B,-w_/2,-h_/2), f2s(B,w_/2,-h_/2), f2s(B,w_/2,h_/2), f2s(B,-w_/2,h_/2)]
    t = tint or SOLIDS.get(PART)
    k = f'class="solid" style="--tint:{t}"' if t else ""
    q = c + [b[1], b[2], b[3]]
    return (f'<path d="M{fmt(c[0])} L{fmt(c[1])} L{fmt(c[2])} L{fmt(c[3])} Z" fill="{PAPER}" stroke="none" {k}/>'
            f'<path d="M{fmt(b[0])} L{fmt(b[1])} L{fmt(b[2])} L{fmt(b[3])} Z" fill="{PAPER}" stroke="none" {k}/>'
            f'<path d="M{fmt(c[1])} L{fmt(b[1])} L{fmt(b[2])} L{fmt(c[2])} Z" fill="{PAPER}" stroke="none" {k}/>'
            f'<path d="M{fmt(c[2])} L{fmt(b[2])} L{fmt(b[3])} L{fmt(c[3])} Z" fill="{PAPER}" stroke="none" {k}/>')

def knurl(C, R, th, n=110, depth=9):
    """machined ridges around a rim"""
    out = []
    B = off(C, th)
    for i in range(n):
        a = math.radians(180 * i / (n-1))          # visible half only
        p1 = f2s(C, R*math.cos(a), R*math.sin(a))
        p2 = f2s(B, (R-depth)*math.cos(a), (R-depth)*math.sin(a))
        out.append(f'<path d="M{fmt(p1)} L{fmt(p2)}" stroke="{RULE}" stroke-width="0.8"/>')
    return "".join(out)

groups = []
g = []
def seal(sv):
    groups.append((sv, ''.join(g)))
    g.clear()

# ---- 1 · cover glass -------------------------------------------------------
PART = 0
C1 = at(0); R1 = 19.5*S
g.append(cyl_fill(C1, R1, 9))
g.append(knurl(C1, R1, 9))
g.append(cyl(C1, R1, 9))
g.append(f'<path d="{ell(C1, R1-11)}" stroke="{RULE}" stroke-width="1"/>')
g.append(f'<path d="{ell(C1, R1-26)}" stroke="{INK2}" stroke-width="1" stroke-dasharray="4 9"/>')
g.append(f'<path d="{ell(C1, R1-40, 200, 320, 40, False)}" stroke="{RULE}" stroke-width="3"/>')

seal(0)
# ---- 2 · display panel ----------------------------------------------------
PART = 100
C2 = at(100); R2 = 17*S
g.append(cyl_fill(C2, R2, 17))
g.append(cyl(C2, R2, 17))
g.append(f'<path d="{ell(C2, R2-9)}" stroke="{RULE}" stroke-width="1"/>')
g.append(f'<path d="{ell(C2, R2-22)}" stroke="{INK2}" stroke-width="1" stroke-dasharray="3 8"/>')
g.append(f'<path d="{ell(C2, R2-34, 128, 392, 72, False)}" stroke="{GOLD}" stroke-width="4"/>')
for v, hw in ((-12, 44), (0, 44), (14, 34)):
    g.append(fline(C2, -hw, v, hw, v, INK2, 5))
g.append(fline(C2, -16, 34, 14, 34, GOLD, 1.4))
g.append(f'<path d="M{fmt(f2s(C2,6,30))} L{fmt(f2s(C2,16,34))} L{fmt(f2s(C2,6,38))}" stroke="{GOLD}" stroke-width="1.4"/>')
# flex ribbon leaving the panel edge, folded back along the axis
RIM = R2 - 2
t1 = f2s(C2, -20, RIM); t2 = f2s(C2, 20, RIM)
t3 = off(t2, 54); t4 = off(t1, 54)
g.append(f'<path d="M{fmt(t1)} L{fmt(t2)} L{fmt(t3)} L{fmt(t4)} Z" fill="{PAPER}" stroke="none"/>')
g.append(f'<path d="M{fmt(t1)} L{fmt(t2)}" stroke="{RULE}" stroke-width="1"/>')
g.append(f'<path d="M{fmt(t2)} L{fmt(t3)} L{fmt(t4)} L{fmt(t1)}" stroke="{INK}" stroke-width="1.2"/>')
for i in range(7):
    u = -14 + i*4.7
    q1 = off(f2s(C2, u, RIM), 12); q2 = off(f2s(C2, u, RIM), 50)
    g.append(f'<path d="M{fmt(q1)} L{fmt(q2)}" stroke="{RULE}" stroke-width="0.8"/>')

seal(100)
# ---- 3 · carrier board ----------------------------------------------------
PART = 215
C3 = at(215); R3 = 19.5*S
g.append(cyl_fill(C3, R3, 12))
g.append(cyl(C3, R3, 12))
g.append(f'<path d="{ell(C3, R3-10)}" stroke="{RULE}" stroke-width="1"/>')
for uu, vv in ((-86,-86),(86,-86),(86,86),(-86,86)):
    g.append(fcirc(C3, uu, vv, 6, INK2))
# two 7-pin headers
for v in (-58, 58):
    g.append(frect(C3, 0, v, 168, 26, INK, 1.2))
    for i in range(7):
        g.append(fcirc(C3, -72 + i*24, v, 5, INK2))
# memory-card slot with its switch
g.append(frect(C3, 0, 96, 100, 54, INK, 1.2))
g.append(frect(C3, 0, 116, 84, 11, RULE))
g.append(frect(C3, 4, 90, 30, 13, INK2))
# clock coin cell + chip
g.append(fcirc(C3, -94, -28, 32, INK, 1.2))
g.append(fcirc(C3, -94, -28, 22, RULE))
g.append(frect(C3, -44, -100, 40, 24, INK2))
for i in range(4):
    g.append(fline(C3, -58 + i*9, -112, -58 + i*9, -118, INK2, 0.9))
    g.append(fline(C3, -58 + i*9, -88,  -58 + i*9, -82,  INK2, 0.9))
# charger + passives + connectors
g.append(frect(C3, 74, -80, 32, 22, INK2))
for i in range(3):
    g.append(frect(C3, 74 + i*14, -50, 9, 12, RULE))
g.append(frect(C3, 22, -114, 88, 20, INK2))
g.append(frect(C3, -68, 88, 52, 22, INK, 1.2))
g.append(frect(C3, -76, 88, 20, 13, INK2))
g.append(frect(C3, 72, 86, 44, 24, INK, 1.2))
g.append(frect(C3, 63, 86, 11, 13, INK2))
g.append(frect(C3, 83, 86, 11, 13, INK2))

seal(215)
# ---- 4 · XIAO module ------------------------------------------------------
PART = 320
C4 = at(320); W4, H4 = 21*S, 17.8*S
g.append(slab_fill(C4, W4, H4, 21))
g.append(slab(C4, W4, H4, 21))
# shield can, inset, with a diagonal hatch
g.append(frect(C4, 0, 6, 100, 66, INK, 1.2))
g.append(fline(C4, -50, -27, 50, 39, RULE, 0.8))
g.append(fline(C4, 50, -27, -50, 39, RULE, 0.8))
# USB-C shell projecting forward along the axis
u1 = f2s(C4, -30, -H4/2); u2 = f2s(C4, 30, -H4/2)
u3 = off(u2, -26); u4 = off(u1, -26)
g.append(f'<path d="M{fmt(u1)} L{fmt(u2)} L{fmt(u3)} L{fmt(u4)} Z" stroke="{INK}" stroke-width="1.2"/>')
g.append(f'<path d="M{fmt(off(u4,-0))} L{fmt(off(u3,-0))}" stroke="{RULE}" stroke-width="0.8"/>')
# antenna jack, LEDs, buttons
g.append(fcirc(C4, -44, 48, 11, INK, 1.2))
g.append(fcirc(C4, -44, 48, 4, INK2))
g.append(frect(C4, 2, 52, 9, 7, INK2))
g.append(frect(C4, 16, 52, 9, 7, INK2))
g.append(frect(C4, -56, 30, 11, 11, INK2))
g.append(frect(C4, 56, 30, 11, 11, INK2))
# castellated pads down both long edges
for i in range(7):
    v = -48 + i*16
    for sgn in (-1, 1):
        p1 = f2s(C4, sgn*W4/2, v)
        p2 = off(p1, 8)
        g.append(f'<path d="M{fmt(p1)} L{fmt(p2)}" stroke="{GOLD}" stroke-width="2.4"/>')

seal(320)
# ---- 5 · antenna ----------------------------------------------------------
PART = 395
C5 = at(395)
g.append(slab_fill(C5, 204, 28, 14))
b1 = f2s(C5, -108, -14); b2 = f2s(C5, 96, -14)
b3 = f2s(C5, 96, 14);    b4 = f2s(C5, -108, 14)
g.append(f'<path d="M{fmt(b1)} L{fmt(b2)} L{fmt(b3)} L{fmt(b4)} Z" stroke="{INK}" stroke-width="1.3"/>')
g.append(f'<path d="M{fmt(off(b2,14))} L{fmt(off(b3,14))}" stroke="{INK}" stroke-width="1.3"/>')
g.append(f'<path d="M{fmt(b2)} L{fmt(off(b2,14))}" stroke="{INK}" stroke-width="1.3"/>')
g.append(f'<path d="M{fmt(b3)} L{fmt(off(b3,14))}" stroke="{INK}" stroke-width="1.3"/>')
g.append(fline(C5, -96, 0, 84, 0, INK2, 1.0))
g.append(fline(C5, 96, 0, 132, 0, INK2, 1.0))
g.append(fcirc(C5, 146, 0, 13, INK, 1.2))
g.append(fcirc(C5, 146, 0, 5, INK2))

seal(395)
# ---- 6 · haptic circuit ---------------------------------------------------
PART = 470
C6 = at(470)
M = f2s(C6, -96, 0)
g.append(cyl_fill(M, 5*S, 19))
g.append(cyl(M, 5*S, 19))
g.append(f'<path d="{ell(M, 5*S-9)}" stroke="{RULE}" stroke-width="1"/>')
g.append(f'<path d="{ell(M, 8)}" stroke="{INK2}" stroke-width="1"/>')
for i in range(6):
    a = math.radians(i*30)
    p1 = f2s(M, (5*S-9)*math.cos(a), (5*S-9)*math.sin(a))
    p2 = f2s(M, -(5*S-9)*math.cos(a), -(5*S-9)*math.sin(a))
    g.append(f'<path d="M{fmt(p1)} L{fmt(p2)}" stroke="{RULE}" stroke-width="0.8"/>')
g.append(fline(C6, -60, -8, -18, -8, INK2, 2.4))
g.append(fline(C6, -60, 8, -18, 8, INK2, 2.4))
# transistor: half-round body, three legs
tc = f2s(C6, 22, 0)
g.append(f'<path d="{ell(tc, 26, 180, 360, 40, False)}" stroke="{INK}" stroke-width="1.3"/>')
g.append(fline(C6, -4, 0, 48, 0, INK, 1.3))
for u in (8, 22, 36):
    g.append(fline(C6, u, 0, u, 40, INK2, 2.0))
# resistor with colour bands
g.append(fline(C6, 62, -22, 152, -22, INK2, 1.0))
g.append(frect(C6, 107, -22, 62, 22, INK, 1.2))
for u in (86, 96, 106, 124):
    g.append(fline(C6, u, -33, u, -11, INK2, 2.6))

seal(470)
# ---- 7 · battery ----------------------------------------------------------
PART = 560
C7 = at(560); W7, H7 = 35*S, 30*S
g.append(slab_fill(C7, W7, H7, 35))
g.append(slab(C7, W7, H7, 35))
g.append(fline(C7, -W7/2, -H7/2+26, W7/2, -H7/2+26, INK2, 1.0))
g.append(fline(C7, -W7/2, -H7/2+34, W7/2, -H7/2+34, RULE, 0.8))
pb = f2s(C7, 0, -H7/2)
g.append(frect(C7, 0, -H7/2-16, 88, 32, INK, 1.2))
for u in (-16, 16):
    q1 = f2s(C7, u, -H7/2-32); q2 = off(q1, -46)
    g.append(f'<path d="M{fmt(q1)} L{fmt(q2)}" stroke="{INK2}" stroke-width="2"/>')
jc = off(f2s(C7, 0, -H7/2-32), -46)
g.append(f'<path d="M{fmt((jc[0]-24,jc[1]-14))} L{fmt((jc[0]+24,jc[1]-14))} L{fmt((jc[0]+24,jc[1]+14))} L{fmt((jc[0]-24,jc[1]+14))} Z" stroke="{INK}" stroke-width="1.2"/>')

seal(560)
# ---- axis ------------------------------------------------------------------
# Each part carries the distance it travels along the axis, so the page can draw the object
# stacked and let the scroll open it. At t=1 every group sits exactly where it does here, which
# is what makes the animation the same drawing rather than a second one.
body = "".join(
    f'<g class="part" data-s="{sv:.0f}" style="--dx:{sv*D[0]:.1f}px;--dy:{sv*D[1]:.1f}px">{body_}</g>'
    for sv, body_ in sorted(groups, key=lambda t: -t[0]))
axis = (f'<path d="M{fmt(off(O,-60))} L{fmt(off(O,660))}" stroke="{INK2}" '
        f'stroke-width="1" stroke-opacity="0.4" stroke-dasharray="2 10"/>')

# ---- leaders and labels ----------------------------------------------------
labels = [
    (C1, 55,  1, 96,   "cover glass · capacitive touch"),
    (C2, 55,  1, 144,  "round display · 240 × 240"),
    (C3, 55,  1, 192,  "carrier board · clock · charger"),
    (C4, 50,  1, 240,  "ESP32-S3 · Wi-Fi and Bluetooth"),
    (C5, 205, -1, 852, "antenna · 2.4 GHz"),
    (C6, 205, -1, 900, "haptic motor · driver · resistor"),
    (C7, 210, -1, 948, "battery · 500 mAh"),
]
LX_R, LX_L = 2048, 52
LBL_PX, ADV, GAP = 19, 0.601, 16          # IBM Plex Mono advance ratio
lead = []
for C, ang, side, ly, text in labels:
    a = math.radians(ang)
    ax_, ay_ = f2s(C, 120*math.cos(a), 120*math.sin(a))
    tw = len(text) * LBL_PX * ADV
    if side == 1:
        stop = LX_R - tw - GAP                 # stop the rule before the type
        bx = ax_ + (ay_ - ly)
        pts = f"{ax_:.0f},{ay_:.0f} {bx:.0f},{ly} {stop:.0f},{ly}"
        anchor, tx = "end", LX_R
    else:
        stop = LX_L + tw + GAP
        bx = ax_ - (ly - ay_)
        pts = f"{ax_:.0f},{ay_:.0f} {bx:.0f},{ly} {stop:.0f},{ly}"
        anchor, tx = "start", LX_L
    lead.append(f'<polyline points="{pts}" stroke="{INK2}" stroke-width="1" fill="none"/>')
    lead.append(f'<circle cx="{ax_:.0f}" cy="{ay_:.0f}" r="2.5" fill="{INK2}" stroke="none"/>')
    lead.append(f'<text class="lbl" x="{tx}" y="{ly+6}" text-anchor="{anchor}">{text}</text>')

svg = (f'<svg viewBox="0 0 2100 1000" class="assembly" role="img" aria-label="Exploded view of the pendant: cover glass, round display, carrier board, the ESP32-S3 module, its antenna, the haptic circuit and the battery, arranged along one axis." fill="none">'
       f'{axis}<g stroke-linejoin="round" stroke-linecap="round">{body}</g><g class="callouts">{"".join(lead)}</g></svg>')

open("assembly.svg.part", "w").write(svg)
print("groups:", len(groups), "bytes:", len(svg))
