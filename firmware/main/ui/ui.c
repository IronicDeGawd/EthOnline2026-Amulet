// Pendant screens, built to context/design/pendant-screens-ref.png. Positions are the design's
// pixel values; backgrounds are pre-rendered bitmaps (assets/) and only type, pills, the arc
// and the spinner are live LVGL objects.
#include "ui.h"
#include "display.h"
#include "assets.h"
#include <string.h>
#include <stdio.h>
#include <ctype.h>
#include <inttypes.h>
#include "esp_log.h"
#include "esp_lvgl_port.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

static const char *TAG = "ui";

#define C_TEXT   0xf4f7fb
#define C_MUTED  0x9aa7b8
#define C_BLUE   0x4f8ef7

static ui_state_t s_state = UI_HOME;
static bool s_confirm, s_reject, s_armed;
static ui_status_t s_status;

static lv_obj_t *s_scr[7];

// HOME
static lv_obj_t *s_home_line1, *s_home_line2, *s_home_date, *s_home_time;
// PROPOSAL (tier 1/2) and ADVISORY (tier 0) share one screen; the objects for the mode not in
// use are hidden. The band under the type is part of the background image.
static lv_obj_t *s_p_bg, *s_p_plane, *s_p_verb, *s_p_amount, *s_p_unit, *s_p_pill, *s_p_pill_text;
static lv_obj_t *s_p_btn, *s_p_arrow, *s_p_hold;                 // confirm row
static lv_obj_t *s_p_lock, *s_p_lock1, *s_p_lock2;              // locked row
static lv_obj_t *s_p_arc, *s_p_signing;                         // holding
static lv_obj_t *s_a_badge, *s_a_i, *s_a_label, *s_a_amount, *s_a_unit, *s_a_detail;  // advisory
static lv_obj_t *s_p_touch;
// LEDGER WAIT / RESULT / BLOCKED
static lv_obj_t *s_w_line2;
static lv_obj_t *s_r_bg, *s_r_title, *s_r_detail;
static lv_obj_t *s_b_line1, *s_b_line2, *s_b_d1, *s_b_d2;
// IDLE: the reactor. Rings are arcs on the core-glow bitmap; each carries its base angle in
// user_data and one animation per ring group sweeps the rotation.
#define OUTER_N 8
#define INNER_N 12
static lv_obj_t *s_outer[OUTER_N], *s_inner[INNER_N], *s_bloom;
// swipe sibling of HOME
static lv_obj_t *s_w_d1, *s_w_d2;

// ---- helpers -----------------------------------------------------------------------------

static lv_obj_t *screen(const lv_image_dsc_t *bg, lv_obj_t **bg_out)
{
    lv_obj_t *s = lv_obj_create(NULL);
    lv_obj_set_style_bg_color(s, lv_color_black(), LV_PART_MAIN);
    lv_obj_set_style_bg_opa(s, LV_OPA_COVER, LV_PART_MAIN);
    lv_obj_set_style_pad_all(s, 0, LV_PART_MAIN);
    lv_obj_set_style_border_width(s, 0, LV_PART_MAIN);
    lv_obj_clear_flag(s, LV_OBJ_FLAG_SCROLLABLE);
    lv_obj_t *img = lv_image_create(s);
    lv_image_set_src(img, bg);
    lv_obj_set_pos(img, 0, 0);
    if (bg_out) *bg_out = img;
    return s;
}

// A label occupying the full width, text centred, at a given top. Matches the design's
// "top:Npx; width:240; text-align:center" convention exactly.
static lv_obj_t *text(lv_obj_t *parent, const lv_font_t *font, uint32_t colour, int top, const char *str)
{
    lv_obj_t *l = lv_label_create(parent);
    lv_obj_set_width(l, 240);
    lv_obj_set_style_text_align(l, LV_TEXT_ALIGN_CENTER, LV_PART_MAIN);
    lv_obj_set_style_text_font(l, font, LV_PART_MAIN);
    lv_obj_set_style_text_color(l, lv_color_hex(colour), LV_PART_MAIN);
    lv_label_set_long_mode(l, LV_LABEL_LONG_CLIP);
    lv_label_set_text(l, str);
    lv_obj_set_pos(l, 0, top);
    return l;
}

