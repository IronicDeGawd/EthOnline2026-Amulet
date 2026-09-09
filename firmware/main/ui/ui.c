#include "ui.h"
#include "display.h"
#include <string.h>
#include <stdio.h>
#include <inttypes.h>
#include "esp_log.h"
#include "esp_lvgl_port.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

static const char *TAG = "ui";

// --- palette, lifted from the project page so hardware and web agree ---
#define C_INK      0x14181c    // near-black ground
#define C_PAPER    0xe9ecee    // cool grey text
#define C_GOLD     0xb8901f    // pad gold: identity, and the tier-2 accent
#define C_MUTED    0x6b7680    // secondary text
#define C_OK       0x2f9e44
#define C_WARN     0xd0342c

// The panel is a circle. At 240px across, a horizontal band at the vertical centre can use
// the full width, but anything near the top or bottom must be inset or it is simply cut off.
#define SAFE_W_MID   224
#define SAFE_W_EDGE  150

static ui_state_t s_state = UI_HOME;
static bool s_confirm, s_reject;
static ui_status_t s_status;
static bool s_slider_armed;

static lv_obj_t *s_scr[5];      // one screen object per ui_state_t
static lv_obj_t *s_home_ready, *s_home_nonce;
static lv_obj_t *s_p_tier, *s_p_human, *s_p_value, *s_p_target, *s_p_why, *s_p_slider, *s_p_hint;
static lv_obj_t *s_wait_text, *s_result_icon, *s_result_text, *s_blocked_text;

static lv_obj_t *label(lv_obj_t *parent, const lv_font_t *font, uint32_t colour,
                       lv_align_t align, int dx, int dy, int width, const char *text)
{
    lv_obj_t *l = lv_label_create(parent);
    lv_label_set_text(l, text);
    lv_obj_set_style_text_font(l, font, LV_PART_MAIN);
    lv_obj_set_style_text_color(l, lv_color_hex(colour), LV_PART_MAIN);
    lv_obj_set_style_text_align(l, LV_TEXT_ALIGN_CENTER, LV_PART_MAIN);
    if (width > 0) {
        lv_obj_set_width(l, width);
        lv_label_set_long_mode(l, LV_LABEL_LONG_WRAP);
    }
    lv_obj_align(l, align, dx, dy);
    return l;
}

static lv_obj_t *new_screen(void)
{
    lv_obj_t *s = lv_obj_create(NULL);
    lv_obj_set_style_bg_color(s, lv_color_hex(C_INK), LV_PART_MAIN);
    lv_obj_set_style_bg_opa(s, LV_OPA_COVER, LV_PART_MAIN);
    lv_obj_set_style_border_width(s, 0, LV_PART_MAIN);
    lv_obj_set_style_pad_all(s, 0, LV_PART_MAIN);
    lv_obj_clear_flag(s, LV_OBJ_FLAG_SCROLLABLE);   // a round screen must never scroll
    return s;
}

// --- hold to confirm ------------------------------------------------------------------
// A long press rather than a slide, and rather than a tap. A tap is unsafe: the CHSC6X
// reports the centroid of two fingers, so a stray two-finger brush lands a press mid-screen
// and would fire a tap instantly. A sustained hold cannot come from a brush.
//
// The whole screen is the target, and progress fills a ring around the rim — on a circular
// panel that is the natural gesture language, and it gives the whole 240px disc as a target
// instead of a 170px track.
//
// The one weakness a slide did not have: pressure can hold a press (the pendant resting
// against your chest). Two answers. The press must BEGIN after the proposal appears, so a
// press inherited from before the screen loaded is ignored. And the Ledger button remains
// the real gate, so a false positive can only stream the transaction to the device.
#define HOLD_MS       1200      // long enough to be deliberate, short enough not to annoy
#define HOLD_GRACE_MS 300       // presses starting within this of the screen appearing don't count

