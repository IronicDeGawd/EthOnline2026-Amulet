#include "tx.h"
#include "rlp.h"
#include <string.h>

#define PUT(expr) do { size_t _n = (expr); if (!_n) return 0; p += _n; } while (0)

static size_t body_common(const legacy_tx_t *tx, uint8_t *b, size_t cap)
{
    size_t p = 0;
    PUT(rlp_uint(b + p, cap - p, tx->nonce));
    PUT(rlp_uint256(b + p, cap - p, tx->gas_price));
    PUT(rlp_uint(b + p, cap - p, tx->gas_limit));
    PUT(rlp_bytes(b + p, cap - p, tx->to, 20));
    PUT(rlp_uint256(b + p, cap - p, tx->value));
    PUT(rlp_bytes(b + p, cap - p, tx->data, tx->data_len));
    return p;
}

size_t tx_legacy_encode_unsigned(const legacy_tx_t *tx, uint8_t *out, size_t cap)
{
    uint8_t body[1024]; size_t p = body_common(tx, body, sizeof body);
    if (!p) return 0;
    PUT(rlp_uint(body + p, sizeof body - p, tx->chain_id));
    PUT(rlp_uint(body + p, sizeof body - p, 0));
    PUT(rlp_uint(body + p, sizeof body - p, 0));
    size_t h = rlp_list_header(out, cap, p);
    if (!h || cap < h + p) return 0;
    memcpy(out + h, body, p);
    return h + p;
}

size_t tx_legacy_encode_signed(const legacy_tx_t *tx, uint64_t v, const uint8_t r[32], const uint8_t s[32], uint8_t *out, size_t cap)
{
    uint8_t body[1024]; size_t p = body_common(tx, body, sizeof body);
    if (!p) return 0;
    PUT(rlp_uint(body + p, sizeof body - p, v));
    PUT(rlp_uint256(body + p, sizeof body - p, r));
    PUT(rlp_uint256(body + p, sizeof body - p, s));
    size_t h = rlp_list_header(out, cap, p);
    if (!h || cap < h + p) return 0;
    memcpy(out + h, body, p);
    return h + p;
}

// ---- EIP-1559 (type 2) ----

static size_t body_1559_common(const tx1559_t *tx, uint8_t *b, size_t cap)
{
    size_t p = 0;
    PUT(rlp_uint(b + p, cap - p, tx->chain_id));
    PUT(rlp_uint(b + p, cap - p, tx->nonce));
    PUT(rlp_uint256(b + p, cap - p, tx->max_priority_fee));
    PUT(rlp_uint256(b + p, cap - p, tx->max_fee));
    PUT(rlp_uint(b + p, cap - p, tx->gas_limit));
    PUT(rlp_bytes(b + p, cap - p, tx->to, 20));
    PUT(rlp_uint256(b + p, cap - p, tx->value));
    PUT(rlp_bytes(b + p, cap - p, tx->data, tx->data_len));
    PUT(rlp_list_header(b + p, cap - p, 0));   // empty access list
    return p;
}

// Wraps the assembled body in a list header and prefixes the 0x02 type byte.
static size_t seal_1559(const uint8_t *body, size_t p, uint8_t *out, size_t cap)
{
    if (cap < 1) return 0;
    out[0] = 0x02;
    size_t h = rlp_list_header(out + 1, cap - 1, p);
    if (!h || cap < 1 + h + p) return 0;
    memcpy(out + 1 + h, body, p);
    return 1 + h + p;
}

size_t tx_1559_encode_unsigned(const tx1559_t *tx, uint8_t *out, size_t cap)
{
    uint8_t body[1024]; size_t p = body_1559_common(tx, body, sizeof body);
    if (!p) return 0;
    return seal_1559(body, p, out, cap);
}

size_t tx_1559_encode_signed(const tx1559_t *tx, uint8_t y_parity, const uint8_t r[32], const uint8_t s[32], uint8_t *out, size_t cap)
{
    uint8_t body[1024]; size_t p = body_1559_common(tx, body, sizeof body);
    if (!p) return 0;
    PUT(rlp_uint(body + p, sizeof body - p, y_parity));
    PUT(rlp_uint256(body + p, sizeof body - p, r));
    PUT(rlp_uint256(body + p, sizeof body - p, s));
    return seal_1559(body, p, out, cap);
}

uint8_t tx_1559_parity_from_ledger(uint8_t ledger_v, uint64_t chain_id)
{
    // Measured on a real Nano X (Ethereum app, Sepolia, tx 0xb7cb3e4a…c074): for a type-2
    // transaction the device returns the bare yParity, NOT the EIP-155 form. Deriving it the
    // way hw-app-eth does (subtract chainId*2+35 truncated to one byte) gives the wrong answer
    // here — it would have returned 1 where the chain accepted 0. Callers should still keep the
    // flipped-parity retry: this is one device on one app version, not a spec guarantee.
    (void)chain_id;
    return ledger_v & 1;
}

uint64_t tx_legacy_v_from_ledger(uint8_t ledger_v, uint64_t chain_id)
{
    // hw-app-eth: parity = (v - (chainId*2+35)) mod 256 truncated to 0/1
    uint64_t base = chain_id * 2 + 35;
    uint8_t parity = (uint8_t)(ledger_v - (uint8_t)(base & 0xff)) & 1;
    return base + parity;
}

void u64_to_be32(uint64_t v, uint8_t out[32]) { memset(out, 0, 32); for (int i = 0; i < 8; i++) out[31 - i] = (v >> (8 * i)) & 0xff; }

static int hexval(char c) { if (c >= '0' && c <= '9') return c - '0'; c |= 0x20; if (c >= 'a' && c <= 'f') return c - 'a' + 10; return -1; }

bool hex_to_bytes(const char *hex, uint8_t *out, size_t len)
{
    if (hex[0] == '0' && (hex[1] == 'x' || hex[1] == 'X')) hex += 2;
    size_t hl = strlen(hex);
    if (hl > 2 * len) return false;
    memset(out, 0, len);
    // right-align (handles odd-length / short hex like "0x1a2b")
    size_t bi = len - 1;
    for (size_t i = hl; i > 0; ) {
        int lo = hexval(hex[--i]); int hi = i > 0 ? hexval(hex[--i]) : 0;
        if (lo < 0 || hi < 0) return false;
        out[bi--] = (hi << 4) | lo;
        if (bi == (size_t)-1 && i > 0) return false;
    }
    return true;
}

void bytes_to_hex(const uint8_t *in, size_t len, char *out)
{
    static const char *h = "0123456789abcdef";
    for (size_t i = 0; i < len; i++) { out[2*i] = h[in[i] >> 4]; out[2*i+1] = h[in[i] & 15]; }
    out[2*len] = 0;
}
