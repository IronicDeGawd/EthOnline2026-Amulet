# motor-test

Standalone haptic bring-up for the pendant. Separate from `firmware/` on purpose: if the motor
misbehaves here, it cannot be the display, BLE or WiFi.

Run it with the **XIAO not plugged into the round display**, powered over USB.

```
cd tools/motor-test
. ~/esp/esp-idf/export.sh
idf.py set-target esp32s3
idf.py -p /dev/cu.usbmodem101 flash monitor      # check `ls /dev/cu.usbmodem*` first
```

## Wiring under test

```
        +3V3 ──┬──────────────┐
               │              │  1N4148
            [ MOTOR ]        ─┼─  BAND (cathode) to +3V3
               │              │
               ├──────────────┘
               │  collector
             ┌─┴─┐
GPIO8 ─[1k]──┤ B │  2N2222A     (TO-92, flat face toward you: E B C)
 (D9)        └─┬─┘
               │  emitter
              GND
```

## What each step proves

| Step | Expected | If it misbehaves |
|------|----------|------------------|
| 1 — pin LOW 3 s | motor still | base pulled high, or collector/emitter swapped |
| 2 — pin HIGH 1 s | motor runs | see the failure table below |
| 3 — duty sweep 10→100% | starts somewhere around 30–50% | note the number; the real patterns build on it |
| 4 — tier patterns | three distinguishable buzzes | tune duty and durations here, then port to `firmware/main/haptic/` |

## Failure table

- **Nothing at all in step 2** — collector and emitter swapped. A reversed BJT conducts only
  weakly, so the motor barely twitches. Most common TO-92 mistake.
- **Motor won't run and something gets warm, or the board resets** — flyback diode is
  backwards. Reversed, it sits forward-biased across the motor and takes the current itself.
  Unplug immediately.
- **Motor runs and never stops** — base shorted to 3V3.
- **Transistor gets hot while running** — base resistor missing or too small.
- **Board resets when the motor starts** — motor inrush is browning out the 3V3 rail. Add a
  100 µF electrolytic across 3V3/GND near the motor.

## Notes

- `GPIO8` is `D9`, the SPI MISO line. It is free because the panel is write-only and the TF
  card is never initialised. `D2` was the original plan and is worse: it is the card's chip
  select **and** GPIO3 is an ESP32-S3 strapping pin.
- Take 3V3 from the **XIAO's 3V3 pad**, never the display's JST connector — that carries raw
  battery voltage (3.7–4.2 V), too high for a 3 V motor.
- Step 3's starting duty is the useful output of this test. Record it in
  `context/research/parts.md`.
