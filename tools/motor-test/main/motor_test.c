// Standalone haptic-driver test for the Amulet pendant.
//
// Confirms two things the main firmware cannot separate:
//   1. that D9 on the XIAO really is GPIO8, and
//   2. that the 2N2222A + flyback-diode circuit switches the motor.
//
// Run this with the XIAO NOT plugged into the round display, powered over USB.
// Nothing here touches BLE, WiFi or the panel, so a failure can only be the pin or the circuit.
//
// Wiring (see context/research/parts.md):
//   GPIO8 --[1k]--> base        motor between +3V3 and collector
//   emitter --> GND             1N4148 across the motor, BAND (cathode) to +3V3
//
// Build:  cd tools/motor-test && idf.py set-target esp32s3 && idf.py -p <port> flash monitor

#include <stdio.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "driver/gpio.h"
#include "driver/ledc.h"
#include "esp_log.h"

static const char *TAG = "motor-test";

#define MOTOR_GPIO   8      // D9 on the XIAO ESP32-S3
#define PWM_FREQ_HZ  2000   // above the audible whine of a slow PWM, below ERM response limits

static void pwm_init(void)
{
    ledc_timer_config_t timer = {
        .speed_mode      = LEDC_LOW_SPEED_MODE,
        .duty_resolution = LEDC_TIMER_8_BIT,
        .timer_num       = LEDC_TIMER_0,
        .freq_hz         = PWM_FREQ_HZ,
        .clk_cfg         = LEDC_AUTO_CLK,
    };
    ESP_ERROR_CHECK(ledc_timer_config(&timer));

    ledc_channel_config_t ch = {
        .gpio_num   = MOTOR_GPIO,
        .speed_mode = LEDC_LOW_SPEED_MODE,
        .channel    = LEDC_CHANNEL_0,
        .timer_sel  = LEDC_TIMER_0,
        .duty       = 0,
        .hpoint     = 0,
    };
    ESP_ERROR_CHECK(ledc_channel_config(&ch));
}

// percent 0..100
static void motor(uint8_t percent)
{
    if (percent > 100) percent = 100;
    ESP_ERROR_CHECK(ledc_set_duty(LEDC_LOW_SPEED_MODE, LEDC_CHANNEL_0, (255 * percent) / 100));
    ESP_ERROR_CHECK(ledc_update_duty(LEDC_LOW_SPEED_MODE, LEDC_CHANNEL_0));
}

static void buzz(uint8_t percent, int ms)
{
    motor(percent);
    vTaskDelay(pdMS_TO_TICKS(ms));
    motor(0);
}

void app_main(void)
{
    ESP_LOGI(TAG, "motor test on GPIO%d (D9). Nothing should be moving yet.", MOTOR_GPIO);

    // Step 1: hold the pin low for 3 s. If the motor runs during this window the circuit is
    // wrong -- most likely the base is pulled high, or collector and emitter are swapped.
    gpio_config_t off = {
        .pin_bit_mask = 1ULL << MOTOR_GPIO,
        .mode = GPIO_MODE_OUTPUT,
        .pull_up_en = GPIO_PULLUP_DISABLE,
        .pull_down_en = GPIO_PULLDOWN_DISABLE,
        .intr_type = GPIO_INTR_DISABLE,
    };
    ESP_ERROR_CHECK(gpio_config(&off));
    gpio_set_level(MOTOR_GPIO, 0);
    ESP_LOGW(TAG, "STEP 1: pin driven LOW for 3s -- motor MUST stay still");
    vTaskDelay(pdMS_TO_TICKS(3000));

    // Step 2: full on, DC, no PWM. Proves the transistor saturates and the motor is alive.
    ESP_LOGW(TAG, "STEP 2: pin driven HIGH for 1s -- motor MUST run");
    gpio_set_level(MOTOR_GPIO, 1);
    vTaskDelay(pdMS_TO_TICKS(1000));
    gpio_set_level(MOTOR_GPIO, 0);
    vTaskDelay(pdMS_TO_TICKS(1000));

    // Step 3: PWM strength sweep. Finds the duty cycle at which this motor actually starts,
    // which is what the real per-tier patterns need to be built on.
    pwm_init();
    ESP_LOGW(TAG, "STEP 3: sweeping 10%% -> 100%%, watch for where it starts to move");
    for (int p = 10; p <= 100; p += 10) {
        ESP_LOGI(TAG, "  duty %d%%", p);
        motor(p);
        vTaskDelay(pdMS_TO_TICKS(700));
    }
    motor(0);
    vTaskDelay(pdMS_TO_TICKS(1000));

    // Step 4: the three patterns the PRD calls for, so you can feel them apart on the chest.
    ESP_LOGW(TAG, "STEP 4: tier patterns, repeating. Ctrl-] to quit.");
    while (1) {
        ESP_LOGI(TAG, "tier 0 -- single short (advisory)");
        buzz(70, 120);
        vTaskDelay(pdMS_TO_TICKS(2500));

        ESP_LOGI(TAG, "tier 1 -- double tap (small, pre-approved)");
        buzz(85, 110); vTaskDelay(pdMS_TO_TICKS(120)); buzz(85, 110);
        vTaskDelay(pdMS_TO_TICKS(2500));

        ESP_LOGI(TAG, "tier 2 -- long triple (needs your Ledger)");
        for (int i = 0; i < 3; i++) { buzz(100, 300); vTaskDelay(pdMS_TO_TICKS(150)); }
        vTaskDelay(pdMS_TO_TICKS(3000));
    }
}
