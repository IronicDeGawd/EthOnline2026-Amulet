#pragma once
#include <stdint.h>
#include <stddef.h>
#include <stdbool.h>
// Minimal Ethereum JSON-RPC over HTTPS.
void rpc_init(const char *url);
bool rpc_eth_call(const char *to_hex, const char *data_hex, char *out, size_t out_cap);   // eth_call, hex result
// Several eth_calls to the same contract in one request. Public endpoints time out long
// before a dozen separate TLS handshakes finish.
bool rpc_eth_call_batch(const char *to_hex, const char **data_hex, int n, char **out, size_t out_cap);
bool rpc_get_nonce(const char *addr_hex, uint64_t *nonce);           // eth_getTransactionCount pending
bool rpc_gas_price(uint8_t out_be32[32]);                             // eth_gasPrice (legacy txs)
// EIP-1559 fees: tip from eth_maxPriorityFeePerGas, ceiling = 2*baseFeePerGas + tip.
bool rpc_fee_data(uint8_t max_fee_be32[32], uint8_t max_prio_be32[32]);
bool rpc_balance(const char *addr_hex, uint8_t out_be32[32]);        // eth_getBalance
bool rpc_send_raw(const uint8_t *raw, size_t len, char tx_hash_out[67], char err_out[128]);
