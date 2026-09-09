"""Backgrounds for the pendant screens, matched to context/design/pendant-screens-ref.png."""
import numpy as np, math
from PIL import Image, ImageFilter
S = 480; C = S/2
yy, xx = np.mgrid[0:S, 0:S].astype(np.float64)
X, Y = (xx-C)/C, (yy-C)/C
R = np.hypot(X, Y); AA = np.clip((1-R)*C, 0, 1)
rng = np.random.default_rng(3)

def hexc(h): h=h.lstrip('#'); return np.array([int(h[i:i+2],16) for i in (0,2,4)], float)
def fill(c): return np.ones((S,S,3))*c
def g(cx, cy, s): return np.exp(-((X-cx)**2+(Y-cy)**2)/(2*s*s))
def blur(a, r): return np.asarray(Image.fromarray(np.clip(a,0,255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(r))).astype(float)
def screen(b, l): return 255-(255-b)*(255-l)/255
def stars(img, n=90, bright=200):
    for _ in range(n):
        x, y = rng.integers(0, S, 2); r = rng.random()
        if np.hypot((x-C)/C,(y-C)/C) > 0.98: continue
        b = bright*(0.3+0.7*r**3)
        img[max(0,y-1):y+2, max(0,x-1):x+2] += b*0.35; img[y, x] += b
    return img
def vignette(img):
    return img * (1 - 0.35*np.clip((R-0.55)/0.45,0,1)**1.6)[...,None]
def bevel(img):
    lt = 0.5+0.5*np.cos(np.arctan2(Y,X) - math.radians(-135))
    ring = np.clip((R-0.955)/0.045,0,1)**1.5
    return img + ((lt-0.5)*48*ring)[...,None]
def base(top_glow="#2f63d8", glow_amt=0.30, ground="#0a1120", edge="#04070d"):
    t = np.clip(R,0,1)**0.9
    img = fill(hexc(ground))*(1-t[...,None]) + fill(hexc(edge))*t[...,None]
    img = screen(img, blur(fill(hexc(top_glow))*g(0,-0.55,0.55)[...,None], 40)*glow_amt)
    img += rng.normal(0, 1.8, (S,S,1))
    return img
def tinted(colour, amt=0.5):
    img = base(top_glow=colour, glow_amt=amt, ground="#0b1220")
    img = screen(img, blur(fill(hexc(colour))*g(0,-0.2,0.9)[...,None], 60)*0.10)
    return img
def aurora():
    img = base(glow_amt=0.15, ground="#0a1224")
    img = stars(img, 70, 150)
    band = np.zeros((S,S))
    for k,(f,ph,amp,y0,w) in enumerate([(1.6,0.3,0.10,0.42,0.09),(2.4,1.9,0.07,0.55,0.07),(1.1,4.0,0.12,0.70,0.11)]):
        yc = y0 + amp*np.sin(X*f*math.pi+ph) + 0.03*np.sin(X*7+k)
        band += np.exp(-((Y-yc)/w)**2) * (0.9-0.25*k)
    col = fill(hexc("#2ec7ff"))*np.clip(band,0,1)[...,None]*0.75 + fill(hexc("#3560ff"))*np.clip(band*0.6,0,1)[...,None]
    img = screen(img, blur(col*(Y>0.05)[...,None], 22))
    img = screen(img, blur(fill(hexc("#7fe6ff"))*np.clip(band-0.55,0,1)[...,None]*1.2, 4)*0.6)
    return img
def horizon():
    img = base(glow_amt=0.0, ground="#0d0f16", edge="#05060a")
    img = stars(img, 110, 190)
    hz = 0.18 + 0.06*np.sin(X*1.3+0.4)
    glow = np.exp(-np.clip(hz-Y,0,9)/0.22)*(Y<hz) + np.exp(-np.clip(Y-hz,0,9)/0.5)*(Y>=hz)
    img = screen(img, blur(fill(hexc("#ff8a2a"))*glow[...,None], 28)*0.55)
    img = screen(img, blur(fill(hexc("#ffd28a"))*np.exp(-((Y-hz)/0.03)**2)[...,None], 5)*0.55)
    img = img*(1-0.45*np.clip((Y-hz)/0.9,0,1))[...,None]
    return img
def nebula():
    img = base(glow_amt=0.0, ground="#0c0a1a", edge="#050409")
    img = stars(img, 140, 210)
    cloud = blur(np.repeat(rng.random((S,S,1))*255, 3, axis=2), 34)[...,0]/255
    cloud = np.clip((cloud-0.42)*3.2, 0, 1)
    shape = g(0.15,0.05,0.55)*1.1 + g(-0.4,0.35,0.35)*0.7
    col = fill(hexc("#7c3aed"))*(cloud*shape)[...,None]*1.3 + fill(hexc("#e040fb"))*(cloud**2*shape)[...,None]*0.9
    img = screen(img, blur(col, 8))
    img = screen(img, blur(fill(hexc("#c8a8ff"))*np.clip(cloud-0.7,0,1)[...,None]*shape[...,None], 2)*0.5)
    return img
def save(img, name):
    img = np.clip(bevel(vignette(img)),0,255)
    img = img*AA[...,None] + np.array([13,16,19.])*(1-AA[...,None])
    Image.fromarray(img.astype(np.uint8)).resize((240,240), Image.LANCZOS).save(f"art/{name}.jpg", quality=86, optimize=True)
if __name__ == "__main__":
  save(base(), "base"); save(tinted("#22c55e",0.32), "green"); save(tinted("#ef4444",0.30), "red"); save(tinted("#f97316",0.26), "orange")
  save(aurora(), "aurora"); save(horizon(), "horizon"); save(nebula(), "nebula")
  print("backgrounds done")