static lv_obj_t *s_ring, *s_hold_area;
static uint32_t s_shown_at, s_press_at;
static bool s_press_counts;

static void hold_event(lv_event_t *e)
{
    lv_event_code_t code = lv_event_get_code(e);
    uint32_t now = lv_tick_get();

    if (code == LV_EVENT_PRESSED) {
        // Reject a press that began before this screen was really in front of you.
        s_press_counts = s_slider_armed && (now - s_shown_at) > HOLD_GRACE_MS;
        s_press_at = now;
        return;
    }

    if (code == LV_EVENT_PRESSING && s_press_counts) {
        uint32_t held = now - s_press_at;
        int pct = (int)((held * 100) / HOLD_MS);
        if (pct > 100) pct = 100;
        lv_arc_set_value(s_ring, pct);
        if (held >= HOLD_MS) {
            s_press_counts = false;
            s_confirm = true;
            ESP_LOGI(TAG, "hold confirmed");
        }
        return;
    }

    if (code == LV_EVENT_RELEASED || code == LV_EVENT_PRESS_LOST) {
        s_press_counts = false;
        lv_arc_set_value(s_ring, 0);
    }
}

static void build_home(void)
{
    lv_obj_t *s = s_scr[UI_HOME] = new_screen();
    label(s, &lv_font_montserrat_28, C_GOLD, LV_ALIGN_CENTER, 0, -34, 0, "AMULET");
    s_home_ready = label(s, &lv_font_montserrat_20, C_MUTED, LV_ALIGN_CENTER, 0, 6, SAFE_W_MID, "starting");
    s_home_nonce = label(s, &lv_font_montserrat_20, C_MUTED, LV_ALIGN_CENTER, 0, 44, SAFE_W_EDGE, "");
}

static void build_proposal(void)
{
    lv_obj_t *s = s_scr[UI_PROPOSAL] = new_screen();

    // The ring lives on the rim, where a round panel has room to spare and nothing else
    // wants to be. It doubles as the progress indicator and the affordance.
    s_ring = lv_arc_create(s);
    lv_obj_set_size(s_ring, 236, 236);
    lv_obj_center(s_ring);
    lv_arc_set_rotation(s_ring, 270);            // grows from the top
    lv_arc_set_bg_angles(s_ring, 0, 360);
    lv_arc_set_range(s_ring, 0, 100);
    lv_arc_set_value(s_ring, 0);
    lv_obj_remove_style(s_ring, NULL, LV_PART_KNOB);
    lv_obj_clear_flag(s_ring, LV_OBJ_FLAG_CLICKABLE);   // it displays; the area below listens
    lv_obj_set_style_arc_width(s_ring, 8, LV_PART_MAIN);
    lv_obj_set_style_arc_width(s_ring, 8, LV_PART_INDICATOR);
    lv_obj_set_style_arc_color(s_ring, lv_color_hex(0x232a31), LV_PART_MAIN);
    lv_obj_set_style_arc_color(s_ring, lv_color_hex(C_GOLD), LV_PART_INDICATOR);

    // Text: three elements. The address is deliberately absent — the Ledger shows the exact
    // value and recipient, which is the whole security claim. Repeating a *shortened* address
    // here would only train you to accept a truncated one, which is how address-substitution
    // attacks work. The pendant answers "what decision is this"; the Ledger answers "what
    // exactly will be signed".
    s_p_tier  = label(s, &lv_font_montserrat_20, C_GOLD,  LV_ALIGN_TOP_MID, 0, 38, SAFE_W_EDGE, "TIER 2");
    s_p_human = label(s, &lv_font_montserrat_28, C_PAPER, LV_ALIGN_CENTER,  0, -12, 188, "");
    s_p_why   = label(s, &lv_font_montserrat_20, C_MUTED, LV_ALIGN_CENTER,  0, 34,  192, "");
    s_p_hint  = label(s, &lv_font_montserrat_20, C_MUTED, LV_ALIGN_BOTTOM_MID, 0, -34, SAFE_W_EDGE, "hold to sign");

    // A transparent listener over the whole disc. Placed last so it is on top of the labels.
    s_hold_area = lv_obj_create(s);
    lv_obj_remove_style_all(s_hold_area);
    lv_obj_set_size(s_hold_area, 240, 240);
    lv_obj_center(s_hold_area);
    lv_obj_add_flag(s_hold_area, LV_OBJ_FLAG_CLICKABLE);
    lv_obj_add_event_cb(s_hold_area, hold_event, LV_EVENT_ALL, NULL);

    s_p_slider = NULL; s_p_value = NULL; s_p_target = NULL;
}

