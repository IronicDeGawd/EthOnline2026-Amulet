#pragma once
// Pendant screens. Every call is a no-op when the panel is absent (display_ready() false),
// so the Ledger signing path runs unchanged on a headless board.
#include <stdbool.h>
#include <stdint.h>
#include "proposal.h"

typedef enum {
    UI_HOME,          // idle: identity + readiness
    UI_PROPOSAL,      // a proposal awaiting your slide
    UI_LEDGER_WAIT,   // streamed to the Nano X, waiting for the button
    UI_RESULT,        // broadcast outcome
    UI_BLOCKED,       // cannot proceed, with a reason
} ui_state_t;

// Readiness shown on HOME and used to gate the slider on a tier-2 proposal.
typedef struct {
    bool wifi;
    bool brain;       // websocket connected to the agent
    bool ledger;      // BLE connected AND Ethereum app answering
    uint64_t nonce;
} ui_status_t;

void ui_init(void);                       // builds the screens; call after display_init()
void ui_set_status(const ui_status_t *s); // refreshes the readiness row wherever it shows
void ui_show_home(void);
void ui_show_proposal(const amulet_proposal_t *p);
void ui_show_ledger_wait(const char *what);   // e.g. "Confirm on your Nano X"
void ui_show_result(bool ok, const char *detail);  // tx hash, or the failure reason
void ui_show_blocked(const char *reason);          // "Brain offline", "Unlock your Ledger", ...
ui_state_t ui_state(void);

// True once for each completed slide, then cleared. Polled by the main flow so the UI never
// calls into BLE or RPC from an LVGL callback.
bool ui_take_confirm(void);
// True once if you dismissed the proposal.
bool ui_take_reject(void);

// Attention cue: replaces the descoped haptic. Pulses the backlight `times` times.
void ui_attention(uint8_t times);
