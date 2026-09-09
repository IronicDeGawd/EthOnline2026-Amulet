"""Renders the pendant's bitmaps for the firmware, from the same artwork as the design canvas.

Backgrounds are full 240x240 RGB565 (112 KB each). Anything static that the design bakes into
the background — the orb on Home, the lit band on the proposal, the outcome badges — is
rendered here too, so the firmware only lays type and native widgets on top.

    python build_bitmaps.py            # writes src/bg/*.png and src/icons/*.png
    then LVGLImage.py converts them (see build.sh)
"""
import sys, math, os
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "..", "design", "pendant"))
import ref_render as R                       # plate(), tinted(), aurora() and friends, at 2x

OUT_BG, OUT_IC = os.path.join(HERE, "src", "bg"), os.path.join(HERE, "src", "icons")
os.makedirs(OUT_BG, exist_ok=True); os.makedirs(OUT_IC, exist_ok=True)

BLUE, GREEN, RED, ORANGE, WHITE = (79,142,247), (34,197,94), (239,68,68), (249,115,22), (244,247,251)

def to_pil(arr):
    """2x float array -> 240px RGB, rim anti-aliased against black (the panel outside the circle)."""
    arr = np.clip(R.bevel(R.vignette(arr)), 0, 255)
    arr = arr * R.AA[..., None]
    return Image.fromarray(arr.astype(np.uint8)).resize((240, 240), Image.LANCZOS)

def overlay(base, draw_fn, scale=4):
    """Draw with PIL at `scale`x onto a transparent layer, downsample, composite over base."""
    layer = Image.new("RGBA", (240*scale, 240*scale), (0,0,0,0))
    draw_fn(ImageDraw.Draw(layer), scale)
    layer = layer.resize((240, 240), Image.LANCZOS)
    return Image.alpha_composite(base.convert("RGBA"), layer).convert("RGB")

def glow(base, cx, cy, r, colour, strength=0.55, spread=26):
    """Soft halo behind a badge or orb."""
    g = Image.new("RGBA", (240, 240), (0,0,0,0))
    d = ImageDraw.Draw(g)
    d.ellipse((cx-r, cy-r, cx+r, cy+r), fill=colour + (int(255*strength),))
    g = g.filter(ImageFilter.GaussianBlur(spread))
    return Image.alpha_composite(base.convert("RGBA"), g).convert("RGB")

def badge(base, cy, colour, mark):
    """Outcome badge: 56px filled circle with a glow, and a 3px white mark drawn inside."""
    base = glow(base, 120, cy, 30, colour, 0.5, 20)
    def draw(d, s):
        d.ellipse(((120-28)*s, (cy-28)*s, (120+28)*s, (cy+28)*s), fill=colour + (255,))
        w = 3*s
        ink = {"check": (6,43,20,255), "x": (43,6,6,255)}[mark]
        if mark == "check":
            pts = [((120-9)*s, cy*s), ((120-2)*s, (cy+7)*s), ((120+10)*s, (cy-7)*s)]
            d.line(pts, fill=ink, width=w, joint="curve")
        else:
            d.line(((120-8)*s, (cy-8)*s, (120+8)*s, (cy+8)*s), fill=ink, width=w)
            d.line(((120+8)*s, (cy-8)*s, (120-8)*s, (cy+8)*s), fill=ink, width=w)
    return overlay(base, draw)

def band(base, chord, kind):
    """The confirm region below a horizontal chord: lit (translucent accent) or dark (locked)."""
    half = math.sqrt(120**2 - (chord-120)**2)
    def draw(d, s):
        if kind == "lit":
            # vertical fade from 34% to 12% of the accent, then a lit top edge
            for y in range(chord, 240):
                a = 0.34 - (0.34-0.12) * (y-chord) / (240-chord)
                d.line((0, y*s, 240*s, y*s), fill=BLUE + (int(255*a),), width=s)
            d.line(((120-half)*s, chord*s, (120+half)*s, chord*s), fill=(150,192,255,165), width=int(1.5*s))
        else:
            d.rectangle((0, chord*s, 240*s, 240*s), fill=(11,16,27,255))
            d.line((0, chord*s, 240*s, chord*s), fill=(255,255,255,20), width=s)
    img = overlay(base, draw)
    # keep the panel outside the circle black
    mask = Image.new("L", (240,240), 0); ImageDraw.Draw(mask).ellipse((0,0,239,239), fill=255)
    return Image.composite(img, Image.new("RGB", (240,240), (0,0,0)), mask)

def orb(base):
    base = glow(base, 120, 64, 26, (90,170,255), 0.7, 18)
    def draw(d, s):
        # radial-ish dome: concentric fills from edge to highlight
        for i in range(24, 0, -1):
            t = i/24
            col = (int(255-(255-79)*t*0.75), int(255-(255-168)*t*0.65), 255, 255)
            d.ellipse(((120-i)*s, (64-i)*s, (120+i)*s, (64+i)*s), fill=col)
        d.ellipse(((120-9)*s, (56-9)*s, (120+9)*s, (56+9)*s), fill=(255,255,255,200))
    return overlay(base, draw)

