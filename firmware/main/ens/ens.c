#include "ens.h"
#include <string.h>
#include <stdio.h>
#include <stdlib.h>
#include <time.h>
#include "esp_log.h"
#include "nvs_flash.h"
#include "nvs.h"
#include "keccak.h"
#include "tx.h"
#include "rpc.h"
#include "amulet_config.h"

static const char *TAG = "ens";
static uint8_t s_node[32];
static bool s_node_ready;

// ENS namehash: fold keccak(label) into the parent's hash, right to left, from the zero root.
static void namehash(const char *name, uint8_t out[32])
{
    memset(out, 0, 32);
    const char *end = name + strlen(name);
    while (end > name) {
        const char *start = end;
        while (start > name && start[-1] != '.') start--;
        uint8_t buf[64];
        memcpy(buf, out, 32);
        keccak256((const uint8_t *)start, (size_t)(end - start), buf + 32);
        keccak256(buf, 64, out);
        end = start > name ? start - 1 : start;
    }
}

static const uint8_t *node(void)
{
    if (!s_node_ready) { namehash(AMULET_POLICY_NAME, s_node); s_node_ready = true; }
    return s_node;
}

// text(bytes32 node, string key): selector, node, offset 0x40, length, key padded to 32.
static size_t encode_text_call(const char *key, char *out, size_t cap)
{
    size_t klen = strlen(key);
    size_t padded = (klen + 31) / 32 * 32;
    size_t need = 2 + (4 + 32 + 32 + 32 + padded) * 2 + 1;
    if (need > cap) return 0;
    char *w = out;
    w += sprintf(w, "0x59d1d43c");
    bytes_to_hex(node(), 32, w); w += 64;
    w += sprintf(w, "%064x", 0x40);
    w += sprintf(w, "%064x", (unsigned)klen);
    for (size_t i = 0; i < padded; i++) w += sprintf(w, "%02x", i < klen ? (unsigned char)key[i] : 0);
    *w = 0;
    return (size_t)(w - out);
}

// ABI string: offset(32) length(32) bytes. Everything is hex text from the node.
static int hexval(char c)
{
    if (c >= '0' && c <= '9') return c - '0';
    if (c >= 'a' && c <= 'f') return c - 'a' + 10;
    if (c >= 'A' && c <= 'F') return c - 'A' + 10;
    return -1;
}

// Low 16 bits of a 32-byte word written as 64 hex chars (offsets and lengths are small).
static bool word16(const char *hex, size_t *out)
{
    size_t v = 0;
    for (int i = 0; i < 64; i++) {
        int h = hexval(hex[i]);
        if (h < 0) return false;
        if (i < 60 && h) return false;   // anything above 16 bits is not a sane string header
        v = (v << 4) | (size_t)h;
    }
    *out = v;
    return true;
}

static bool decode_string(const char *hex, char *out, size_t cap)
{
    if (hex[0] == '0' && hex[1] == 'x') hex += 2;
    size_t n = strlen(hex);
    if (n < 128) return false;
    size_t offset, length;
    if (!word16(hex, &offset) || !word16(hex + 64, &length)) return false;
    if (offset != 32 || length + 1 > cap || 128 + length * 2 > n) return false;
    for (size_t i = 0; i < length; i++) {
        int a = hexval(hex[128 + i * 2]), b = hexval(hex[129 + i * 2]);
        if (a < 0 || b < 0) return false;
        out[i] = (char)((a << 4) | b);
    }
    out[length] = 0;
    return true;
}

bool ens_text(const char *key, char *out, size_t cap)
{
    char call[512];
    if (!encode_text_call(key, call, sizeof call)) return false;
    char *res = malloc(2048); if (!res) return false;
    bool ok = rpc_eth_call(AMULET_POLICY_RESOLVER, call, res, 2048) && decode_string(res, out, cap);
    free(res);
    return ok;
}

#define NVS_NS "amulet"
#define NVS_KEY "policy"

static void save(const policy_t *p)
{
    nvs_handle_t h;
    if (nvs_open(NVS_NS, NVS_READWRITE, &h) != ESP_OK) return;
    if (nvs_set_blob(h, NVS_KEY, p, sizeof *p) == ESP_OK) nvs_commit(h);
    nvs_close(h);
}

bool ens_load_cached(policy_t *out)
{
    nvs_handle_t h;
    if (nvs_open(NVS_NS, NVS_READONLY, &h) != ESP_OK) return false;
    size_t n = sizeof *out;
    policy_t tmp;
    bool ok = nvs_get_blob(h, NVS_KEY, &tmp, &n) == ESP_OK && n == sizeof tmp
              && tmp.magic == POLICY_MAGIC && tmp.valid && tmp.nallowed <= POLICY_MAX_TARGETS;
    nvs_close(h);
    if (ok) *out = tmp;
    return ok;
}

bool ens_fetch_policy(policy_t *out)
{
    char version[16], chain[24], allowed[400], cap[80], t1[16], t2[16];
    if (!ens_text("amulet.version", version, sizeof version) || !ens_text("amulet.chain", chain, sizeof chain) ||
        !ens_text("amulet.allowed", allowed, sizeof allowed) || !ens_text("amulet.max_value_wei", cap, sizeof cap)) {
        ESP_LOGW(TAG, "policy read failed (network or resolver)");
        return false;
    }
    if (!ens_text("amulet.tier1_hf", t1, sizeof t1)) t1[0] = 0;
    if (!ens_text("amulet.tier2_hf", t2, sizeof t2)) t2[0] = 0;
    policy_t p;
    if (!policy_parse(&p, version, chain, allowed, cap, t1, t2)) {
        ESP_LOGE(TAG, "policy records do not parse: v=%s chain=%s allowed=%.60s cap=%s", version, chain, allowed, cap);
        return false;
    }
    p.fetched_at = (int64_t)time(NULL);
    p.stale = false;
    *out = p;
    save(&p);
    ESP_LOGI(TAG, "policy v%u chain %llu, %u targets, cap %s wei, tiers %u/%u from %s",
             p.version, (unsigned long long)p.chain, p.nallowed, cap, p.tier1_hf_x100, p.tier2_hf_x100, AMULET_POLICY_NAME);
    return true;
}
