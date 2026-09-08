#include "rlp.h"
#include <string.h>

static size_t put_len(uint8_t *out, size_t cap, size_t len, uint8_t base_short, uint8_t base_long)
{
    if (len < 56) { if (cap < 1) return 0; out[0] = base_short + len; return 1; }
    uint8_t be[8]; int n = 0; size_t l = len;
    while (l) { be[7 - n++] = l & 0xff; l >>= 8; }
    if (cap < 1 + (size_t)n) return 0;
    out[0] = base_long + n; memcpy(out + 1, be + 8 - n, n);
    return 1 + n;
}

size_t rlp_bytes(uint8_t *out, size_t cap, const uint8_t *data, size_t len)
{
    if (len == 1 && data[0] < 0x80) { if (cap < 1) return 0; out[0] = data[0]; return 1; }
    size_t h = put_len(out, cap, len, 0x80, 0xb7);
    if (!h || cap < h + len) return 0;
    memcpy(out + h, data, len);
    return h + len;
}

size_t rlp_uint(uint8_t *out, size_t cap, uint64_t v)
{
    uint8_t be[8]; int n = 0;
    while (v) { be[7 - n++] = v & 0xff; v >>= 8; }
    return rlp_bytes(out, cap, be + 8 - n, n);   // n==0 → empty string → 0x80
}

size_t rlp_uint256(uint8_t *out, size_t cap, const uint8_t be[32])
{
    int i = 0; while (i < 32 && be[i] == 0) i++;
    return rlp_bytes(out, cap, be + i, 32 - i);
}

size_t rlp_list_header(uint8_t *out, size_t cap, size_t payload_len)
{
    return put_len(out, cap, payload_len, 0xc0, 0xf7);
}
