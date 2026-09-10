#include "proposal.h"
#include "tx.h"
#include "cJSON.h"
#include <string.h>
#include <stdio.h>
#include <inttypes.h>

#define FAIL(...) do { if (err) snprintf(err, err_cap, __VA_ARGS__); goto done; } while (0)

// Copies a JSON string field, truncating to fit. Truncation is fine for display text and
// fatal for nothing, so it is silent here.
static bool str_field(const cJSON *o, const char *key, char *dst, size_t cap)
{
    const cJSON *v = cJSON_GetObjectItemCaseSensitive(o, key);
    if (!cJSON_IsString(v) || !v->valuestring) return false;
    snprintf(dst, cap, "%s", v->valuestring);
    return true;
}

// Accepts a JSON number or a hex/decimal string. The brain sends big values as strings
// because JSON numbers cannot hold uint256, and small ones as plain numbers.
static bool u64_field(const cJSON *o, const char *key, uint64_t *dst)
{
    const cJSON *v = cJSON_GetObjectItemCaseSensitive(o, key);
    if (cJSON_IsNumber(v)) { if (v->valuedouble < 0) return false; *dst = (uint64_t)v->valuedouble; return true; }
    if (cJSON_IsString(v) && v->valuestring) {
        uint8_t be[32];
        if (!hex_to_bytes(v->valuestring, be, 32)) return false;
        for (int i = 0; i < 24; i++) if (be[i]) return false;   // does not fit in 64 bits
        *dst = 0; for (int i = 24; i < 32; i++) *dst = (*dst << 8) | be[i];
        return true;
    }
    return false;
}

// uint256 always arrives as a hex string.
static bool u256_field(const cJSON *o, const char *key, uint8_t dst[32])
{
    const cJSON *v = cJSON_GetObjectItemCaseSensitive(o, key);
    if (cJSON_IsNumber(v)) {
        if (v->valuedouble < 0) return false;
        u64_to_be32((uint64_t)v->valuedouble, dst);
        return true;
    }
    if (!cJSON_IsString(v) || !v->valuestring) return false;
    return hex_to_bytes(v->valuestring, dst, 32);
}

bool proposal_parse(const char *json, size_t len, amulet_proposal_t *out, char *err, size_t err_cap)
{
    bool ok = false;
    if (err) err[0] = 0;
    memset(out, 0, sizeof *out);

    cJSON *root = cJSON_ParseWithLength(json, len);
    if (!root) FAIL("not JSON");

    const cJSON *type = cJSON_GetObjectItemCaseSensitive(root, "type");
    if (!cJSON_IsString(type) || strcmp(type->valuestring, "proposal") != 0) FAIL("not a proposal");

    if (!str_field(root, "id", out->id, sizeof out->id)) FAIL("missing id");
    if (!str_field(root, "human", out->human, sizeof out->human)) FAIL("missing human text");
    str_field(root, "action", out->action, sizeof out->action);          // optional
    str_field(root, "rationale", out->rationale, sizeof out->rationale); // optional

    const cJSON *tier = cJSON_GetObjectItemCaseSensitive(root, "tier");
    if (!cJSON_IsNumber(tier) || tier->valuedouble < 0 || tier->valuedouble > 2) FAIL("bad tier");
    out->tier = (uint8_t)tier->valuedouble;

    const cJSON *tx = cJSON_GetObjectItemCaseSensitive(root, "tx");
    if (!cJSON_IsObject(tx)) FAIL("missing tx");

    if (!u64_field(tx, "chainId", &out->chain_id)) FAIL("bad chainId");
    if (!u64_field(tx, "nonce", &out->nonce))      FAIL("bad nonce");
    if (!u64_field(tx, "gas", &out->gas))          FAIL("bad gas");
    if (out->gas < 21000 || out->gas > 10000000)   FAIL("gas out of range");

    const cJSON *to = cJSON_GetObjectItemCaseSensitive(tx, "to");
    if (!cJSON_IsString(to) || !hex_to_bytes(to->valuestring, out->to, 20)) FAIL("bad to");

    if (!u256_field(tx, "value", out->value))                          FAIL("bad value");
    if (!u256_field(tx, "maxFeePerGas", out->max_fee))                 FAIL("bad maxFeePerGas");
    if (!u256_field(tx, "maxPriorityFeePerGas", out->max_priority_fee)) FAIL("bad maxPriorityFeePerGas");

    // Calldata is optional: a plain transfer has none.
    const cJSON *data = cJSON_GetObjectItemCaseSensitive(tx, "data");
    if (cJSON_IsString(data) && data->valuestring) {
        const char *h = data->valuestring;
        if (h[0] == '0' && (h[1] == 'x' || h[1] == 'X')) h += 2;
        size_t hl = strlen(h);
        if (hl % 2) FAIL("calldata has odd length");
        if (hl / 2 > PROP_DATA_MAX) FAIL("calldata too large");
        out->data_len = hl / 2;
        if (out->data_len && !hex_to_bytes(h, out->data, out->data_len)) FAIL("bad calldata");
    }

    // Evidence and expiry are advisory: their absence is not a reason to refuse to show.
    const cJSON *ev = cJSON_GetObjectItemCaseSensitive(root, "evidence");
    if (cJSON_IsObject(ev)) {
        str_field(ev, "deploymentId", out->deployment_id, sizeof out->deployment_id);
        u64_field(ev, "block", &out->evidence_block);
    }
    uint64_t exp = 0;
    if (u64_field(root, "expiresAt", &exp)) out->expires_at = (int64_t)exp;

    // The typed-data intent, when the brain sends one. Everything here is signed together,
    // so a missing or malformed field means no intent at all rather than a partial one.
    const cJSON *in = cJSON_GetObjectItemCaseSensitive(root, "intent");
    if (cJSON_IsObject(in)) {
        amulet_intent_t *t = &out->intent;
        const cJSON *acc = cJSON_GetObjectItemCaseSensitive(in, "account");
        const cJSON *mkt = cJSON_GetObjectItemCaseSensitive(in, "market");
        if (str_field(in, "summary", t->summary, sizeof t->summary)
            && str_field(in, "action", t->action, sizeof t->action)
            && cJSON_IsString(acc) && hex_to_bytes(acc->valuestring, t->account, 20)
            && cJSON_IsString(mkt) && hex_to_bytes(mkt->valuestring, t->market, 20)
            && u256_field(in, "amount", t->amount)
            && u256_field(in, "nonce", t->nonce)
            && u256_field(in, "deadline", t->deadline)) {
            t->present = true;
        } else {
            FAIL("intent is incomplete");
        }
    }

    // A plain transfer is fully readable from the transaction itself, so the screen shows
    // what will be signed, not what the brain claims. Contract calls keep the brain's words
    // until the policy layer can decode them.
    if (out->data_len == 0 && out->tier > 0) {
        char v[24]; proposal_format_value(out->value, v, sizeof v);
        snprintf(out->human, sizeof out->human, "Send %s", v);
    }

    ok = true;
done:
    if (root) cJSON_Delete(root);
    return ok;
}

