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

// The node of one agent's name: <label>.<parent>.
static void agent_node(const char *label, uint8_t out[32])
{
    char name[64];
    snprintf(name, sizeof name, "%s.%s", label, AMULET_ENS_PARENT);
    namehash(name, out);
}

// text(bytes32 node, string key): selector, node, offset 0x40, length, key padded to 32.
static size_t encode_text_call(const uint8_t node[32], const char *key, char *out, size_t cap)
{
    size_t klen = strlen(key);
    size_t padded = (klen + 31) / 32 * 32;
    size_t need = 2 + (4 + 32 + 32 + 32 + padded) * 2 + 1;
    if (need > cap) return 0;
    char *w = out;
    w += sprintf(w, "0x59d1d43c");
    bytes_to_hex(node, 32, w); w += 64;
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

// Reads one record of one node. `answered` says the node replied at all, which is how a
// blanked or lapsed name is told apart from a network that is simply down.
static bool text_at(const uint8_t node[32], const char *key, char *out, size_t cap, bool *answered)
{
    if (answered) *answered = false;
    char call[512];
    if (!encode_text_call(node, key, call, sizeof call)) return false;
    char *res = malloc(2048); if (!res) return false;
    bool got = rpc_eth_call(AMULET_POLICY_RESOLVER, call, res, 2048);
    if (answered) *answered = got;
    bool ok = got && decode_string(res, out, cap);
    free(res);
    return ok;
}

bool ens_text_of(const char *label, const char *key, char *out, size_t cap)
{
    uint8_t node[32];
    agent_node(label, node);
    return text_at(node, key, out, cap, NULL);
}

#define NVS_NS  "amulet"
#define NVS_KEY "agents"

void ens_save_cached(const agent_t *in, int n)
{
    nvs_handle_t h;
    esp_err_t e = nvs_open(NVS_NS, NVS_READWRITE, &h);
    if (e != ESP_OK) { ESP_LOGW(TAG, "cannot open NVS to save agents: %s", esp_err_to_name(e)); return; }
    e = nvs_set_blob(h, NVS_KEY, in, sizeof(agent_t) * (size_t)n);
    if (e == ESP_OK) e = nvs_commit(h);
    if (e != ESP_OK) ESP_LOGW(TAG, "agents not saved: %s", esp_err_to_name(e));
    nvs_close(h);
}

int ens_load_cached(agent_t *out, int max)
{
    nvs_handle_t h;
    if (nvs_open(NVS_NS, NVS_READONLY, &h) != ESP_OK) return 0;
    size_t n = sizeof(agent_t) * (size_t)max;
    int got = 0;
    if (nvs_get_blob(h, NVS_KEY, out, &n) == ESP_OK && n % sizeof(agent_t) == 0) {
        got = (int)(n / sizeof(agent_t));
        // A blob written by a build with a different layout is not a policy, it is noise.
        for (int i = 0; i < got; i++) {
            if (out[i].policy.magic != POLICY_MAGIC || !out[i].policy.valid
                || out[i].policy.nallowed > POLICY_MAX_TARGETS) { got = 0; break; }
        }
    }
    nvs_close(h);
    return got;
}

// One agent's whole name in a single request: seven records, one batch, one TLS handshake.
static const char *AGENT_KEYS[] = {
    "amulet.version", "amulet.chain", "amulet.allowed", "amulet.max_value_wei",
    "amulet.tier1_hf", "amulet.tier2_hf", "amulet.face",
};
#define AGENT_NKEYS (sizeof AGENT_KEYS / sizeof AGENT_KEYS[0])
#define SLOT_LEN 1024

bool ens_fetch_agent(const char *label, agent_t *out, bool *revoked)
{
    uint8_t node[32];
    agent_node(label, node);
    if (revoked) *revoked = false;

    char *calls[AGENT_NKEYS] = {0}, *res[AGENT_NKEYS] = {0};
    bool built = true;
    for (size_t i = 0; i < AGENT_NKEYS; i++) {
        calls[i] = malloc(640);
        res[i] = malloc(SLOT_LEN);
        if (!calls[i] || !res[i] || !encode_text_call(node, AGENT_KEYS[i], calls[i], 640)) { built = false; break; }
    }
    // The first request after boot pays for DNS and a TLS handshake and sometimes runs out
    // of time. Losing an agent to that would look exactly like the Ledger revoking it, so
    // try twice before believing the network.
    bool answered = false;
    for (int attempt = 0; built && attempt < 2 && !answered; attempt++) {
        answered = rpc_eth_call_batch(AMULET_POLICY_RESOLVER, (const char **)calls, (int)AGENT_NKEYS, res, SLOT_LEN);
        if (!answered && attempt == 0) ESP_LOGW(TAG, "%s: first read timed out, trying once more", label);
    }

    char value[AGENT_NKEYS][400];
    bool have[AGENT_NKEYS];
    for (size_t i = 0; i < AGENT_NKEYS; i++) {
        value[i][0] = 0;
        have[i] = answered && decode_string(res[i], value[i], sizeof value[i]);
    }
    for (size_t i = 0; i < AGENT_NKEYS; i++) { free(calls[i]); free(res[i]); }

    if (!answered) { ESP_LOGW(TAG, "%s: policy read failed (network or resolver)", label); return false; }

    // The name answered and its version is blank: this agent has been switched off on chain.
    // That is an instruction, not an outage, and the caller drops it rather than keeping the
    // cached policy alive.
    if (!have[0] || !value[0][0]) {
        if (revoked) *revoked = true;
        ESP_LOGW(TAG, "%s: no policy on its name — revoked", label);
        return false;
    }

    agent_t a;
    memset(&a, 0, sizeof a);
    snprintf(a.label, sizeof a.label, "%s", label);
    if (!policy_parse(&a.policy, value[0], value[1], value[2], value[3], value[4], value[5])) {
        ESP_LOGE(TAG, "%s: records do not parse: v=%s chain=%s allowed=%.60s cap=%s", label, value[0], value[1], value[2], value[3]);
        return false;
    }
    a.policy.fetched_at = (int64_t)time(NULL);
    a.policy.stale = false;
    if (have[6]) face_parse(value[6], &a);
    *out = a;
    ESP_LOGI(TAG, "%s.%s: v%u chain %llu, %u targets, cap %s wei, tiers %u/%u, face %s",
             label, AMULET_ENS_PARENT, a.policy.version, (unsigned long long)a.policy.chain,
             a.policy.nallowed, value[3], a.policy.tier1_hf_x100, a.policy.tier2_hf_x100,
             a.has_face ? "yes" : "none");
    return true;
}