static void build_wait(void)
{
    lv_obj_t *s = s_scr[UI_LEDGER_WAIT] = new_screen();
    label(s, &lv_font_montserrat_20, C_GOLD, LV_ALIGN_CENTER, 0, -46, SAFE_W_MID, "SIGNING");
    s_wait_text = label(s, &lv_font_montserrat_20, C_PAPER, LV_ALIGN_CENTER, 0, 4, SAFE_W_MID,
                        "Confirm on your Nano X");
    lv_obj_t *sp = lv_spinner_create(s);
    lv_obj_set_size(sp, 44, 44);
    lv_obj_align(sp, LV_ALIGN_CENTER, 0, 60);
    lv_obj_set_style_arc_color(sp, lv_color_hex(C_GOLD), LV_PART_INDICATOR);
}

static void build_result(void)
{
    lv_obj_t *s = s_scr[UI_RESULT] = new_screen();
    s_result_icon = label(s, &lv_font_montserrat_28, C_OK, LV_ALIGN_CENTER, 0, -40, SAFE_W_MID, "SENT");
    s_result_text = label(s, &lv_font_montserrat_20, C_PAPER, LV_ALIGN_CENTER, 0, 10, SAFE_W_MID, "");
}

static void build_blocked(void)
{
    lv_obj_t *s = s_scr[UI_BLOCKED] = new_screen();
    label(s, &lv_font_montserrat_20, C_WARN, LV_ALIGN_CENTER, 0, -42, SAFE_W_MID, "NOT READY");
    s_blocked_text = label(s, &lv_font_montserrat_20, C_PAPER, LV_ALIGN_CENTER, 0, 6, SAFE_W_MID, "");
}

void ui_init(void)
{
    if (!display_ready()) { ESP_LOGW(TAG, "no panel — UI disabled, signing runs headless"); return; }
    if (!lvgl_port_lock(0)) return;
    build_home(); build_proposal(); build_wait(); build_result(); build_blocked();
    lv_screen_load(s_scr[UI_HOME]);
    s_state = UI_HOME;
    lvgl_port_unlock();
    ESP_LOGI(TAG, "screens built");
}

static void go(ui_state_t st)
{
    if (!display_ready() || !s_scr[st]) return;
    if (!lvgl_port_lock(0)) return;
    lv_screen_load(s_scr[st]);
    s_state = st;
    lvgl_port_unlock();
}

ui_state_t ui_state(void) { return s_state; }

void ui_set_status(const ui_status_t *s)
{
    s_status = *s;
    if (!display_ready() || !s_home_ready) return;
    if (!lvgl_port_lock(0)) return;
    // Name what is missing, not a row of cryptic dots. On a 32mm screen, words win.
    if (!s->wifi)        lv_label_set_text(s_home_ready, "no wifi");
    else if (!s->ledger) lv_label_set_text(s_home_ready, "unlock your Ledger");
    else if (!s->brain)  lv_label_set_text(s_home_ready, "waiting for agent");
    else                 lv_label_set_text(s_home_ready, "watching");
    lv_obj_set_style_text_color(s_home_ready,
        lv_color_hex(s->wifi && s->brain && s->ledger ? C_OK : C_MUTED), LV_PART_MAIN);
    if (s->nonce) lv_label_set_text_fmt(s_home_nonce, "nonce %" PRIu64, s->nonce);
    lvgl_port_unlock();
}