static lv_obj_t *image(lv_obj_t *parent, const lv_image_dsc_t *src, int x, int y)
{
    lv_obj_t *i = lv_image_create(parent);
    lv_image_set_src(i, src);
    lv_obj_set_pos(i, x, y);
    return i;
}

static lv_obj_t *disc(lv_obj_t *parent, int x, int y, int d, uint32_t colour, lv_opa_t opa)
{
    lv_obj_t *o = lv_obj_create(parent);
    lv_obj_remove_style_all(o);
    lv_obj_set_size(o, d, d);
    lv_obj_set_pos(o, x, y);
    lv_obj_set_style_radius(o, LV_RADIUS_CIRCLE, LV_PART_MAIN);
    lv_obj_set_style_bg_color(o, lv_color_hex(colour), LV_PART_MAIN);
    lv_obj_set_style_bg_opa(o, opa, LV_PART_MAIN);
    return o;
}

static void swipe(lv_event_t *e);
static void show(lv_obj_t *o, bool on) { if (on) lv_obj_clear_flag(o, LV_OBJ_FLAG_HIDDEN); else lv_obj_add_flag(o, LV_OBJ_FLAG_HIDDEN); }

// ---- hold to sign ------------------------------------------------------------------------
// A 1.2 s hold anywhere on the proposal screen. On press the band gives way to the rim arc
// and "Signing..." (the design's Holding frame); release before the end springs back.
#define HOLD_MS       1200
#define HOLD_GRACE_MS 300
static uint32_t s_shown_at, s_press_at;
static bool s_press_counts;

static void holding_view(bool on)
{
    lv_image_set_src(s_p_bg, on ? &bg_base : (s_armed ? &bg_proposal : &bg_locked));
    show(s_p_arc, on); show(s_p_signing, on);
    show(s_p_btn, !on && s_armed); show(s_p_arrow, !on && s_armed); show(s_p_hold, !on && s_armed);
    show(s_p_lock, !on && !s_armed); show(s_p_lock1, !on && !s_armed); show(s_p_lock2, !on && !s_armed);
}

static void hold_event(lv_event_t *e)
{
    lv_event_code_t code = lv_event_get_code(e);
    uint32_t now = lv_tick_get();
    if (code == LV_EVENT_PRESSED) {
        s_press_counts = s_armed && (now - s_shown_at) > HOLD_GRACE_MS;
        s_press_at = now;
        if (s_press_counts) { lv_arc_set_value(s_p_arc, 0); holding_view(true); }
        return;
    }
    if (code == LV_EVENT_PRESSING && s_press_counts) {
        uint32_t held = now - s_press_at;
        lv_arc_set_value(s_p_arc, held >= HOLD_MS ? 100 : (int)(held * 100 / HOLD_MS));
        if (held >= HOLD_MS) { s_press_counts = false; s_confirm = true; ESP_LOGI(TAG, "hold confirmed"); }
        return;
    }
    if (code == LV_EVENT_RELEASED || code == LV_EVENT_PRESS_LOST) {
        if (s_press_counts) holding_view(false);
        s_press_counts = false;
    }
}

// ---- screens -----------------------------------------------------------------------------

static void build_home(void)
{
    lv_obj_t *s = s_scr[UI_HOME] = screen(&bg_home, NULL);
    lv_obj_add_event_cb(s, swipe, LV_EVENT_GESTURE, NULL);
    s_home_line1 = text(s, &manrope_700_20, C_TEXT,  98,  "Watching");
    s_home_line2 = text(s, &manrope_500_13, C_MUTED, 122, "Ready for proposals");
    s_home_date  = text(s, &manrope_600_15, C_MUTED, 150, "");
    s_home_time  = text(s, &manrope_800_36, C_TEXT,  166, "");
}

