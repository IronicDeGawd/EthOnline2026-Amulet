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

// A typed-data intent. When present the pendant signs THIS on the Ledger instead of a raw
// transaction, so the device shows the summary and the figures instead of blind bytes. The
// summary is part of the signed message: what the screen says is what executes.
typedef struct {
    bool     present;
    char     summary[PROP_TEXT_LEN];
    char     action[16];          // Supply | Repay | Withdraw | Borrow
    uint8_t  market[20];
    uint8_t  amount[32];
    uint8_t  nonce[32];
    uint8_t  deadline[32];
    uint8_t  account[20];         // the AmuletAccount that verifies the signature
} amulet_intent_t;

#define PROP_AGENT_LEN 16

typedef struct {
    char     id[PROP_ID_LEN];
    char     agent[PROP_AGENT_LEN];      // which named agent is asking; "" means it did not say
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
    amulet_intent_t intent;
} amulet_proposal_t;

// Parses one JSON message. Returns true only for a well-formed proposal: every tx field
// present and in range. err (optional, >=64 bytes) gets a short reason on failure so the
// pendant can say WHY it refused rather than silently ignoring the brain.
bool proposal_parse(const char *json, size_t len, amulet_proposal_t *out, char *err, size_t err_cap);

// An options card: up to three venues for the same asset, ranked by the brain, already
// filtered by the ENS policy. A tap picks one and the brain answers with a normal proposal.
#define OPT_MAX        3
#define OPT_NAME_LEN   24
typedef struct {
    uint8_t  idx;
    char     protocol[12];
    char     human[OPT_NAME_LEN];   // "Spark WETH"
    uint32_t apy_bps;
} amulet_option_t;

typedef struct {
    char     id[PROP_ID_LEN];
    char     asset[8];
    uint8_t  n;
    amulet_option_t items[OPT_MAX];
    char     footer[40];
    char     deployment_id[PROP_TEXT_LEN];
    uint64_t evidence_block;
    int64_t  expires_at;
} amulet_options_t;

// Returns true only for a well-formed {type:"options"} message with 1..3 items.
bool options_parse(const char *json, size_t len, amulet_options_t *out, char *err, size_t err_cap);
bool options_expired(const amulet_options_t *o, int64_t now_unix);   // same rule as proposal_expired

// True when expires_at has passed. now_unix of 0 means "clock unknown" and never expires,
// so a pendant with no time source fails open rather than rejecting everything.
bool proposal_expired(const amulet_proposal_t *p, int64_t now_unix);

// "0.0001 ETH" style, for the screen. Keeps 4 decimal places, trims trailing zeros.
void proposal_format_value(const uint8_t value_be32[32], char *out, size_t cap);
// "0x2118…7736" — first 6 and last 4 of an address, which is what people actually check.
void proposal_format_addr(const uint8_t addr[20], char *out, size_t cap);
