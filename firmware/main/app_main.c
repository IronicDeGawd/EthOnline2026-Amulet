// Amulet pendant — Day 0/1 experiment build.
// Sequence: BLE → find Ledger → GET VERSION, ECHO, GET MTU → GET PUBLIC KEY → dummy SIGN TX chunks.
// Then WiFi + WSS presence loop. Serial output only.
#include <stdio.h>
#include <string.h>
#include "esp_log.h"
#include "nvs_flash.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "wifi.h"
#include "ws.h"
#include "ble_transport.h"
#include "apdu_eth.h"
#include "secrets.h"

static const char *TAG = "amulet";
static const uint32_t ETH_PATH[5] = { 44 | BIP32_HARDEN, 60 | BIP32_HARDEN, 0 | BIP32_HARDEN, 0, 0 };

static void hexdump(const char *label, const uint8_t *b, size_t n)
{
    char line[3 * 40 + 1]; size_t k = 0;
    for (size_t i = 0; i < n && i < 40; i++) k += snprintf(line + k, sizeof line - k, "%02x", b[i]);
    ESP_LOGI(TAG, "%s (%u): %s%s", label, (unsigned)n, line, n > 40 ? "…" : "");
}

static void ledger_test(void)
{
    uint8_t out[512]; size_t n; uint16_t sw; int rc;

    rc = ledger_ble_connect(20000);
    if (rc) { ESP_LOGE(TAG, "ledger connect rc=%d", rc); return; }

    rc = ledger_ble_exchange(LEDGER_TAG_VERSION, NULL, 0, out, sizeof out, &n, 3000);
    if (rc == 0) hexdump("VERSION", out, n); else ESP_LOGE(TAG, "version rc=%d", rc);

    const uint8_t echo[] = "amulet-echo-0123456789-0123456789-0123456789";   // > 1 frame at mtu 20
    rc = ledger_ble_exchange(LEDGER_TAG_ECHO, echo, sizeof echo, out, sizeof out, &n, 3000);
    ESP_LOGI(TAG, "ECHO rc=%d match=%d", rc, rc == 0 && n == sizeof echo && memcmp(out, echo, n) == 0);

    uint8_t apdu[300]; size_t al = apdu_eth_get_address(apdu, sizeof apdu, ETH_PATH, 5, false);
    hexdump("APDU get-address", apdu, al);
    rc = ledger_apdu(apdu, al, out, sizeof out, &n, &sw, 10000);
    if (rc) { ESP_LOGE(TAG, "get-address rc=%d", rc); return; }
    ESP_LOGI(TAG, "get-address sw=%04x", sw);
    if (sw == 0x9000) {
        uint8_t pk[65]; char addr[43];
        if (apdu_eth_parse_address(out, n, pk, addr) == 0) ESP_LOGI(TAG, "LEDGER ADDRESS %s", addr);
        else ESP_LOGE(TAG, "parse-address failed");
    }

    // Dummy 300-byte "RLP" to exercise two SIGN TX chunks (fake device returns canned sig).
    uint8_t rlp[300]; for (int i = 0; i < 300; i++) rlp[i] = i;
    size_t off = 0; bool first = true;
    while (1) {
        al = apdu_eth_sign_chunk(apdu, sizeof apdu, ETH_PATH, 5, rlp, sizeof rlp, &off, first);
        if (!al) break;
        rc = ledger_apdu(apdu, al, out, sizeof out, &n, &sw, 30000);
        ESP_LOGI(TAG, "sign chunk first=%d len=%u rc=%d sw=%04x resp=%u", first, (unsigned)al, rc, sw, (unsigned)n);
        if (rc) break;
        first = false;
        if (off >= sizeof rlp) {
            uint8_t v, r[32], s2[32];
            if (apdu_eth_parse_sig(out, n, &v, r, s2) == 0) { ESP_LOGI(TAG, "SIG v=%u", v); hexdump("r", r, 32); hexdump("s", s2, 32); }
            break;
        }
    }
    ledger_ble_disconnect();
}

static void on_ws_rx(const char *data, size_t len) { ESP_LOGI(TAG, "ws rx (%u): %.*s", (unsigned)len, (int)len, data); }

void app_main(void)
{
    esp_err_t r = nvs_flash_init();
    if (r == ESP_ERR_NVS_NO_FREE_PAGES || r == ESP_ERR_NVS_NEW_VERSION_FOUND) { ESP_ERROR_CHECK(nvs_flash_erase()); r = nvs_flash_init(); }
    ESP_ERROR_CHECK(r);
    ESP_LOGI(TAG, "amulet day-1 build, free heap %lu", (unsigned long)esp_get_free_heap_size());

    ledger_ble_init();
    ledger_test();

    if (!wifi_connect(AMULET_WIFI_SSID, AMULET_WIFI_PASS)) ESP_LOGE(TAG, "wifi failed");
    else ws_start(AMULET_WSS_URL, on_ws_rx);

    uint32_t n = 0;
    while (1) {
        vTaskDelay(pdMS_TO_TICKS(5000));
        if (ws_is_connected()) {
            char msg[96];
            snprintf(msg, sizeof msg, "{\"type\":\"presence\",\"uptime\":%lu,\"n\":%lu}", (unsigned long)(xTaskGetTickCount() / configTICK_RATE_HZ), (unsigned long)n++);
            ws_send_text(msg);
        }
    }
}
