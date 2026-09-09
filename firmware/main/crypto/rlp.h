#pragma once
#include <stdint.h>
#include <stddef.h>
// Minimal RLP writer. All functions return bytes written, or 0 on overflow.
size_t rlp_bytes(uint8_t *out, size_t cap, const uint8_t *data, size_t len);      // string item
size_t rlp_uint(uint8_t *out, size_t cap, uint64_t v);                              // big-endian minimal, 0 → 0x80
size_t rlp_uint256(uint8_t *out, size_t cap, const uint8_t be[32]);                 // strips leading zeros
size_t rlp_list_header(uint8_t *out, size_t cap, size_t payload_len);               // list prefix only
