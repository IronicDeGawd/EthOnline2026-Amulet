#include "rpc.h"
#include <string.h>
#include <stdio.h>
#include "esp_log.h"
#include "esp_http_client.h"
#include "esp_heap_caps.h"
#include "esp_crt_bundle.h"
#include "cJSON.h"
#include "tx.h"

static const char *TAG = "rpc";
static const char *s_url;
static int s_id = 1;

void rpc_init(const char *url) { s_url = url; }

// One HTTP POST of a JSON body; returns the raw answer (caller frees) or NULL. Shared by the
// single-call and batch paths so there is one place that knows about TLS, timeouts and sizes.
static char *post_json(const char *body, size_t len, char *err_out, size_t err_cap, const char *what)
{
    esp_http_client_config_t cfg = { .url = s_url, .method = HTTP_METHOD_POST, .crt_bundle_attach = esp_crt_bundle_attach, .timeout_ms = 20000 };
    esp_http_client_handle_t c = esp_http_client_init(&cfg);
    esp_http_client_set_header(c, "Content-Type", "application/json");
    char *resp = NULL;
    // Every failure names itself: a blank reason on a 32 mm screen cannot be debugged.
    esp_err_t oe = esp_http_client_open(c, (int)len);
    if (oe != ESP_OK) {
        ESP_LOGE(TAG, "%s: open failed: %s (free heap %u, internal %u)", what, esp_err_to_name(oe),
                 (unsigned)esp_get_free_heap_size(), (unsigned)heap_caps_get_free_size(MALLOC_CAP_INTERNAL));
        // The full ESP name is one unbreakable word wider than the screen; the log has it.
        if (err_out) snprintf(err_out, err_cap, "no route to RPC, error 0x%x", (unsigned)oe);
        goto out;
    }
    // A short body goes out in one write; a batch does not. esp_http_client_write returns
    // what it managed, and a server left waiting for the rest of a request simply times out.
    for (size_t sent = 0; sent < len; ) {
        int wrote = esp_http_client_write(c, body + sent, (int)(len - sent));
        if (wrote <= 0) {
            ESP_LOGE(TAG, "%s: sent %u of %u bytes", what, (unsigned)sent, (unsigned)len);
            if (err_out) snprintf(err_out, err_cap, "could not send the request");
            goto out;
        }
        sent += (size_t)wrote;
    }
    int cl = esp_http_client_fetch_headers(c);
    int status = esp_http_client_get_status_code(c);
    int cap = (cl > 0 && cl < 65536) ? cl + 1 : 16384;
    resp = malloc(cap);
    if (!resp) goto out;
    int total = 0, r;
    while ((r = esp_http_client_read(c, resp + total, cap - 1 - total)) > 0) { total += r; if (total >= cap - 1) break; }
    resp[total] = 0;
    if (status != 200) {
        ESP_LOGE(TAG, "%s: HTTP %d: %.120s", what, status, resp);
        if (err_out) snprintf(err_out, err_cap, "RPC answered HTTP %d", status);
        free(resp);
        resp = NULL;
    }
out:
    esp_http_client_cleanup(c);
    return resp;
}

// Returns the detached "result" node (caller cJSON_Delete's it) or NULL; err_out gets error.message if any.
static cJSON *call_json(const char *method, const char *params_json, char *err_out, size_t err_cap)
{
    size_t bcap = strlen(params_json) + 128;
    char *body = malloc(bcap); if (!body) return NULL;
    int n = snprintf(body, bcap, "{\"jsonrpc\":\"2.0\",\"id\":%d,\"method\":\"%s\",\"params\":%s}", s_id++, method, params_json);
    if (n <= 0 || n >= (int)bcap) { free(body); return NULL; }
    char *resp = post_json(body, (size_t)n, err_out, err_cap, method);
    free(body);
    if (!resp) return NULL;
    cJSON *j = cJSON_Parse(resp);
    if (!j) {
        ESP_LOGE(TAG, "%s: answer is not JSON: %.120s", method, resp);
        if (err_out) snprintf(err_out, err_cap, "RPC answer was not JSON");
        free(resp);
        return NULL;
    }
    free(resp);
    cJSON *ret = NULL;
    cJSON *e = cJSON_GetObjectItem(j, "error");
    if (e) {
        cJSON *m = cJSON_GetObjectItem(e, "message");
        if (err_out) snprintf(err_out, err_cap, "%s", m && cJSON_IsString(m) ? m->valuestring : "rpc error");
        ESP_LOGE(TAG, "%s error: %s", method, err_out ? err_out : "?");
    } else {
        ret = cJSON_DetachItemFromObject(j, "result");
    }
    cJSON_Delete(j);
    return ret;
}

// Convenience wrapper for the many methods whose result is a plain hex string.
static char *call(const char *method, const char *params_json, char *err_out, size_t err_cap)
{
    cJSON *r = call_json(method, params_json, err_out, err_cap);
    if (!r) return NULL;
    char *ret = cJSON_IsString(r) ? strdup(r->valuestring) : NULL;
    cJSON_Delete(r);
    return ret;
}

