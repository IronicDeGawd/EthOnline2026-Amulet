// Amulet pendant — Day 0 experiment build.
// Proves: WiFi join, WSS echo round-trip, NimBLE central scan. Serial output only.
#include <stdio.h>
#include <string.h>
#include "esp_log.h"
#include "nvs_flash.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "wifi.h"
#include "ws.h"
#include "ble_scan.h"
#include "secrets.h"

static const char *TAG = "amulet";

static void on_ws_rx(const char *data, size_t len)
{
    ESP_LOGI(TAG, "ws rx (%u): %.*s", (unsigned)len, (int)len, data);
}

void app_main(void)
{
    esp_err_t r = nvs_flash_init();
    if (r == ESP_ERR_NVS_NO_FREE_PAGES || r == ESP_ERR_NVS_NEW_VERSION_FOUND) {
        ESP_ERROR_CHECK(nvs_flash_erase());
        r = nvs_flash_init();
    }
    ESP_ERROR_CHECK(r);
    ESP_LOGI(TAG, "amulet day-0 build, free heap %lu", (unsigned long)esp_get_free_heap_size());

    ble_scan_start();

    if (!wifi_connect(AMULET_WIFI_SSID, AMULET_WIFI_PASS)) {
        ESP_LOGE(TAG, "wifi failed; continuing with BLE only");
    } else {
        ws_start(AMULET_WSS_URL, on_ws_rx);
    }

    uint32_t n = 0;
    while (1) {
        vTaskDelay(pdMS_TO_TICKS(5000));
        if (ws_is_connected()) {
            char msg[96];
            snprintf(msg, sizeof(msg), "{\"type\":\"presence\",\"uptime\":%lu,\"n\":%lu}",
                     (unsigned long)(xTaskGetTickCount() / configTICK_RATE_HZ), (unsigned long)n++);
            ws_send_text(msg);
        }
    }
}
