#pragma once
#include <stdbool.h>
#include <stddef.h>
typedef void (*ws_rx_cb_t)(const char *data, size_t len);
// Connects to a WSS endpoint; reconnects automatically. rx_cb is called per text frame.
void ws_start(const char *url, ws_rx_cb_t rx_cb);
bool ws_send_text(const char *text);
bool ws_is_connected(void);
// Call from the main loop: restarts the client after the brain closed the link cleanly.
void ws_tick(void);
