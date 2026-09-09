#pragma once
#include <stdint.h>
#include <stdbool.h>
// LiPo on the round display's JST, sensed on A0 (GPIO1) through the board's 470k/470k divider.
// Slider 1 of the KE switch must be ON or the pin floats.
void    battery_init(void);
int     battery_mv(void);        // pack voltage in mV, averaged; <0 if the ADC is not up
int     battery_percent(int mv); // open-circuit LiPo curve, 0..100