bool options_parse(const char *json, size_t len, amulet_options_t *out, char *err, size_t err_cap)
{
    bool ok = false;
    memset(out, 0, sizeof *out);
    cJSON *root = cJSON_ParseWithLength(json, len);
    if (!root) FAIL("not JSON");
    const cJSON *type = cJSON_GetObjectItemCaseSensitive(root, "type");
    if (!cJSON_IsString(type) || strcmp(type->valuestring, "options") != 0) FAIL("not an options card");
    if (!str_field(root, "id", out->id, sizeof out->id)) FAIL("no id");
    if (!str_field(root, "asset", out->asset, sizeof out->asset)) FAIL("no asset");
    str_field(root, "footer", out->footer, sizeof out->footer);
    const cJSON *items = cJSON_GetObjectItemCaseSensitive(root, "items");
    if (!cJSON_IsArray(items)) FAIL("no items");
    const cJSON *it;
    cJSON_ArrayForEach(it, items) {
        if (out->n == OPT_MAX) break;
        amulet_option_t *o = &out->items[out->n];
        uint64_t idx = 0, apy = 0;
        if (!u64_field(it, "idx", &idx) || idx > 255) FAIL("bad item idx");
        if (!str_field(it, "human", o->human, sizeof o->human)) FAIL("item without text");
        if (!u64_field(it, "apyBps", &apy) || apy > 1000000) FAIL("bad item rate");
        str_field(it, "protocol", o->protocol, sizeof o->protocol);
        o->idx = (uint8_t)idx;
        o->apy_bps = (uint32_t)apy;
        out->n++;
    }
    if (out->n == 0) FAIL("empty card");
    const cJSON *ev = cJSON_GetObjectItemCaseSensitive(root, "evidence");
    if (cJSON_IsObject(ev)) {
        str_field(ev, "deploymentId", out->deployment_id, sizeof out->deployment_id);
        u64_field(ev, "block", &out->evidence_block);
    }
    uint64_t exp = 0;
    if (u64_field(root, "expiresAt", &exp)) out->expires_at = (int64_t)exp;
    ok = true;
done:
    if (root) cJSON_Delete(root);
    return ok;
}

bool options_expired(const amulet_options_t *o, int64_t now_unix)
{
    if (o->expires_at == 0 || now_unix == 0) return false;
    return now_unix > o->expires_at;
}

bool proposal_expired(const amulet_proposal_t *p, int64_t now_unix)
{
    if (p->expires_at == 0 || now_unix == 0) return false;
    return now_unix > p->expires_at;
}

void proposal_format_value(const uint8_t v[32], char *out, size_t cap)
{
    // Only the low 8 bytes matter for anything we will ever display; above that say "large".
    for (int i = 0; i < 24; i++) if (v[i]) { snprintf(out, cap, "large"); return; }
    uint64_t wei = 0;
    for (int i = 24; i < 32; i++) wei = (wei << 8) | v[i];

    uint64_t whole = wei / 1000000000000000000ULL;
    uint64_t frac4 = (wei % 1000000000000000000ULL) / 100000000000000ULL;   // 4 decimals
    char f[8]; snprintf(f, sizeof f, "%04" PRIu64, frac4);
    int n = 4; while (n > 1 && f[n - 1] == '0') n--;                        // trim zeros
    f[n] = 0;
    if (wei == 0) snprintf(out, cap, "0 ETH");
    else          snprintf(out, cap, "%" PRIu64 ".%s ETH", whole, f);
}

void proposal_format_addr(const uint8_t a[20], char *out, size_t cap)
{
    char hex[41]; bytes_to_hex(a, 20, hex);
    snprintf(out, cap, "0x%.4s..%.4s", hex, hex + 36);
}
