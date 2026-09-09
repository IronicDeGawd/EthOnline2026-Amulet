# Parked — 2026-09-09

The haptic motor was descoped during hardware assembly. The transistor, diode and motor are
all bare metal, there was no heatshrink or hot glue on hand to insulate and mount them, and a
short across the 3V3 rail inside a sealed pendant is a worse outcome than having no buzz.

The attention cue is now a **backlight pulse on D6** plus the tier rendered on screen. That
needs no extra components: D6 is already routed through the display board and already driven
on PWM by `firmware/main/display/display.c`.

Nothing here is wrong or abandoned — it builds clean and the circuit notes in `README.md`
still hold. Pick it up if insulation and a mounting plan appear. `D9` (GPIO8) is still the
right pin and is still free.

## What it cost us

A buzz reaches you when you are not looking at the pendant; a flash does not. That is a real
regression in the product, not a free substitution. It does not affect the demo, where the
pendant is on camera.
