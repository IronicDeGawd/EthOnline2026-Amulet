#pragma once
#include <stdint.h>
#include <stddef.h>
#include <stdbool.h>
// Minimal Ethereum JSON-RPC over HTTPS.
void rpc_init(const char *url);
bool rpc_get_nonce(const char *addr_hex, uint64_t *nonce);           // eth_getTransactionCount pending
bool rpc_gas_price(uint8_t out_be32[32]);                             // eth_gasPrice
bool rpc_balance(const char *addr_hex, uint8_t out_be32[32]);        // eth_getBalance
bool rpc_send_raw(const uint8_t *raw, size_t len, char tx_hash_out[67], char err_out[128]);