void ui_show_home(void) { go(UI_HOME); }

void ui_show_proposal(const amulet_proposal_t *p)
{
    if (!display_ready() || !s_scr[UI_PROPOSAL]) { s_state = UI_PROPOSAL; return; }
    if (!lvgl_port_lock(0)) return;

    lv_label_set_text_fmt(s_p_tier, "TIER %u", p->tier);
    lv_obj_set_style_text_color(s_p_tier, lv_color_hex(p->tier == 2 ? C_GOLD : C_MUTED), LV_PART_MAIN);

    // `human` is the brain's own one-line summary and already carries the amount
    // ("Repay 120 USDC"). For a bare transfer there is no such summary, so fall back to the
    // formatted value, which is then the only number that matters.
    if (p->human[0]) {
        lv_label_set_text(s_p_human, p->human);
    } else {
        char v[32];
        proposal_format_value(p->value, v, sizeof v);
        lv_label_set_text(s_p_human, v);
    }
    lv_label_set_text(s_p_why, p->rationale);

    // Tier 2 needs the Ledger present before you can slide, so you never slide into a dead
    // end and then get told to go and find your Ledger.
    // Tier 2 needs the Ledger present before the hold does anything, so you never hold for a
    // second and a half only to be told to go and find your Ledger.
    s_slider_armed = (p->tier < 2) || s_status.ledger;
    lv_label_set_text(s_p_hint, s_slider_armed ? "hold to sign" : "unlock your Ledger");
    lv_obj_set_style_text_color(s_p_hint,
        lv_color_hex(s_slider_armed ? C_MUTED : C_WARN), LV_PART_MAIN);
    lv_arc_set_value(s_ring, 0);
    s_press_counts = false;
    s_shown_at = lv_tick_get();
    s_confirm = s_reject = false;

    lv_screen_load(s_scr[UI_PROPOSAL]);
    s_state = UI_PROPOSAL;
    lvgl_port_unlock();
}

void ui_show_ledger_wait(const char *what)
{
    if (display_ready() && s_wait_text && lvgl_port_lock(0)) {
        lv_label_set_text(s_wait_text, what ? what : "Confirm on your Nano X");
        lvgl_port_unlock();
    }
    go(UI_LEDGER_WAIT);
}

void ui_show_result(bool ok, const char *detail)
{
    if (display_ready() && s_result_icon && lvgl_port_lock(0)) {
        lv_label_set_text(s_result_icon, ok ? "SENT" : "FAILED");
        lv_obj_set_style_text_color(s_result_icon, lv_color_hex(ok ? C_OK : C_WARN), LV_PART_MAIN);
        lv_label_set_text(s_result_text, detail ? detail : "");
        lvgl_port_unlock();
    }
    go(UI_RESULT);
}

void ui_show_blocked(const char *reason)
{
    if (display_ready() && s_blocked_text && lvgl_port_lock(0)) {
        lv_label_set_text(s_blocked_text, reason ? reason : "");
        lvgl_port_unlock();
    }
    go(UI_BLOCKED);
}

bool ui_take_confirm(void) { bool c = s_confirm; s_confirm = false; return c; }
bool ui_take_reject(void)  { bool r = s_reject;  s_reject  = false; return r; }

void ui_attention(uint8_t times)
{
    // Stands in for the descoped haptic. Dim rather than dark: going fully black reads as a
    // crash, whereas a dip reads as "look at me".
    if (!display_ready()) return;
    for (uint8_t i = 0; i < times; i++) {
        display_backlight(12);
        vTaskDelay(pdMS_TO_TICKS(90));
        display_backlight(100);
        vTaskDelay(pdMS_TO_TICKS(140));
    }
}
