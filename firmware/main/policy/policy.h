#pragma once
// The policy the pendant enforces, as read from the ENS text records on
// guardian.<parent>.eth. Same checks as brain/src/engine/policy.ts (withinPolicy), so a
// brain that skips its own stage is stopped here, before anything reaches the Ledger.
// Plain C with no ESP dependencies: firmware/test/policy_test.c runs it on the host
// against the vectors the brain's tests export.
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include "proposal.h"

#define POLICY_MAX_TARGETS   6
#define POLICY_MAX_SELECTORS 4
#define POLICY_REASON_LEN    48   // two lines of the result card

typedef struct {
    uint8_t addr[20];
    uint8_t sel[POLICY_MAX_SELECTORS][4];
    uint8_t nsel;
} policy_target_t;

#define POLICY_MAGIC 0x414D5031u   // "AMP1": bump when this struct changes (NVS blob check)

typedef struct {
    uint32_t magic;             // POLICY_MAGIC; a cached blob from another layout is discarded
    bool valid;                 // parsed from a complete record set
    uint32_t version;
    uint64_t chain;
    policy_target_t allowed[POLICY_MAX_TARGETS];
    uint8_t nallowed;
    uint8_t max_value_wei[32];  // big-endian
    uint16_t tier1_hf_x100;     // 1.40 -> 140
    uint16_t tier2_hf_x100;
    int64_t fetched_at;         // unix seconds of the last successful read, 0 = never
    bool stale;                 // a refresh failed and the copy is old
} policy_t;

// The record values as strings; NULL for a missing record. False when a required one is
// missing or malformed (version, chain, allowed, max_value_wei are required).
bool policy_parse(policy_t *p, const char *version, const char *chain, const char *allowed,
                  const char *max_value_wei, const char *tier1_hf, const char *tier2_hf);

// Is this proposal inside the policy? Advisories (tier 0) always are: nothing gets signed.
// `reason` (POLICY_REASON_LEN) is filled on refusal with words that fit the screen.
bool policy_within(const policy_t *p, const amulet_proposal_t *q, int64_t now_unix, char *reason, size_t cap);

// ---- agents -------------------------------------------------------------------------------
// One agent, one ENS name, one policy, one face. The pendant holds a few of them and checks
// each proposal against the policy of the agent that sent it. A proposal from a name the
// pendant does not know is refused outright, whatever it says.
#define AGENT_MAX        3
#define AGENT_LABEL_LEN  16
#define FACE_PX          16                       // the drawing is 16x16, one bit a pixel
#define FACE_BYTES       (FACE_PX * FACE_PX / 8)  // 32
#define FACE_RECORD_MIN  3                        // colour, then the bitmap

typedef struct {
    char     label[AGENT_LABEL_LEN];
    policy_t policy;
    uint8_t  face[FACE_BYTES];
    uint32_t colour;      // 0xRRGGBB, from the record's first three bytes
    bool     has_face;
} agent_t;

// Decodes an `amulet.face` record: base64 of three colour bytes then the bitmap.
bool face_parse(const char *b64, agent_t *out);

// Helpers exposed for the host test.
bool policy_dec_to_be32(const char *dec, uint8_t out[32]);
bool policy_hex_to_bytes(const char *hex, uint8_t *out, size_t len);
