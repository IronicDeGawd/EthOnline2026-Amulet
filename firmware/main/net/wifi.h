#pragma once
#include <stdbool.h>
// Blocks until connected (or gives up after retries). Returns true on success.
bool wifi_connect(const char *ssid, const char *pass);
