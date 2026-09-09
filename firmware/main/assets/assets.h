#pragma once
// Generated assets. Fonts: firmware/assets/fonts via lv_font_conv (see assets/build.sh).
// Images: firmware/assets/build_bitmaps.py -> LVGLImage.py. Names match the file names.
#include "lvgl.h"

// Manrope, one file per weight/size. The number after the weight is the pixel size.
LV_FONT_DECLARE(manrope_800_52);
LV_FONT_DECLARE(manrope_800_44);
LV_FONT_DECLARE(manrope_800_36);
LV_FONT_DECLARE(manrope_700_26);
LV_FONT_DECLARE(manrope_700_22);
LV_FONT_DECLARE(manrope_700_20);
LV_FONT_DECLARE(manrope_700_16);
LV_FONT_DECLARE(manrope_700_15);
LV_FONT_DECLARE(manrope_700_13);
LV_FONT_DECLARE(manrope_600_19);
LV_FONT_DECLARE(manrope_600_17);
LV_FONT_DECLARE(manrope_600_15);
LV_FONT_DECLARE(manrope_500_15);
LV_FONT_DECLARE(manrope_500_13);
LV_FONT_DECLARE(manrope_500_11);
LV_FONT_DECLARE(plexmono_500_15);

// Full-screen 240x240 RGB565 backgrounds. Anything static in the design (the orb, the lit
// band, the outcome badges) is baked in here so the firmware only lays type on top.
LV_IMAGE_DECLARE(bg_base);
LV_IMAGE_DECLARE(bg_home);
LV_IMAGE_DECLARE(bg_proposal);
LV_IMAGE_DECLARE(bg_locked);
LV_IMAGE_DECLARE(bg_sent);
LV_IMAGE_DECLARE(bg_notsent);
LV_IMAGE_DECLARE(bg_blocked);

// Stroke icons, RGB565A8.
LV_IMAGE_DECLARE(ic_plane);
LV_IMAGE_DECLARE(ic_arrow);
LV_IMAGE_DECLARE(ic_lock);
LV_IMAGE_DECLARE(ic_ledger);