static void build_proposal(void)
{
    lv_obj_t *s = s_scr[UI_PROPOSAL] = screen(&bg_proposal, &s_p_bg);

    // tier 1/2 stack
    s_p_plane  = image(s, &ic_plane, 106, 18);
    s_p_verb   = text(s, &manrope_600_19, C_TEXT, 46,  "");
    s_p_amount = text(s, &manrope_800_52, C_TEXT, 64,  "");
    s_p_unit   = text(s, &manrope_700_16, C_TEXT, 122, "");
    s_p_pill = lv_obj_create(s);
    lv_obj_remove_style_all(s_p_pill);
    lv_obj_set_size(s_p_pill, 124, 24);
    lv_obj_set_pos(s_p_pill, 58, 146);
    lv_obj_set_style_radius(s_p_pill, 12, LV_PART_MAIN);
    lv_obj_set_style_bg_color(s_p_pill, lv_color_white(), LV_PART_MAIN);
    lv_obj_set_style_bg_opa(s_p_pill, 33, LV_PART_MAIN);             // 13%
    s_p_pill_text = lv_label_create(s_p_pill);
    lv_obj_set_style_text_font(s_p_pill_text, &manrope_700_13, LV_PART_MAIN);
    lv_obj_set_style_text_color(s_p_pill_text, lv_color_hex(C_TEXT), LV_PART_MAIN);
    lv_obj_center(s_p_pill_text);

    // confirm row (armed)
    s_p_btn   = disc(s, 64, 194, 26, C_BLUE, LV_OPA_COVER);
    s_p_arrow = image(s, &ic_arrow, 69, 199);
    s_p_hold  = lv_label_create(s);
    lv_obj_set_style_text_font(s_p_hold, &manrope_700_15, LV_PART_MAIN);
    lv_obj_set_style_text_color(s_p_hold, lv_color_hex(C_TEXT), LV_PART_MAIN);
    lv_label_set_text(s_p_hold, "Hold to sign");
    lv_obj_set_pos(s_p_hold, 96, 198);

    // locked row
    s_p_lock  = image(s, &ic_lock, 112, 184);
    s_p_lock1 = text(s, &manrope_700_13, C_TEXT,  201, "Unlock your Ledger");
    s_p_lock2 = text(s, &manrope_500_11, C_MUTED, 216, "Open ETH app");

    // holding
    s_p_arc = lv_arc_create(s);
    lv_obj_set_size(s_p_arc, 232, 232);
    lv_obj_center(s_p_arc);
    lv_arc_set_rotation(s_p_arc, 270);
    lv_arc_set_bg_angles(s_p_arc, 0, 360);
    lv_arc_set_range(s_p_arc, 0, 100);
    lv_arc_set_value(s_p_arc, 0);
    lv_obj_remove_style(s_p_arc, NULL, LV_PART_KNOB);
    lv_obj_clear_flag(s_p_arc, LV_OBJ_FLAG_CLICKABLE);
    lv_obj_set_style_arc_width(s_p_arc, 8, LV_PART_MAIN);
    lv_obj_set_style_arc_width(s_p_arc, 8, LV_PART_INDICATOR);
    lv_obj_set_style_arc_color(s_p_arc, lv_color_hex(0x1a2334), LV_PART_MAIN);
    lv_obj_set_style_arc_color(s_p_arc, lv_color_hex(C_BLUE), LV_PART_INDICATOR);
    lv_obj_set_style_arc_rounded(s_p_arc, true, LV_PART_INDICATOR);
    s_p_signing = text(s, &manrope_600_15, C_MUTED, 194, "Signing...");

    // advisory (tier 0) stack
    s_a_badge = disc(s, 102, 24, 36, C_BLUE, LV_OPA_COVER);
    s_a_i = lv_label_create(s_a_badge);
    lv_obj_set_style_text_font(s_a_i, &manrope_700_20, LV_PART_MAIN);
    lv_obj_set_style_text_color(s_a_i, lv_color_hex(C_TEXT), LV_PART_MAIN);
    lv_label_set_text(s_a_i, "i");
    lv_obj_center(s_a_i);
    s_a_label  = text(s, &manrope_600_17, C_TEXT,  72,  "");
    s_a_amount = text(s, &manrope_800_44, C_TEXT,  92,  "");
    s_a_unit   = text(s, &manrope_700_16, C_TEXT,  144, "");
    s_a_detail = text(s, &manrope_500_15, C_MUTED, 168, "");

    // the whole disc listens for the hold
    s_p_touch = lv_obj_create(s);
    lv_obj_remove_style_all(s_p_touch);
    lv_obj_set_size(s_p_touch, 240, 240);
    lv_obj_set_pos(s_p_touch, 0, 0);
    lv_obj_add_flag(s_p_touch, LV_OBJ_FLAG_CLICKABLE);
    lv_obj_add_event_cb(s_p_touch, hold_event, LV_EVENT_ALL, NULL);
}

