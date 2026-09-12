"""Overflow audit for the pendant screens: measure every label's worst-case text with the
real Manrope/Plex files at the size the firmware uses, against (a) the label's own box and
(b) the chord of the round disc at the label's vertical extent."""
import math
from PIL import ImageFont

F = __import__("pathlib").Path(__file__).resolve().parents[2] / "firmware" / "assets" / "fonts"
R = 118  # usable radius: 120 minus a 2 px bezel margin


def font(name):
    face, weight, size = name.split("_")
    path = str(F / ("IBMPlexMono-Medium.ttf" if face == "plexmono" else f"Manrope-{weight}.ttf"))
    return ImageFont.truetype(path, int(size)), int(size)


def width(fnt, s):
    return fnt.getlength(s)


def line_h(size):
    return round(size * 1.37)  # LVGL line height for Manrope (ascender + descender)


def chord(y):
    d = abs(y - 120)
    return 2 * math.sqrt(R * R - d * d) if d < R else 0


# (screen, label, font, top, x, box_w, mode, strings)
# x=None means centred in the 240 disc; mode: CLIP one line, DOT n lines, SCROLL, LEFT (x-anchored)
ITEMS = [
    ("HOME", "line1", "manrope_700_20", 98, None, 240, "CLIP", ["Watching", "Offline"]),
    ("HOME", "line2", "manrope_500_13", 122, None, 240, "CLIP", ["Ledger not paired", "Waiting for the agent", "Ready for proposals", "Ledger away", "Policy not refreshed"]),
    ("HOME", "date", "manrope_600_15", 150, None, 240, "CLIP", ["Wed 10", "Sat 31"]),
    ("HOME", "time", "manrope_800_36", 166, None, 240, "CLIP", ["23:59", "00:00"]),
    ("HOME", "battery %", "manrope_500_13", 206, 118, 40, "LEFT", ["100%"]),
    # REFUSED: the pendant explaining itself. The red mark owns y=48..103, so every row
    # here sits below it, and the bottom rows must be short — the disc is 133 px at y=214.
    ("REFUSED", "title", "manrope_700_22", 118, None, 240, "CLIP", ["Refused"]),
        ("REFUSED", "reason pill", "manrope_500_13", 162, 42, 156, "LEFT", ["Target is not in the policy", "Over the cap", "Unknown agent", "Proposal has no agent", "Wrong chain", "Expired"]),
    ("REFUSED", "hint", "manrope_500_11", 196, None, 240, "CLIP", ["Tap for detail"]),
    ("REFUSED SHEET", "who", "manrope_500_11", 46, None, 240, "CLIP", ["yield asked", "an unnamed agent asked"]),
    ("REFUSED SHEET", "what", "manrope_700_15", 66, 30, 180, "DOT2", ["Add 0.02 ETH collateral on Aave (sim)", "Repay 0.0062 ETH on Aave (sim)"]),
    ("REFUSED SHEET", "why", "manrope_500_13", 112, 30, 180, "DOT4", ["Target is not in the policy", "Over the cap: 0.02 ETH is more than 0.01 ETH"]),
    ("REFUSED SHEET", "footer", "manrope_500_11", 176, None, 240, "CLIP", ["Nothing was sent to the Ledger"]),
    ("REFUSED SHEET", "back", "manrope_500_13", 196, None, 240, "CLIP", ["Tap to go back"]),
    ("PROPOSAL", "verb", "manrope_600_19", 46, None, 240, "CLIP", ["Repay", "Add", "Send", "Swap"]),
    ("PROPOSAL", "amount", "manrope_800_52", 64, None, 240, "CLIP", ["0.0062", "0.0001", "0.05", "999999"]),  # brain caps the figure at 6 chars
    # unsplit headlines no longer reach the pendant: the brain refuses any that is not "Verb figure rest"
    ("PROPOSAL", "unit", "manrope_700_16", 122, None, 240, "CLIP", ["ETH on Aave (sim)", "ETH collateral on Aave (sim)", "sUSDC on Spark (sim)"]),
    ("PROPOSAL", "pill text", "manrope_700_13", 150, None, 112, "SCROLL", ["Health factor 1.15 is under 1.25; this brings it back toward 1.40."]),
    ("PROPOSAL", "hold row label", "manrope_700_15", 198, 96, 144, "LEFT", ["Hold to sign"]),
    ("PROPOSAL", "lock1", "manrope_700_13", 201, None, 240, "CLIP", ["Ledger not awake", "Ledger not paired"]),
    ("PROPOSAL", "lock2", "manrope_500_11", 216, None, 240, "CLIP", ["Hold to retry", "Hold to pair"]),
    ("PROPOSAL", "signing", "manrope_600_15", 194, None, 240, "CLIP", ["Signing...", "Finding Ledger..."]),
    ("ADVISORY", "a_label", "manrope_600_17", 72, None, 240, "CLIP", ["Note", "Aave"]),
    ("ADVISORY", "a_amount (split)", "manrope_800_44", 92, None, 240, "CLIP", ["83.2%", "1.07"]),
    ("ADVISORY", "a_label", "manrope_600_17", 72, None, 240, "CLIP", ["Utilization"]),
    ("ADVISORY", "a_unit", "manrope_700_16", 144, None, 240, "CLIP", ["on Aave WETH", "on Compound USDC"]),
    ("ADVISORY", "a_detail", "manrope_500_13", 168, 40, 160, "DOT2", ["Up 12.0 pts in 40 blocks; borrow rate 2.04%.", "Borrow demand surged 15.0 pts; rate now 2.04%.", "Nothing to sign"]),
    ("ADVISORY", "hint", "manrope_500_11", 208, None, 240, "CLIP", ["Swipe to dismiss"]),
    ("DETAIL", "title", "manrope_700_15", 44, 30, 180, "DOT2", ["Repay 0.0062 ETH on Aave (sim)", "Add 0.05 ETH collateral on Aave (sim)"]),
    ("DETAIL", "why", "manrope_500_13", 88, 30, 180, "DOT4", ["Health factor 1.15 is under 1.25; this brings it back toward 1.40.", "X" * 0 + "Health factor 1.07 slipped under 1.40; topping up collateral now restores the 1.40 target safely."]),
    ("DETAIL", "evidence", "manrope_500_11", 160, None, 240, "CLIP", ["QmcXE5..dAd  block 25942525", "manual  block 11670624"]),
    ("DETAIL", "target", "manrope_500_11", 175, None, 240, "CLIP", ["to 0x9A6c..467c  tier 2", "repay  to 0x9A6c..467c  tier 2", "guardian  to 0x9A6c..467c  tier 2"]),
    ("DETAIL", "back", "manrope_500_13", 200, None, 240, "CLIP", ["Tap to go back"]),
    ("OPTIONS", "title", "manrope_700_15", 44, None, 240, "CLIP", ["Better yield for WETH", "Better yield for USDC"]),
    ("OPTIONS", "row name (88 box)", "manrope_500_13", 76, 44, 88, "LEFT", ["Spark", "Compound", "Aave"]),
    ("OPTIONS", "row rate", "manrope_700_15", 76, 140, 56, "LEFT", ["3.97%", "12.50%"]),
    ("OPTIONS", "row 3 name", "manrope_500_13", 156, 44, 88, "LEFT", ["Compound"]),
    # PORTFOLIO: list at x=20..220, rows 176 wide inside it; first row tops at y=62
    ("PORTFOLIO", "title", "manrope_700_15", 34, None, 240, "CLIP", ["Holdings"]),
    ("PORTFOLIO", "row label", "manrope_700_15", 68, 44, 76, "LEFT", ["Owed", "sUSDC", "Aave", "Spark", "ETH"]),
    ("PORTFOLIO", "row value", "manrope_700_15", 74, 140, 68, "LEFT", ["0.0134", "$10.00", "0.05 ETH"]),
    ("PORTFOLIO", "row sub", "manrope_500_11", 86, 44, 96, "LEFT", ["in the account", "Aave health 1.33", "supplied"]),
    ("PORTFOLIO", "waiting", "manrope_500_13", 112, None, 240, "CLIP", ["asking the agent..."]),
    ("PORTFOLIO", "hint", "manrope_500_11", 202, None, 240, "CLIP", ["swipe sideways for home", "swipe up for home"]),
    # SWAP: two pills at y=74 and y=118 (36 px tall, x=32..208), Go pill at y=166 (x=54..186)
    ("SWAP", "title", "manrope_700_15", 30, None, 240, "CLIP", ["Swap"]),
    ("SWAP", "row 1 side", "manrope_500_13", 68, 46, 60, "LEFT", ["From"]),
    ("SWAP", "row 1 token", "manrope_700_15", 68, 120, 74, "LEFT", ["USDC", "ETH"]),
    ("SWAP", "row 2 side", "manrope_500_13", 106, 46, 60, "LEFT", ["To"]),
    ("SWAP", "row 2 token", "manrope_700_15", 106, 120, 74, "LEFT", ["USDC", "ETH"]),
    ("SWAP", "row 3 side", "manrope_500_13", 144, 46, 64, "LEFT", ["Amount"]),
    ("SWAP", "row 3 value", "manrope_700_15", 144, 112, 82, "LEFT", ["0.005 ETH", "0.02 ETH", "50 USDC"]),
    ("SWAP", "go label", "manrope_700_15", 185, 58, 124, "LEFT", ["Find a route", "Asking...", "Pick two", "No link"]),
    ("OPTIONS", "row 3 rate", "manrope_700_15", 156, 140, 56, "LEFT", ["12.50%"]),
    ("OPTIONS", "footer", "manrope_500_11", 188, None, 240, "CLIP", ["mainnet data, sim run"]),
    ("RESULT", "picked detail", "manrope_500_13", 158, 35, 170, "DOT2", ["Compound - asking the agent"]),
    ("AGENT", "name", "manrope_700_20", 116, None, 240, "CLIP", ["repay", "yield", "guardian"]),
    ("AGENT", "parent", "manrope_500_13", 144, None, 240, "CLIP", ["amuletguard.eth"]),
    ("AGENT", "hint", "manrope_500_13", 178, None, 240, "CLIP", ["Tap to see the request", "opening..."]),
    ("PAIRING", "line1", "manrope_700_20", 58, None, 240, "CLIP", ["Same code on"]),
    ("PAIRING", "line2", "manrope_700_20", 82, None, 240, "CLIP", ["your Nano X?"]),
    ("PAIRING", "code", "manrope_800_36", 118, None, 240, "CLIP", ["888 888"]),
    ("PAIRING", "hint", "manrope_500_11", 160, None, 240, "CLIP", ["Refuse it there if not"]),
    ("PAIRING", "hold row label", "manrope_700_15", 198, 96, 144, "LEFT", ["Tap Nano X"]),
    ("PAIRING", "doing", "manrope_600_15", 194, None, 240, "CLIP", ["Pairing..."]),
    ("LEDGER", "title", "manrope_700_26", 72, None, 240, "CLIP", ["Not paired", "Paired", "Removed"]),
    ("LEDGER", "detail", "manrope_500_13", 108, None, 240, "CLIP", ["Nano X  0x2118..7736", "Pair again any time", "Not found. Is it unlocked?", "open the Ethereum app", "unlock your Ledger", "Ledger not ready"]),
    ("LEDGER", "hold label", "manrope_700_13", 200, 86, 150, "LEFT", ["Hold to remove", "Hold to pair"]),
    ("LEDGER", "doing", "manrope_600_15", 194, None, 240, "CLIP", ["Removing...", "Pairing..."]),
    ("WAIT", "line1", "manrope_700_22", 64, None, 240, "CLIP", ["Approve on"]),
    ("WAIT", "line2", "manrope_700_22", 88, None, 240, "CLIP", ["your Nano X"]),
    ("WAIT", "d1", "manrope_500_13", 164, None, 240, "CLIP", ["Check the amount and", "Check the address"]),
    ("WAIT", "d2", "manrope_500_13", 180, None, 240, "CLIP", ["recipient on your device.", "on your device."]),
    ("RESULT", "title", "manrope_700_26", 120, None, 240, "CLIP", ["Sent", "Not sent", "Declined", "Dismissed", "Refused"]),
    ("RESULT", "policy reason", "manrope_500_13", 158, 35, 170, "DOT2", ["Unknown agent", "Proposal has no agent", "No policy on the pendant yet", "Wrong chain for this policy", "Target is not in the policy", "Call not allowed on this target", "Value over the policy cap", "Gas limit out of range", "Proposal already expired", "Outside the policy"]),
    ("RESULT", "dismissed detail", "manrope_500_13", 158, 35, 170, "DOT2", ["Nothing was signed", "Noted, nothing to do"]),
    ("RESULT", "detail ok (mono)", "plexmono_500_15", 158, None, 240, "CLIP", ["0x529efe0b..d3ad"]),
    ("RESULT", "detail fail", "manrope_500_13", 158, 35, 170, "DOT2", ["Ledger refused", "encode failed", "no route to RPC, error 0x8001", "RPC answered HTTP 403", "insufficient funds for gas * price + value"]),
    ("BLOCKED", "line1", "manrope_700_22", 100, None, 240, "CLIP", ["looking for your", "open the Ethereum", "unlock your", "Ledger not", "no"]),
    ("BLOCKED", "line2", "manrope_700_22", 124, None, 240, "CLIP", ["Ledger", "app", "found", "ready", "wifi"]),
    ("BLOCKED", "d1", "manrope_500_13", 164, None, 240, "CLIP", ["Then open the"]),
    ("BLOCKED", "d2", "manrope_500_13", 180, None, 240, "CLIP", ["ETH app"]),
]


