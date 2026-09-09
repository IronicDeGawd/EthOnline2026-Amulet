#!/usr/bin/env bash
# Regenerates every asset under firmware/main/assets/ from source.
#
#   fonts/    -> lv_font_conv (npx)         -> main/assets/<face>_<weight>_<size>.c
#   src/bg    -> LVGLImage.py RGB565        -> main/assets/bg_*.c   (240x240, dithered)
#   src/icons -> LVGLImage.py RGB565A8      -> main/assets/ic_*.c
#
# Needs: node (for lv_font_conv), the design venv (numpy, pillow, fonttools, pypng, lz4):
#   . ../../design/pendant/.venv/bin/activate
# The Manrope static weights come from the variable font via fontTools instancer; the
# instanced files are committed so this step only reruns if fonts/Manrope-*.ttf are missing.
set -euo pipefail
cd "$(dirname "$0")"
OUT=../main/assets
LVGL=../managed_components/lvgl__lvgl
mkdir -p "$OUT"

for w in 500 600 700 800; do
  [ -f "fonts/Manrope-$w.ttf" ] || python -m fontTools.varLib.instancer fonts/Manrope-VF.ttf wght=$w -o "fonts/Manrope-$w.ttf"
done

conv() { # ttf size range name
  npx --yes lv_font_conv --font "fonts/$1" --size "$2" --bpp 4 --format lvgl --no-compress \
      --lv-include lvgl.h -r "$3" -o "$OUT/$4.c"
  echo "  font $4"
}
# The size/weight set is exactly what the design uses; add a line here before using a new
# font in ui.c. U+2248 (approximately-equal) is only in the two faces that show gas cost.
conv Manrope-800.ttf 52 0x20-0x7F,0x2248 manrope_800_52
conv Manrope-800.ttf 44 0x20-0x7F        manrope_800_44
conv Manrope-800.ttf 36 0x20-0x7F        manrope_800_36
conv Manrope-700.ttf 26 0x20-0x7F        manrope_700_26
conv Manrope-700.ttf 22 0x20-0x7F        manrope_700_22
conv Manrope-700.ttf 20 0x20-0x7F        manrope_700_20
conv Manrope-700.ttf 16 0x20-0x7F        manrope_700_16
conv Manrope-700.ttf 15 0x20-0x7F        manrope_700_15
conv Manrope-700.ttf 13 0x20-0x7F        manrope_700_13
conv Manrope-600.ttf 19 0x20-0x7F        manrope_600_19
conv Manrope-600.ttf 17 0x20-0x7F        manrope_600_17
conv Manrope-600.ttf 15 0x20-0x7F        manrope_600_15
conv Manrope-500.ttf 15 0x20-0x7F,0x2248 manrope_500_15
conv Manrope-500.ttf 13 0x20-0x7F        manrope_500_13
conv Manrope-500.ttf 11 0x20-0x7F        manrope_500_11
conv IBMPlexMono-Medium.ttf 15 0x20-0x7F plexmono_500_15

python build_bitmaps.py
python "$LVGL/scripts/LVGLImage.py" --ofmt C --cf RGB565 --rgb565dither -o "$OUT" src/bg
python "$LVGL/scripts/LVGLImage.py" --ofmt C --cf RGB565A8            -o "$OUT" src/icons
# LVGLImage.py writes #include "lvgl/lvgl.h"; the IDF component exposes plain lvgl.h.
sed -i '' 's|#include "lvgl/lvgl.h"|#include "lvgl.h"|' "$OUT"/bg_*.c "$OUT"/ic_*.c
echo "assets regenerated in $OUT - run: idf.py reconfigure (the source glob is read at configure time)"