static void build_wait(void)
{
    lv_obj_t *s = s_scr[UI_LEDGER_WAIT] = screen(&bg_base, NULL);
    image(s, &ic_ledger, 106, 28);
    text(s, &manrope_700_22, C_TEXT, 64, "Approve on");
    s_w_line2 = text(s, &manrope_700_22, C_TEXT, 88, "your Nano X");
    lv_obj_t *sp = lv_spinner_create(s);
    lv_spinner_set_anim_params(sp, 1100, 260);
    lv_obj_set_size(sp, 32, 32);
    lv_obj_set_pos(sp, 104, 122);
    lv_obj_set_style_arc_width(sp, 4, LV_PART_MAIN);
    lv_obj_set_style_arc_width(sp, 4, LV_PART_INDICATOR);
    lv_obj_set_style_arc_color(sp, lv_color_hex(0x232d3f), LV_PART_MAIN);
    lv_obj_set_style_arc_color(sp, lv_color_hex(C_BLUE), LV_PART_INDICATOR);
    s_w_d1 = text(s, &manrope_500_13, C_MUTED, 164, "Check the amount and");
    s_w_d2 = text(s, &manrope_500_13, C_MUTED, 180, "recipient on your device.");
}

static void build_result(void)
{
    lv_obj_t *s = s_scr[UI_RESULT] = screen(&bg_sent, &s_r_bg);
    s_r_title  = text(s, &manrope_700_26, C_TEXT, 120, "Sent");
    s_r_detail = text(s, &plexmono_500_15, C_MUTED, 158, "");
}

static void build_blocked(void)
{
    lv_obj_t *s = s_scr[UI_BLOCKED] = screen(&bg_blocked, NULL);
    s_b_line1 = text(s, &manrope_700_22, C_TEXT, 100, "Unlock your");
    s_b_line2 = text(s, &manrope_700_22, C_TEXT, 124, "Ledger");
    s_b_d1    = text(s, &manrope_500_13, C_MUTED, 164, "Then open the");
    s_b_d2    = text(s, &manrope_500_13, C_MUTED, 180, "ETH app");
}

// ---- reactor (idle) ----------------------------------------------------------------------
// An original glowing core with two counter-rotating segmented rings and a slow pulse. All
// live LVGL: no GIF, no SD card, no flash beyond the one core bitmap. If a custom loop is
// ever wanted, /sdcard/idle.gif can replace this screen; see context/plan/pendant-ui.md.

static lv_obj_t *segment_arc(lv_obj_t *parent, int diameter, int span_deg, int base_deg,
                             int width, uint32_t colour, lv_opa_t opa)
{
    lv_obj_t *a = lv_arc_create(parent);
    lv_obj_set_size(a, diameter, diameter);
    lv_obj_center(a);
    lv_arc_set_bg_angles(a, 0, span_deg);
    lv_arc_set_rotation(a, base_deg);
    lv_obj_remove_style(a, NULL, LV_PART_KNOB);
    lv_obj_clear_flag(a, LV_OBJ_FLAG_CLICKABLE);
    lv_obj_set_style_arc_width(a, width, LV_PART_MAIN);
    lv_obj_set_style_arc_color(a, lv_color_hex(colour), LV_PART_MAIN);
    lv_obj_set_style_arc_opa(a, opa, LV_PART_MAIN);
    lv_obj_set_style_arc_rounded(a, true, LV_PART_MAIN);
    lv_obj_set_style_arc_opa(a, LV_OPA_TRANSP, LV_PART_INDICATOR);
    lv_obj_set_user_data(a, (void *)(intptr_t)base_deg);
    return a;
}

static void spin_outer(void *v, int32_t t) { (void)v; for (int i = 0; i < OUTER_N; i++) lv_arc_set_rotation(s_outer[i], ((int)(intptr_t)lv_obj_get_user_data(s_outer[i]) + t) % 360); }
static void spin_inner(void *v, int32_t t) { (void)v; for (int i = 0; i < INNER_N; i++) lv_arc_set_rotation(s_inner[i], ((int)(intptr_t)lv_obj_get_user_data(s_inner[i]) + 360 - t) % 360); }
static void pulse(void *v, int32_t o) { (void)v; lv_obj_set_style_bg_opa(s_bloom, (lv_opa_t)o, LV_PART_MAIN); }