def wrap_lines(fnt, s, w):
    words, lines, cur = s.split(" "), [], ""
    for wd in words:
        t = (cur + " " + wd).strip()
        if width(fnt, t) <= w:
            cur = t
        else:
            if cur: lines.append(cur)
            cur = wd
    if cur: lines.append(cur)
    return lines


rows = []
for screen, name, fname, top, x, box_w, mode, strings in ITEMS:
    fnt, size = font(fname)
    lh = line_h(size)
    nlines = {"DOT2": 2, "DOT4": 4}.get(mode, 1)
    bottom = top + lh * nlines
    # Ink sits between cap height and descender: about 0.2 em below the top of the box and
    # 0.2 em above its bottom. Use that extent for the rim, not the full line box.
    ink_top, ink_bottom = top + size * 0.2, bottom - size * 0.25
    rim_w = min(chord(ink_top), chord(ink_bottom))  # narrowest chord across the ink
    for s in strings:
        w = width(fnt, s)
        verdict, note = "ok", ""
        if mode == "SCROLL":
            verdict, note = "ok", "scrolls"
        elif mode in ("DOT2", "DOT4"):
            lines = wrap_lines(fnt, s, box_w)
            widest = max(width(fnt, l) for l in lines)
            # the box is centred at x..x+box_w; the rim at the box bottom
            if len(lines) > nlines: verdict, note = "DOTS", f"{len(lines)} lines > {nlines}, ends in dots"
            if widest > rim_w: verdict, note = "CUT", f"line {widest:.0f} > rim {rim_w:.0f}"
        elif mode == "LEFT":
            right = x + w
            half = rim_w / 2
            if right > 120 + half: verdict, note = "CUT", f"right edge {right:.0f} > rim {120 + half:.0f}"
            elif w > box_w: verdict, note = "CUT", f"{w:.0f} > box {box_w}"
        else:  # CLIP, centred in box_w
            if w > box_w: verdict, note = "CUT", f"{w:.0f} > box {box_w}"
            elif w > rim_w: verdict, note = "CUT", f"{w:.0f} > rim {rim_w:.0f}"
            elif w > rim_w - 8: verdict, note = "TIGHT", f"{w:.0f} vs rim {rim_w:.0f}"
        rows.append((verdict, screen, name, fname, f"y{top}-{bottom}", f"{w:.0f}px", f"rim {rim_w:.0f}", s[:44], note))

order = {"CUT": 0, "DOTS": 1, "TIGHT": 2, "ok": 3}
for r in sorted(rows, key=lambda r: order[r[0]]):
    print(f"{r[0]:5} {r[1]:9} {r[2]:24} {r[3]:16} {r[4]:10} {r[5]:>6} {r[6]:8} | {r[7]:44} {r[8]}")
