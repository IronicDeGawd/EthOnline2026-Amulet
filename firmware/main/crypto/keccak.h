#pragma once
#include <stdint.h>
#include <stddef.h>
// Keccak-256 (Ethereum flavour, 0x01 padding — NOT NIST SHA3).
void keccak256(const uint8_t *in, size_t len, uint8_t out[32]);