static void idle_wake(lv_event_t *e)
{
    if (lv_event_get_code(e) != LV_EVENT_PRESSED) return;
    display_backlight(100);
    lv_screen_load(s_scr[UI_HOME]);
    s_state = UI_HOME;
}

static void build_idle(void)
{
    lv_obj_t *s = s_scr[UI_IDLE] = screen(&bg_reactor, NULL);

    // outer ring: 8 segments of 30 degrees on a 45-degree pitch, slow clockwise
    for (int i = 0; i < OUTER_N; i++)
        s_outer[i] = segment_arc(s, 204, 30, 270 + i * 45, 6, C_BLUE, LV_OPA_90);
    // inner ring: 12 short ticks, faster, counter-clockwise, lighter
    for (int i = 0; i < INNER_N; i++)
        s_inner[i] = segment_arc(s, 160, 12, 270 + i * 30, 4, 0x9cc2ff, LV_OPA_60);
    // the core breathes: a white disc over the baked glow, opacity 0 -> 70 and back
    s_bloom = disc(s, 120 - 30, 120 - 30, 60, 0xffffff, LV_OPA_TRANSP);

    lv_anim_t a;
    lv_anim_init(&a); lv_anim_set_var(&a, s); lv_anim_set_exec_cb(&a, spin_outer);
    lv_anim_set_values(&a, 0, 360); lv_anim_set_duration(&a, 12000); lv_anim_set_repeat_count(&a, LV_ANIM_REPEAT_INFINITE);
    lv_anim_start(&a);
    lv_anim_init(&a); lv_anim_set_var(&a, s); lv_anim_set_exec_cb(&a, spin_inner);
    lv_anim_set_values(&a, 0, 360); lv_anim_set_duration(&a, 7000); lv_anim_set_repeat_count(&a, LV_ANIM_REPEAT_INFINITE);
    lv_anim_start(&a);
    lv_anim_init(&a); lv_anim_set_var(&a, s_bloom); lv_anim_set_exec_cb(&a, pulse);
    lv_anim_set_values(&a, 0, 70); lv_anim_set_duration(&a, 1600); lv_anim_set_playback_duration(&a, 1600);
    lv_anim_set_repeat_count(&a, LV_ANIM_REPEAT_INFINITE); lv_anim_set_path_cb(&a, lv_anim_path_ease_in_out);
    lv_anim_start(&a);

    lv_obj_t *touch = lv_obj_create(s);
    lv_obj_remove_style_all(touch);
    lv_obj_set_size(touch, 240, 240);
    lv_obj_set_pos(touch, 0, 0);
    lv_obj_add_flag(touch, LV_OBJ_FLAG_CLICKABLE);
    lv_obj_add_event_cb(touch, idle_wake, LV_EVENT_PRESSED, NULL);
}

// ---- swipe sibling ------------------------------------------------------------------------
// Smartwatch-style: HOME in the middle, a photo to the left. Swipe left to see it, right to
// come back. A proposal always jumps straight in regardless.

static void load_dir(ui_state_t st, lv_screen_load_anim_t anim)
{
    lv_screen_load_anim(s_scr[st], anim, 220, 0, false);
    s_state = st;
}

static void swipe(lv_event_t *e)
{
    (void)e;
    lv_dir_t dir = lv_indev_get_gesture_dir(lv_indev_active());
    lv_indev_wait_release(lv_indev_active());       // the swipe must not also count as a tap
    if (s_state == UI_HOME  && dir == LV_DIR_LEFT)  load_dir(UI_PHOTO, LV_SCR_LOAD_ANIM_MOVE_LEFT);
    if (s_state == UI_PHOTO && dir == LV_DIR_RIGHT) load_dir(UI_HOME,  LV_SCR_LOAD_ANIM_MOVE_RIGHT);
}

static void build_photo(void)
{
    lv_obj_t *s = s_scr[UI_PHOTO] = screen(&bg_photo, NULL);
    lv_obj_add_event_cb(s, swipe, LV_EVENT_GESTURE, NULL);
}

