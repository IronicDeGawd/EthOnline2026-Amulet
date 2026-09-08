#include "rpc.h"
#include <string.h>
#include <stdio.h>
#include "esp_log.h"
#include "esp_http_client.h"
#include "esp_crt_bundle.h"
#include "cJSON.h"
#include "tx.h"

static const char *TAG = "rpc";
static const char *s_url;
static int s_id = 1;

void rpc_init(const char *url) { s_url = url; }

// Returns malloc'd "result" as string (hex) or NULL; err_out gets error.message if any.
static char *call(const char *method, const char *params_json, char *err_out, size_t err_cap)
{
    size_t bcap = strlen(params_json) + 128;
    char *body = malloc(bcap); if (!body) return NULL;
    int n = snprintf(body, bcap, "{\"jsonrpc\":\"2.0\",\"id\":%d,\"method\":\"%s\",\"params\":%s}", s_id++, method, params_json);
    if (n <= 0 || n >= (int)bcap) { free(body); return NULL; }
    esp_http_client_config_t cfg = { .url = s_url, .method = HTTP_METHOD_POST, .crt_bundle_attach = esp_crt_bundle_attach, .timeout_ms = 15000 };
    esp_http_client_handle_t c = esp_http_client_init(&cfg);
    esp_http_client_set_header(c, "Content-Type", "application/json");
    char *resp = NULL;
    if (esp_http_client_open(c, n) != ESP_OK) { ESP_LOGE(TAG, "open failed"); goto out; }
    esp_http_client_write(c, body, n);
    int cl = esp_http_client_fetch_headers(c);
    int cap = (cl > 0 && cl < 65536) ? cl + 1 : 16384;
    resp = malloc(cap);
    int total = 0, r;
    while ((r = esp_http_client_read(c, resp + total, cap - 1 - total)) > 0) { total += r; if (total >= cap - 1) break; }
    resp[total] = 0;
    ESP_LOGD(TAG, "%s -> %d bytes", method, total);
out:
    esp_http_client_cleanup(c);
    free(body);
    if (!resp) return NULL;
    cJSON *j = cJSON_Parse(resp); free(resp);
    if (!j) return NULL;
    char *ret = NULL;
    cJSON *e = cJSON_GetObjectItem(j, "error");
    if (e) {
        cJSON *m = cJSON_GetObjectItem(e, "message");
        if (err_out) snprintf(err_out, err_cap, "%s", m && cJSON_IsString(m) ? m->valuestring : "rpc error");
        ESP_LOGE(TAG, "%s error: %s", method, err_out ? err_out : "?");
    } else {
        cJSON *res = cJSON_GetObjectItem(j, "result");
        if (res && cJSON_IsString(res)) ret = strdup(res->valuestring);
    }
    cJSON_Delete(j);
    return ret;
}

bool rpc_get_nonce(const char *addr_hex, uint64_t *nonce)
{
    char p[96]; snprintf(p, sizeof p, "[\"%s\",\"pending\"]", addr_hex);
    char *r = call("eth_getTransactionCount", p, NULL, 0); if (!r) return false;
    uint8_t be[32]; bool ok = hex_to_bytes(r, be, 32); free(r); if (!ok) return false;
    *nonce = 0; for (int i = 24; i < 32; i++) *nonce = (*nonce << 8) | be[i];
    return true;
}

bool rpc_gas_price(uint8_t out[32])
{
    char *r = call("eth_gasPrice", "[]", NULL, 0); if (!r) return false;
    bool ok = hex_to_bytes(r, out, 32); free(r); return ok;
}

bool rpc_balance(const char *addr_hex, uint8_t out[32])
{
    char p[96]; snprintf(p, sizeof p, "[\"%s\",\"latest\"]", addr_hex);
    char *r = call("eth_getBalance", p, NULL, 0); if (!r) return false;
    bool ok = hex_to_bytes(r, out, 32); free(r); return ok;
}

bool rpc_send_raw(const uint8_t *raw, size_t len, char tx_hash_out[67], char err_out[128])
{
    char *hex = malloc(2 * len + 8); if (!hex) return false;
    hex[0] = '['; hex[1] = '"'; hex[2] = '0'; hex[3] = 'x';
    bytes_to_hex(raw, len, hex + 4);
    strcat(hex, "\"]");
    err_out[0] = 0;
    char *r = call("eth_sendRawTransaction", hex, err_out, 128); free(hex);
    if (!r) return false;
    snprintf(tx_hash_out, 67, "%s", r); free(r);
    return true;
}
