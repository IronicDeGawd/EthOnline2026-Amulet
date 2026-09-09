#pragma once
#include <stdbool.h>
#include "esp_err.h"

// Brings up the Seeed Round Display for XIAO: GC9A01 240x240 over SPI, CST816S touch over I2C,
// LVGL 9 via esp_lvgl_port. Safe to call once, after NVS init.
esp_err_t display_init(void);
// Backlight duty, 0..100. Requires the v1.1 KE switch to be enabling D6.
void display_backlight(uint8_t percent);
// True once display_init() has succeeded; the signing flow runs headless if it has not.
bool display_ready(void);