// eth_call against `to_hex` with `data_hex` (both 0x-prefixed). The hex result lands in
// `out` (0x-prefixed, NUL-terminated); false if the node errored or it did not fit.
bool rpc_eth_call(const char *to_hex, const char *data_hex, char *out, size_t out_cap)
{
    size_t pcap = strlen(data_hex) + 96;
    char *p = malloc(pcap); if (!p) return false;
    snprintf(p, pcap, "[{\"to\":\"%s\",\"data\":\"%s\"},\"latest\"]", to_hex, data_hex);
    char err[64];
    char *r = call("eth_call", p, err, sizeof err);
    free(p);
    if (!r) return false;
    bool ok = strlen(r) < out_cap;
    if (ok) strcpy(out, r);
    else ESP_LOGW(TAG, "eth_call result %u bytes does not fit %u", (unsigned)strlen(r), (unsigned)out_cap);
    free(r);
    return ok;
}

// Several eth_calls in one HTTP request. Twelve separate round trips to a public endpoint
// time out; one batch does not. Results come back in `out[i]`, matched by id, and a call
// that failed leaves its slot empty rather than shifting the others.
bool rpc_eth_call_batch(const char *to_hex, const char **data_hex, int n, char **out, size_t out_cap)
{
    if (n <= 0 || n > 16) return false;
    size_t bcap = 256;
    for (int i = 0; i < n; i++) bcap += strlen(data_hex[i]) + 160;
    char *body = malloc(bcap);
    if (!body) return false;
    int w = snprintf(body, bcap, "[");
    for (int i = 0; i < n; i++) {
        w += snprintf(body + w, bcap - (size_t)w,
                      "%s{\"jsonrpc\":\"2.0\",\"id\":%d,\"method\":\"eth_call\",\"params\":[{\"to\":\"%s\",\"data\":\"%s\"},\"latest\"]}",
                      i ? "," : "", i, to_hex, data_hex[i]);
    }
    w += snprintf(body + w, bcap - (size_t)w, "]");

    char *resp = post_json(body, (size_t)w, NULL, 0, "eth_call batch");
    free(body);
    if (!resp) return false;

    cJSON *j = cJSON_Parse(resp);
    free(resp);
    if (!j || !cJSON_IsArray(j)) { ESP_LOGE(TAG, "batch: answer is not an array"); if (j) cJSON_Delete(j); return false; }

    for (int i = 0; i < n; i++) out[i][0] = 0;
    int got = 0;
    const cJSON *e;
    cJSON_ArrayForEach(e, j) {
        const cJSON *idj = cJSON_GetObjectItem(e, "id");
        const cJSON *r = cJSON_GetObjectItem(e, "result");
        if (!cJSON_IsNumber(idj)) continue;
        int i = (int)idj->valuedouble;
        if (i < 0 || i >= n) continue;
        if (cJSON_IsString(r) && r->valuestring && strlen(r->valuestring) < out_cap) {
            strcpy(out[i], r->valuestring);
            got++;
        }
    }
    cJSON_Delete(j);
    if (got != n) ESP_LOGW(TAG, "batch: %d of %d calls answered", got, n);
    return got == n;
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

// 32-byte big-endian add, saturating. Fees never come near overflowing, but be explicit.
static void be32_add(uint8_t a[32], const uint8_t b[32])
{
    unsigned carry = 0;
    for (int i = 31; i >= 0; i--) { unsigned t = a[i] + b[i] + carry; a[i] = t & 0xff; carry = t >> 8; }
    if (carry) memset(a, 0xff, 32);
}

static void be32_double(uint8_t a[32])
{
    unsigned carry = 0;
    for (int i = 31; i >= 0; i--) { unsigned t = (a[i] << 1) | carry; a[i] = t & 0xff; carry = t >> 8; }
    if (carry) memset(a, 0xff, 32);
}

bool rpc_fee_data(uint8_t max_fee[32], uint8_t max_prio[32])
{
    // Base fee is only on the block header, so this needs the object-shaped result.
    uint8_t base[32];
    cJSON *blk = call_json("eth_getBlockByNumber", "[\"latest\",false]", NULL, 0);
    if (!blk) return false;
    cJSON *bf = cJSON_GetObjectItem(blk, "baseFeePerGas");
    bool ok = bf && cJSON_IsString(bf) && hex_to_bytes(bf->valuestring, base, 32);
    cJSON_Delete(blk);
    if (!ok) { ESP_LOGE(TAG, "no baseFeePerGas — chain is pre-1559?"); return false; }

    // Tip: ask the node, fall back to 1.5 gwei when the method is unsupported.
    char *t = call("eth_maxPriorityFeePerGas", "[]", NULL, 0);
    if (!t || !hex_to_bytes(t, max_prio, 32)) { u64_to_be32(1500000000ULL, max_prio); ESP_LOGW(TAG, "using fallback tip 1.5 gwei"); }
    free(t);

    // Ceiling = 2*baseFee + tip, so the tx survives a couple of blocks of base-fee growth.
    memcpy(max_fee, base, 32);
    be32_double(max_fee);
    be32_add(max_fee, max_prio);
    return true;
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
