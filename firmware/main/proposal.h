#pragma once
// A proposal as the brain sends it. Schema is fixed in context/PRD.md:
//   {type:"proposal", id, tier, action, human, rationale,
//    tx:{chainId,to,value,data,nonce,maxFeePerGas,maxPriorityFeePerGas,gas},
//    evidence:{deploymentId,block,queriedAt}, expiresAt}
#include <stdint.h>
#include <stddef.h>
#include <stdbool.h>

#define PROP_ID_LEN        41    // 0x + 32 hex + NUL, generous
#define PROP_TEXT_LEN      96    // human / rationale, truncated for a 240px screen
#define PROP_ACTION_LEN    24
#define PROP_DATA_MAX      512   // calldata bytes

typedef struct {
    char     id[PROP_ID_LEN];
    uint8_t  tier;                       // 0 advisory, 1 small pre-approved, 2 full
    char     action[PROP_ACTION_LEN];    // REPAY_DEBT, ADD_COLLATERAL, SWAP, ...
    char     human[PROP_TEXT_LEN];       // one line, shown large
    char     rationale[PROP_TEXT_LEN];   // why, shown small

    uint64_t chain_id;
    uint8_t  to[20];
    uint8_t  value[32];
    uint64_t nonce;
    uint8_t  max_fee[32];
    uint8_t  max_priority_fee[32];
    uint64_t gas;
    uint8_t  data[PROP_DATA_MAX];
    size_t   data_len;

    char     deployment_id[PROP_TEXT_LEN];   // which subgraph deployment the evidence came from
    uint64_t evidence_block;
    int64_t  expires_at;                     // unix seconds; 0 = no expiry given
} amulet_proposal_t;

// Parses one JSON message. Returns true only for a well-formed proposal: every tx field
// present and in range. err (optional, >=64 bytes) gets a short reason on failure so the
// pendant can say WHY it refused rather than silently ignoring the brain.
bool proposal_parse(const char *json, size_t len, amulet_proposal_t *out, char *err, size_t err_cap);

// True when expires_at has passed. now_unix of 0 means "clock unknown" and never expires,
// so a pendant with no time source fails open rather than rejecting everything.
bool proposal_expired(const amulet_proposal_t *p, int64_t now_unix);

// "0.0001 ETH" style, for the screen. Keeps 4 decimal places, trims trailing zeros.
void proposal_format_value(const uint8_t value_be32[32], char *out, size_t cap);
// "0x2118…7736" — first 6 and last 4 of an address, which is what people actually check.
void proposal_format_addr(const uint8_t addr[20], char *out, size_t cap);
