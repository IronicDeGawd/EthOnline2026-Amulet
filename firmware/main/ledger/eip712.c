#include "eip712.h"
#include "apdu_eth.h"
#include "ble_transport.h"
#include <string.h>
#include <stdio.h>
#include "esp_log.h"

static const char *TAG = "eip712";

#define INS_STRUCT_DEF  0x1A
#define INS_STRUCT_IMPL 0x1C
#define INS_SIGN_712    0x0C
#define P2_NAME  0x00   // struct name (definition) / root struct (implementation)
#define P2_FIELD 0xFF

// TypeDesc: bit 7 array, bit 6 has-size, bits 0-3 the type.
#define T_CUSTOM  0x00
#define T_UINT    0x02
#define T_ADDRESS 0x03
#define T_STRING  0x05
#define HAS_SIZE  0x40

// "EIP712Domain" / "Action" as a name APDU (definition when p2 is 0x00 on INS 1A, root when
// the same p2 is used on INS 1C).
size_t eip712_struct_name(uint8_t *buf, size_t cap, uint8_t ins, const char *name)
{
    size_t n = strlen(name);
    if (n > 255 || cap < 5 + n) return 0;
    buf[0] = ETH_CLA; buf[1] = ins; buf[2] = 0x00; buf[3] = P2_NAME; buf[4] = (uint8_t)n;
    memcpy(buf + 5, name, n);
    return 5 + n;
}

// One field of a struct definition: TypeDesc, the size byte when the type carries one, then
// the field name with a length byte.
size_t eip712_field_def(uint8_t *buf, size_t cap, uint8_t type_desc, uint8_t type_size, const char *key)
{
    size_t k = strlen(key);
    size_t lc = 1 + ((type_desc & HAS_SIZE) ? 1 : 0) + 1 + k;
    if (k > 255 || cap < 5 + lc) return 0;
    buf[0] = ETH_CLA; buf[1] = INS_STRUCT_DEF; buf[2] = 0x00; buf[3] = P2_FIELD; buf[4] = (uint8_t)lc;
    size_t p = 5;
    buf[p++] = type_desc;
    if (type_desc & HAS_SIZE) buf[p++] = type_size;
    buf[p++] = (uint8_t)k;
    memcpy(buf + p, key, k);
    return 5 + lc;
}

// A field value: two big-endian length bytes then the raw value. Values here are all short
// enough for one APDU (a summary is capped at 96 chars by the proposal parser).
size_t eip712_field_value(uint8_t *buf, size_t cap, const uint8_t *val, size_t len)
{
    size_t lc = 2 + len;
    if (lc > 255 || cap < 5 + lc) return 0;
    buf[0] = ETH_CLA; buf[1] = INS_STRUCT_IMPL; buf[2] = 0x00; buf[3] = P2_FIELD; buf[4] = (uint8_t)lc;
    buf[5] = (uint8_t)(len >> 8); buf[6] = (uint8_t)len;
    memcpy(buf + 7, val, len);
    return 5 + lc;
}

// Big-endian 32-byte number, minimal form: the device pads it back out itself, and a leading
// zero byte would be a different value to it.
static size_t trim32(const uint8_t in[32], uint8_t *out)
{
    size_t i = 0;
    while (i < 31 && in[i] == 0) i++;
    memcpy(out, in + i, 32 - i);
    return 32 - i;
}

// Every step but the last answers with nothing but a status word. The signing step waits
// longer: that is where the wearer reads the screen and presses the buttons.
static int send(const uint8_t *apdu, size_t len, uint8_t *resp, size_t *rlen, uint16_t *sw, const char *what)
{
    uint8_t scratch[8];
    size_t cap = rlen ? *rlen : sizeof scratch;
    uint8_t *buf = resp ? resp : scratch;
    size_t n = 0;
    uint32_t timeout = resp ? 120000 : 5000;
    int rc = ledger_apdu(apdu, len, buf, cap, &n, sw, timeout);
    if (rlen) *rlen = n;
    if (rc != 0 || *sw != 0x9000) {
        ESP_LOGE(TAG, "%s failed: rc %d sw 0x%04x", what, rc, *sw);
        return rc != 0 ? rc : -1;
    }
    return 0;
}

#define STEP(build, what) do { \
    size_t _l = (build); \
    if (_l == 0) { ESP_LOGE(TAG, "%s does not fit", what); return -10; } \
    int _rc = send(apdu, _l, NULL, NULL, sw, what); \
    if (_rc) return _rc; \
} while (0)