void ui_init(void)
{
    if (!display_ready()) { ESP_LOGW(TAG, "no panel - UI disabled, signing runs headless"); return; }
    if (!lvgl_port_lock(0)) return;
    build_home(); build_proposal(); build_wait(); build_result(); build_blocked(); build_idle();
    build_photo();
    lv_screen_load(s_scr[UI_HOME]);
    s_state = UI_HOME;
    lvgl_port_unlock();
    ESP_LOGI(TAG, "screens built");
}

static void go(ui_state_t st)
{
    if (!display_ready() || !s_scr[st]) { s_state = st; return; }
    if (!lvgl_port_lock(0)) return;
    lv_screen_load(s_scr[st]);
    s_state = st;
    lvgl_port_unlock();
}

ui_state_t ui_state(void) { return s_state; }

void ui_set_status(const ui_status_t *s)
{
    s_status = *s;
    if (!display_ready() || !s_home_line1) return;
    if (!lvgl_port_lock(0)) return;
    // Say what the wearer can act on, not what the system is doing.
    if (!s->wifi)        { lv_label_set_text(s_home_line1, "No wifi");     lv_label_set_text(s_home_line2, "Waiting for the network"); }
    else if (!s->ledger) { lv_label_set_text(s_home_line1, "Not ready");   lv_label_set_text(s_home_line2, "Unlock your Ledger"); }
    else if (!s->brain)  { lv_label_set_text(s_home_line1, "Watching");    lv_label_set_text(s_home_line2, "Waiting for the agent"); }
    else                 { lv_label_set_text(s_home_line1, "Watching");    lv_label_set_text(s_home_line2, "Ready for proposals"); }
    lvgl_port_unlock();
}

void ui_set_clock(const char *date, const char *time)
{
    if (!display_ready() || !s_home_time) return;
    if (!lvgl_port_lock(0)) return;
    lv_label_set_text(s_home_date, date ? date : "");
    lv_label_set_text(s_home_time, time ? time : "");
    lvgl_port_unlock();
}

void ui_show_home(void) { go(UI_HOME); }

// "Repay 120 USDC" -> verb "Repay", amount "120", unit "USDC". Anything that does not split
// that way is shown whole on the amount line at a smaller size.
static bool split_human(const char *h, char *verb, size_t vc, char *amount, size_t ac, char *unit, size_t uc)
{
    char buf[PROP_TEXT_LEN]; snprintf(buf, sizeof buf, "%s", h);
    char *save = NULL;
    char *w1 = strtok_r(buf, " ", &save); char *w2 = strtok_r(NULL, " ", &save); char *rest = strtok_r(NULL, "", &save);
    if (!w1 || !w2 || !isdigit((unsigned char)w2[0])) return false;
    snprintf(verb, vc, "%s", w1); snprintf(amount, ac, "%s", w2); snprintf(unit, uc, "%s", rest ? rest : "");
    return true;
}

void ui_show_proposal(const amulet_proposal_t *p)
{
    if (!display_ready() || !s_scr[UI_PROPOSAL]) { s_state = UI_PROPOSAL; return; }
    if (!lvgl_port_lock(0)) return;

    bool advisory = (p->tier == 0);
    char verb[24], amount[24], unit[40];
    bool split = split_human(p->human, verb, sizeof verb, amount, sizeof amount, unit, sizeof unit);

    // tier 1/2
    show(s_p_plane, !advisory); show(s_p_verb, !advisory); show(s_p_amount, !advisory); show(s_p_unit, !advisory); show(s_p_pill, !advisory);
    // tier 0
    show(s_a_badge, advisory); show(s_a_label, advisory); show(s_a_amount, advisory); show(s_a_unit, advisory); show(s_a_detail, advisory);

    if (advisory) {
        lv_image_set_src(s_p_bg, &bg_base);
        lv_label_set_text(s_a_label,  split ? verb : "");
        lv_label_set_text(s_a_amount, split ? amount : p->human);
        lv_obj_set_style_text_font(s_a_amount, split ? &manrope_800_44 : &manrope_700_22, LV_PART_MAIN);
        lv_label_set_text(s_a_unit,   split ? unit : "");
        lv_label_set_text(s_a_detail, p->rationale[0] ? p->rationale : "Nothing to sign");
        show(s_p_btn, false); show(s_p_arrow, false); show(s_p_hold, false);
        show(s_p_lock, false); show(s_p_lock1, false); show(s_p_lock2, false);
        show(s_p_arc, false); show(s_p_signing, false);
        s_armed = false;
    } else {
        lv_label_set_text(s_p_verb,   split ? verb : "");
        lv_label_set_text(s_p_amount, split ? amount : p->human);
        lv_obj_set_style_text_font(s_p_amount, split ? &manrope_800_52 : &manrope_700_22, LV_PART_MAIN);
        lv_label_set_text(s_p_unit,   split ? unit : "");
        char pill[24]; snprintf(pill, sizeof pill, "%.20s", p->rationale);
        lv_label_set_text(s_p_pill_text, pill);
        // A tier-2 proposal needs the Ledger answering before the hold does anything.
        s_armed = (p->tier < 2) || s_status.ledger;
        holding_view(false);
    }

    s_press_counts = false;
    s_shown_at = lv_tick_get();
    s_confirm = s_reject = false;
    display_backlight(100);
    lv_screen_load(s_scr[UI_PROPOSAL]);
    s_state = UI_PROPOSAL;
    lvgl_port_unlock();
}

