#include "apdu_eth.h"
#include <string.h>
#include <stdio.h>

#define MAX_CHUNK 255

static size_t put_path(uint8_t *p, const uint32_t *path, uint8_t n)
{
    p[0] = n;
    for (int i = 0; i < n; i++) {
        p[1 + 4*i] = path[i] >> 24; p[2 + 4*i] = path[i] >> 16; p[3 + 4*i] = path[i] >> 8; p[4 + 4*i] = path[i];
    }
    return 1 + 4 * n;
}

size_t apdu_eth_get_address(uint8_t *buf, size_t cap, const uint32_t *path, uint8_t n, bool display)
{
    size_t lc = 1 + 4 * n;
    if (cap < 5 + lc) return 0;
    buf[0] = ETH_CLA; buf[1] = ETH_INS_GET_ADDR; buf[2] = display ? 0x01 : 0x00; buf[3] = 0x00; buf[4] = lc;
    put_path(buf + 5, path, n);
    return 5 + lc;
}

int apdu_eth_parse_address(const uint8_t *resp, size_t len, uint8_t pubkey65[65], char addr_out[43])
{
    if (len < 1) return -1;
    uint8_t pl = resp[0];
    if (pl != 65 || len < 1 + pl + 1) return -2;
    memcpy(pubkey65, resp + 1, 65);
    uint8_t al = resp[1 + pl];
    if (al != 40 || len < 1 + pl + 1 + al) return -3;
    addr_out[0] = '0'; addr_out[1] = 'x';
    memcpy(addr_out + 2, resp + 1 + pl + 1, 40); addr_out[42] = 0;
    return 0;
}

size_t apdu_eth_sign_chunk(uint8_t *buf, size_t cap, const uint32_t *path, uint8_t n,
                           const uint8_t *rlp, size_t rlp_len, size_t *offset, bool first)
{
    if (*offset >= rlp_len && !first) return 0;
    size_t hdr = first ? (1 + 4 * n) : 0;
    size_t room = MAX_CHUNK - hdr;
    size_t take = rlp_len - *offset; if (take > room) take = room;
    size_t lc = hdr + take;
    if (cap < 5 + lc) return 0;
    buf[0] = ETH_CLA; buf[1] = ETH_INS_SIGN_TX; buf[2] = first ? 0x00 : 0x80; buf[3] = 0x00; buf[4] = lc;
    size_t p = 5;
    if (first) p += put_path(buf + p, path, n);
    memcpy(buf + p, rlp + *offset, take);
    *offset += take;
    return 5 + lc;
}

int apdu_eth_parse_sig(const uint8_t *resp, size_t len, uint8_t *v, uint8_t r[32], uint8_t s[32])
{
    if (len < 65) return -1;
    *v = resp[0]; memcpy(r, resp + 1, 32); memcpy(s, resp + 33, 32);
    return 0;
}