int eip712_sign_action(const uint32_t *path, uint8_t path_n, const eip712_action_t *a,
                       uint8_t sig_rsv[65], uint16_t *sw)
{
    uint8_t apdu[300];
    uint8_t val[64];
    *sw = 0;

    // 1. The types, all of them, before any value.
    STEP(eip712_struct_name(apdu, sizeof apdu, INS_STRUCT_DEF, "EIP712Domain"), "domain name");
    STEP(eip712_field_def(apdu, sizeof apdu, T_STRING, 0, "name"), "domain.name");
    STEP(eip712_field_def(apdu, sizeof apdu, T_STRING, 0, "version"), "domain.version");
    STEP(eip712_field_def(apdu, sizeof apdu, T_UINT | HAS_SIZE, 32, "chainId"), "domain.chainId");
    STEP(eip712_field_def(apdu, sizeof apdu, T_ADDRESS, 0, "verifyingContract"), "domain.verifyingContract");

    STEP(eip712_struct_name(apdu, sizeof apdu, INS_STRUCT_DEF, "Action"), "action name");
    STEP(eip712_field_def(apdu, sizeof apdu, T_STRING, 0, "summary"), "action.summary");
    STEP(eip712_field_def(apdu, sizeof apdu, T_STRING, 0, "action"), "action.action");
    STEP(eip712_field_def(apdu, sizeof apdu, T_ADDRESS, 0, "market"), "action.market");
    STEP(eip712_field_def(apdu, sizeof apdu, T_UINT | HAS_SIZE, 32, "amount"), "action.amount");
    STEP(eip712_field_def(apdu, sizeof apdu, T_UINT | HAS_SIZE, 32, "nonce"), "action.nonce");
    STEP(eip712_field_def(apdu, sizeof apdu, T_UINT | HAS_SIZE, 32, "deadline"), "action.deadline");

    // 2. The domain's values, in declaration order.
    STEP(eip712_struct_name(apdu, sizeof apdu, INS_STRUCT_IMPL, "EIP712Domain"), "domain root");
    STEP(eip712_field_value(apdu, sizeof apdu, (const uint8_t *)"Amulet", 6), "domain.name value");
    STEP(eip712_field_value(apdu, sizeof apdu, (const uint8_t *)"1", 1), "domain.version value");
    {
        uint8_t be[32] = {0};
        for (int i = 0; i < 8; i++) be[31 - i] = (uint8_t)(a->chain_id >> (8 * i));
        size_t n = trim32(be, val);
        STEP(eip712_field_value(apdu, sizeof apdu, val, n), "domain.chainId value");
    }
    STEP(eip712_field_value(apdu, sizeof apdu, a->verifying_contract, 20), "domain.verifyingContract value");

    // 3. The message.
    STEP(eip712_struct_name(apdu, sizeof apdu, INS_STRUCT_IMPL, "Action"), "action root");
    STEP(eip712_field_value(apdu, sizeof apdu, (const uint8_t *)a->summary, strlen(a->summary)), "summary");
    STEP(eip712_field_value(apdu, sizeof apdu, (const uint8_t *)a->action, strlen(a->action)), "action");
    STEP(eip712_field_value(apdu, sizeof apdu, a->market, 20), "market");
    { size_t n = trim32(a->amount, val);   STEP(eip712_field_value(apdu, sizeof apdu, val, n), "amount"); }
    { size_t n = trim32(a->nonce, val);    STEP(eip712_field_value(apdu, sizeof apdu, val, n), "nonce"); }
    { size_t n = trim32(a->deadline, val); STEP(eip712_field_value(apdu, sizeof apdu, val, n), "deadline"); }

    // 4. Sign. V1 takes the derivation path only; the device already holds the message.
    size_t lc = 1 + 4 * path_n;
    apdu[0] = ETH_CLA; apdu[1] = INS_SIGN_712; apdu[2] = 0x00; apdu[3] = 0x01; apdu[4] = (uint8_t)lc;
    apdu[5] = path_n;
    for (int i = 0; i < path_n; i++) {
        apdu[6 + 4 * i] = (uint8_t)(path[i] >> 24); apdu[7 + 4 * i] = (uint8_t)(path[i] >> 16);
        apdu[8 + 4 * i] = (uint8_t)(path[i] >> 8);  apdu[9 + 4 * i] = (uint8_t)path[i];
    }
    uint8_t resp[80];
    size_t rlen = sizeof resp;
    int rc = send(apdu, 5 + lc, resp, &rlen, sw, "sign");
    if (rc) return rc;
    if (rlen < 65) { ESP_LOGE(TAG, "short signature: %u bytes", (unsigned)rlen); return -11; }
    // The app answers v,r,s; the contract's ecrecover wants r,s,v.
    memcpy(sig_rsv, resp + 1, 64);
    sig_rsv[64] = resp[0];
    return 0;
}