void ui_show_ledger_wait(const char *what)
{
    // Default is the signing copy; Receive passes "Check the address".
    if (display_ready() && s_w_d1 && lvgl_port_lock(0)) {
        bool addr = what && strstr(what, "address");
        lv_label_set_text(s_w_d1, addr ? "Check the address" : "Check the amount and");
        lv_label_set_text(s_w_d2, addr ? "on your device." : "recipient on your device.");
        lvgl_port_unlock();
    }
    go(UI_LEDGER_WAIT);
}

void ui_show_result(bool ok, const char *detail)
{
    if (display_ready() && s_r_title && lvgl_port_lock(0)) {
        lv_image_set_src(s_r_bg, ok ? &bg_sent : &bg_notsent);
        lv_label_set_text(s_r_title, ok ? "Sent" : "Not sent");
        lv_obj_set_style_text_font(s_r_detail, ok ? &plexmono_500_15 : &manrope_500_15, LV_PART_MAIN);
        lv_label_set_text(s_r_detail, detail ? detail : "");
        lvgl_port_unlock();
    }
    go(UI_RESULT);
}

void ui_show_blocked(const char *reason)
{
    if (display_ready() && s_b_line1 && lvgl_port_lock(0)) {
        // Two lines for the instruction, split at the last space so "Ledger" sits alone as
        // in the design; the follow-on step goes below.
        char a[32] = "", b[32] = "";
        const char *r = reason ? reason : "";
        const char *sp = strrchr(r, ' ');
        if (sp && sp != r) { snprintf(a, sizeof a, "%.*s", (int)(sp - r), r); snprintf(b, sizeof b, "%s", sp + 1); }
        else snprintf(a, sizeof a, "%s", r);
        lv_label_set_text(s_b_line1, a);
        lv_label_set_text(s_b_line2, b);
        bool ledger = strstr(r, "Ledger") != NULL;
        lv_label_set_text(s_b_d1, ledger ? "Then open the" : "");
        lv_label_set_text(s_b_d2, ledger ? "ETH app" : "");
        lvgl_port_unlock();
    }
    go(UI_BLOCKED);
}

void ui_show_idle(void)
{
    if (!display_ready()) return;
    display_backlight(50);
    go(UI_IDLE);
}

uint32_t ui_inactive_ms(void)
{
    if (!display_ready()) return 0;
    if (!lvgl_port_lock(0)) return 0;
    uint32_t ms = lv_display_get_inactive_time(NULL);
    lvgl_port_unlock();
    return ms;
}

bool ui_is_resting(void) { return s_state == UI_HOME || s_state == UI_PHOTO; }

bool ui_take_confirm(void) { bool c = s_confirm; s_confirm = false; return c; }
bool ui_take_reject(void)  { bool r = s_reject;  s_reject  = false; return r; }

void ui_attention(uint8_t times)
{
    if (!display_ready()) return;
    for (uint8_t i = 0; i < times; i++) {
        display_backlight(12);  vTaskDelay(pdMS_TO_TICKS(90));
        display_backlight(100); vTaskDelay(pdMS_TO_TICKS(140));
    }
}