def icon(name, size, colour, draw_fn):
    """Stroke icon on a transparent square, drawn at 4x on a 24-unit grid."""
    s = 4; px = size*s
    im = Image.new("RGBA", (px, px), (0,0,0,0)); d = ImageDraw.Draw(im)
    u = px/24.0
    draw_fn(d, u, colour + (255,), max(2, int(2.2*u)))
    im.resize((size, size), Image.LANCZOS).save(os.path.join(OUT_IC, f"{name}.png"))

def ic_plane(d, u, c, w):
    d.line((22*u, 2*u, 11*u, 13*u), fill=c, width=w)
    d.line([(22*u,2*u),(15*u,22*u),(11*u,13*u),(2*u,9*u),(22*u,2*u)], fill=c, width=w, joint="curve")
def ic_arrow(d, u, c, w):
    d.line((5*u, 12*u, 19*u, 12*u), fill=c, width=w)
    d.line([(12*u,5*u),(19*u,12*u),(12*u,19*u)], fill=c, width=w, joint="curve")
def ic_lock(d, u, c, w):
    d.rounded_rectangle((4*u, 11*u, 20*u, 21*u), radius=2*u, outline=c, width=w)
    d.arc((8*u, 3*u, 16*u, 15*u), 180, 360, fill=c, width=w)
def ic_ledger(d, u, c, w):
    for x, y in ((3,3),(13,3),(3,13),(13,13)):
        d.rounded_rectangle((x*u, y*u, (x+8)*u, (y+8)*u), radius=1.5*u, outline=c, width=w)

if __name__ == "__main__":
    plate = to_pil(R.base())
    to_pil(R.base()).save(f"{OUT_BG}/bg_base.png")
    orb(to_pil(R.aurora())).save(f"{OUT_BG}/bg_home.png")
    orb(to_pil(R.horizon())).save(f"{OUT_BG}/bg_home_horizon.png")
    orb(to_pil(R.nebula())).save(f"{OUT_BG}/bg_home_nebula.png")
    band(plate, 184, "lit").save(f"{OUT_BG}/bg_proposal.png")
    band(plate, 180, "dark").save(f"{OUT_BG}/bg_locked.png")
    badge(to_pil(R.tinted("#22c55e", 0.32)), 76, GREEN, "check").save(f"{OUT_BG}/bg_sent.png")
    badge(to_pil(R.tinted("#ef4444", 0.30)), 76, RED, "x").save(f"{OUT_BG}/bg_notsent.png")
    blocked = glow(to_pil(R.tinted("#f97316", 0.26)), 120, 68, 30, ORANGE, 0.28, 18)
    def ring(d, s):
        d.ellipse(((120-28)*s, (68-28)*s, (120+28)*s, (68+28)*s), fill=ORANGE + (41,), outline=ORANGE + (115,), width=s)
        u = 32*s/24.0; ox, oy = (120-16)*s, (68-16)*s
        d.rounded_rectangle((ox+4*u, oy+11*u, ox+20*u, oy+21*u), radius=2*u, outline=ORANGE+(255,), width=int(2*u))
        d.arc((ox+8*u, oy+3*u, ox+16*u, oy+15*u), 180, 360, fill=ORANGE+(255,), width=int(2*u))
    overlay(blocked, ring).save(f"{OUT_BG}/bg_blocked.png")

    # Reactor idle face: the plate with the core glow baked in. The rotating rings are live
    # LVGL arcs, so only the part that never moves is a bitmap.
    reactor = to_pil(R.base(glow_amt=0.0))
    reactor = glow(reactor, 120, 120, 62, (60, 140, 255), 0.55, 30)      # wide halo
    reactor = glow(reactor, 120, 120, 34, (150, 210, 255), 0.75, 12)     # inner bloom
    def core(d, s):
        for i in range(26, 0, -1):
            t = i/26
            col = (int(255-(255-120)*t*0.8), int(255-(255-200)*t*0.6), 255, 255)
            d.ellipse(((120-i)*s, (120-i)*s, (120+i)*s, (120+i)*s), fill=col)
        d.ellipse(((120-58)*s, (120-58)*s, (120+58)*s, (120+58)*s), outline=(90,160,255,110), width=int(1.5*s))
    overlay(reactor, core).save(f"{OUT_BG}/bg_reactor.png")

    icon("ic_plane", 28, BLUE, ic_plane)
    icon("ic_arrow", 16, WHITE, ic_arrow)
    icon("ic_lock", 18, WHITE, ic_lock)
    icon("ic_ledger", 28, WHITE, ic_ledger)
    print("bitmaps:", sorted(os.listdir(OUT_BG)), "icons:", sorted(os.listdir(OUT_IC)))
