#pragma once
// Pendant screens. Every call is a no-op when the panel is absent (display_ready() false),
// so the Ledger signing path runs unchanged on a headless board.
#include <stdbool.h>
#include <stdint.h>
#include "proposal.h"
#include "policy.h"

typedef enum {
    UI_HOME,          // idle: identity + readiness
    UI_PROPOSAL,      // a proposal awaiting your slide
    UI_LEDGER_WAIT,   // streamed to the Nano X, waiting for the button
    UI_RESULT,        // broadcast outcome
    UI_BLOCKED,       // cannot proceed, with a reason
    UI_IDLE,          // reactor face after 30 s at rest; any touch wakes
    UI_PHOTO,         // swipe left from HOME; swipe right returns
    UI_PAIRING,       // first-time Ledger pairing: compare the code, hold to accept
    UI_LEDGER,        // swipe right from HOME: pair / paired / removed
    UI_OPTIONS,       // a yield card: up to three venues, tap one, swipe to dismiss
    UI_AGENT,         // who is asking: the agent's face and name, tap to see what they want
    UI_SWAP,          // swipe up from HOME: pick a pair and ask the agent to find a route
} ui_state_t;

typedef enum { UI_PAIR_NONE, UI_PAIR_PAIRED, UI_PAIR_REMOVED } ui_pair_t;

// Readiness shown on HOME and used to gate the slider on a tier-2 proposal.
typedef struct {
    bool wifi;
    bool brain;       // websocket connected to the agent
    bool ledger;      // BLE connected AND Ethereum app answering
    bool policy_stale; // no ENS policy read for a day (or never): HOME says so
    uint64_t nonce;
} ui_status_t;

void ui_init(void);                       // builds the screens; call after display_init()
void ui_set_status(const ui_status_t *s); // refreshes the readiness row wherever it shows
void ui_set_clock(const char *date, const char *time);
void ui_set_battery(int percent);                  // small glyph on HOME; <0 hides it // "Tue 16", "10:24" on HOME; NULL hides
void ui_show_home(void);
void ui_show_proposal(const amulet_proposal_t *p);
void ui_show_ledger_wait(const char *what);   // e.g. "Confirm on your Nano X"
void ui_show_result(bool ok, const char *detail);  // tx hash, or the failure reason
void ui_show_dismissed(bool advisory);
void ui_show_policy_reject(const char *reason);   // the pendant refused it before the Ledger saw it
// Whose proposal is coming: the agent's face replaces the icon at the top of the proposal
// screen, so you see who is asking before you read what they want. NULL restores the default.
void ui_set_agent(const agent_t *a);
// Who is asking, before what they are asking for: the agent's face large, its ENS name under
// it, and a tap to go on to the request. A swipe here dismisses without ever showing the
// amount, which is the point — you decide about the agent first.
void ui_show_agent(const agent_t *a);
bool ui_take_tap(void);   // true once per tap on the agent screen
void ui_show_options(const amulet_options_t *o);  // yield card: tap a row to pick, swipe to dismiss
bool ui_take_pick(int *idx);                       // true once per tapped row
// The one screen the wearer starts something from. Two pills choose the pair, the third asks
// the agent to go and find a route; whatever comes back is an ordinary proposal and is checked
// like one. Asking is not approving.
void ui_show_swap(void);
bool ui_take_swap(char *from, size_t from_cap, char *to, size_t to_cap);  // true once per Go
void ui_swap_waiting(const char *note);            // "Asking the agent...", or a refusal

void ui_show_picked(const char *venue);            // "Picked · Spark WETH", the agent is building the proposal             // after a swipe: "Declined" / "Dismissed"
void ui_show_blocked(const char *reason);          // "Brain offline", "Unlock your Ledger", ...
void ui_show_idle(void);                           // the reactor; backlight to half
void ui_show_pairing(uint32_t code);               // 6-digit numeric comparison; hold = accept, swipe = refuse
void ui_set_pairing(ui_pair_t st, const char *addr, const char *note);  // LEDGER screen; note overrides the detail line
void ui_show_ledger(void);
bool ui_is_resting(void);                          // HOME or its swipe sibling
uint32_t ui_inactive_ms(void);                     // ms since the wearer last touched the panel
ui_state_t ui_state(void);

// True once for each completed slide, then cleared. Polled by the main flow so the UI never
// calls into BLE or RPC from an LVGL callback.
bool ui_take_confirm(void);
// True once if you dismissed the proposal.
bool ui_take_reject(void);

// Attention cue: replaces the descoped haptic. Pulses the backlight `times` times.
void ui_attention(uint8_t times);
