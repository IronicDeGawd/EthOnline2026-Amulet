#include "ws.h"
#include <string.h>
#include "esp_log.h"
#include "esp_websocket_client.h"
#include "esp_crt_bundle.h"

static const char *TAG = "ws";
static esp_websocket_client_handle_t s_client;
static ws_rx_cb_t s_rx;
static volatile bool s_connected;

static void on_event(void *arg, esp_event_base_t base, int32_t id, void *data)
{
    esp_websocket_event_data_t *e = (esp_websocket_event_data_t *)data;
    switch (id) {
    case WEBSOCKET_EVENT_CONNECTED:
        s_connected = true;
        ESP_LOGI(TAG, "connected");
        break;
    case WEBSOCKET_EVENT_DISCONNECTED:
    case WEBSOCKET_EVENT_CLOSED:
        s_connected = false;
        ESP_LOGW(TAG, "disconnected");
        break;
    case WEBSOCKET_EVENT_DATA:
        if (e->op_code == 0x01 && e->data_len > 0 && s_rx) {   // text frame
            s_rx(e->data_ptr, e->data_len);
        }
        break;
    case WEBSOCKET_EVENT_ERROR:
        ESP_LOGE(TAG, "error");
        break;
    default:
        break;
    }
}

void ws_start(const char *url, ws_rx_cb_t rx_cb)
{
    s_rx = rx_cb;
    esp_websocket_client_config_t cfg = {
        .uri = url,
        .crt_bundle_attach = esp_crt_bundle_attach,
        .reconnect_timeout_ms = 3000,
        .network_timeout_ms = 10000,
        .buffer_size = 4096,
    };
    s_client = esp_websocket_client_init(&cfg);
    esp_websocket_register_events(s_client, WEBSOCKET_EVENT_ANY, on_event, NULL);
    ESP_ERROR_CHECK(esp_websocket_client_start(s_client));
}

bool ws_send_text(const char *text)
{
    if (!s_client || !s_connected) return false;
    int n = esp_websocket_client_send_text(s_client, text, strlen(text), pdMS_TO_TICKS(2000));
    return n >= 0;
}

bool ws_is_connected(void) { return s_connected; }
