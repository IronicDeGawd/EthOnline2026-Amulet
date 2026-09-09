#pragma once
// Ledger Ethereum app APDU builders/parsers. CLA 0xE0.
#include <stdint.h>
#include <stddef.h>
#include <stdbool.h>

#define ETH_CLA            0xE0
#define ETH_INS_GET_ADDR   0x02
#define ETH_INS_SIGN_TX    0x04
#define ETH_INS_ERC20_INFO 0x0A
#define BIP32_HARDEN       0x80000000u

// Builds GET PUBLIC KEY. path: array of n uint32 components (use BIP32_HARDEN). Returns APDU length.
size_t apdu_eth_get_address(uint8_t *buf, size_t cap, const uint32_t *path, uint8_t n, bool display);
// Parses GET PUBLIC KEY response (status word already stripped). addr_out gets "0x" + 40 hex + NUL (43 bytes).
int apdu_eth_parse_address(const uint8_t *resp, size_t len, uint8_t pubkey65[65], char addr_out[43]);
// SIGN TX chunk builder. Call with chunk_index 0..: first chunk embeds path then RLP; later chunks pure RLP.
// *offset is advanced through rlp. Returns APDU length, or 0 when rlp fully consumed.
size_t apdu_eth_sign_chunk(uint8_t *buf, size_t cap, const uint32_t *path, uint8_t n,
                           const uint8_t *rlp, size_t rlp_len, size_t *offset, bool first);
// Parses SIGN TX response into v, r, s.
int apdu_eth_parse_sig(const uint8_t *resp, size_t len, uint8_t *v, uint8_t r[32], uint8_t s[32]);
