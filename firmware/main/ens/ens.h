#pragma once
// Reads the policy records from the ENSv2 resolver on Sepolia (eth_call text(node,key))
// and keeps the last good copy in NVS, so a pendant that boots without the network still
// enforces the policy it last saw.
#include <stdbool.h>
#include <stdint.h>
#include "policy.h"

// One eth_call per record. On success `out` is the fresh policy (also saved to NVS) and
// true is returned. On failure `out` is left as it was.
bool ens_fetch_policy(policy_t *out);

// Last saved copy, if any.
bool ens_load_cached(policy_t *out);

// One text record, for the log. `out` gets the UTF-8 value (NUL-terminated, may be empty).
bool ens_text(const char *key, char *out, size_t cap);
