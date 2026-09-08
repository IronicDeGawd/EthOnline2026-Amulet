#pragma once
#include <stdint.h>
#include <stddef.h>
#include <stdbool.h>

// Legacy (type 0, EIP-155) transaction. Values as big-endian 32-byte where they may exceed 64 bits.
typedef struct {
    uint64_t chain_id;
    uint64_t nonce;
    uint8_t  gas_price[32];
    uint64_t gas_limit;
    uint8_t  to[20];
    uint8_t  value[32];
    const uint8_t *data; size_t data_len;
} legacy_tx_t;

// RLP for signing: [nonce, gasPrice, gasLimit, to, value, data, chainId, 0, 0]
size_t tx_legacy_encode_unsigned(const legacy_tx_t *tx, uint8_t *out, size_t cap);
// RLP with signature: [nonce, gasPrice, gasLimit, to, value, data, v, r, s]
size_t tx_legacy_encode_signed(const legacy_tx_t *tx, uint64_t v, const uint8_t r[32], const uint8_t s[32], uint8_t *out, size_t cap);
// Ledger returns a 1-byte v for legacy txs; recover full EIP-155 v (chainId*2+35+parity).
uint64_t tx_legacy_v_from_ledger(uint8_t ledger_v, uint64_t chain_id);

// EIP-1559 (type 2) transaction. Two fee fields replace gasPrice; access list is always empty here.
typedef struct {
    uint64_t chain_id;
    uint64_t nonce;
    uint8_t  max_priority_fee[32];   // tip to the block builder
    uint8_t  max_fee[32];            // ceiling: base fee + tip
    uint64_t gas_limit;
    uint8_t  to[20];
    uint8_t  value[32];
    const uint8_t *data; size_t data_len;
} tx1559_t;

// 0x02 || rlp([chainId, nonce, maxPriorityFeePerGas, maxFeePerGas, gasLimit, to, value, data, []])
size_t tx_1559_encode_unsigned(const tx1559_t *tx, uint8_t *out, size_t cap);
// 0x02 || rlp([... , yParity, r, s]) — yParity is 0 or 1, not the EIP-155 form.
size_t tx_1559_encode_signed(const tx1559_t *tx, uint8_t y_parity, const uint8_t r[32], const uint8_t s[32], uint8_t *out, size_t cap);
// yParity from the Ledger's 1-byte v. Measured on a real Nano X: typed transactions come back
// as the bare parity. Not spec-guaranteed across app versions — keep the flipped-parity retry.
uint8_t tx_1559_parity_from_ledger(uint8_t ledger_v, uint64_t chain_id);
// helpers
void u64_to_be32(uint64_t v, uint8_t out[32]);
bool hex_to_bytes(const char *hex, uint8_t *out, size_t len);   // hex with/without 0x, exact length
void bytes_to_hex(const uint8_t *in, size_t len, char *out);     // out needs 2*len+1
